from __future__ import annotations

import argparse
import functools
import http.server
import json
import math
import os
import threading
import time
import urllib.parse
import uuid

from . import _console, cube, net, package
from .targets import TARGETS

WEB = package.WEB.parent
MAX_EXPOSURES = 600
CURATED = frozenset(TARGETS) | {"wise0855_h40"}
CURATED_PREFIXES = ("y_",)
MEASUREMENTS = ("analysis.json", "candidate.json", "variable.json")
JOBS: dict[str, dict] = {}
_RUNNING: dict[tuple, str] = {}
_LOCK = threading.Lock()


class BadRequest(ValueError):
    pass


def slug_for(ra: float, dec: float, half: int, target: str | None) -> str:
    return (target if target and half == 24 else None) or (f"{target}_h{half}" if target else package.default_slug(ra, dec, half))


def is_curated(slug: str) -> bool:
    d = package.WEB / slug
    if not (d / "manifest.json").exists():
        return False
    return slug in CURATED or slug.startswith(CURATED_PREFIXES) or any((d / m).exists() for m in MEASUREMENTS)


def parse_request(q: dict) -> tuple[float, float, int, int, str | None]:
    target = q.get("t", [None])[0]
    if target not in TARGETS:
        target = None
    try:
        if target:
            ra, dec = TARGETS[target]["center"]
        else:
            ra, dec = float(q["ra"][0]), float(q["dec"][0])
        half = int(q.get("half", ["24"])[0])
        max_exp = int(q.get("max", [str(MAX_EXPOSURES)])[0])
    except (KeyError, ValueError, IndexError):
        raise BadRequest("ra and dec in degrees are required; half and max are whole numbers") from None
    if not (math.isfinite(ra) and math.isfinite(dec)):
        raise BadRequest("ra and dec must be finite numbers")
    if not -90.0 <= dec <= 90.0:
        raise BadRequest("dec must be between -90 and 90 degrees")
    return ra % 360.0, dec, max(8, min(40, half)), max(20, min(3000, max_exp)), target


def _run(job_id: str, key: tuple):
    ra, dec, half, max_exp, target = key
    job = JOBS[job_id]
    start = net.METER.snapshot()["bytes"]

    def spent():
        return round((net.METER.snapshot()["bytes"] - start) / 1e6, 2)

    def progress(done, total, meter):
        job.update(done=done, total=total, mb=spent())
    try:
        images, failed = cube.list_field(ra, dec, half)
        if not images:
            job.update(state="error", code="archive" if failed else "empty",
                       error="the archive did not answer" if failed else "no SPHEREx image covers this position")
            return
        kept = cube.thin(images, max_exp)
        job.update(state="running", listed=len(images), total=len(kept), mb=spent(),
                   est_mb=round(cube.estimate_bytes(len(kept), half) / 1e6, 1), incomplete=failed)
        if is_curated(slug_for(ra, dec, half, target)):
            job.update(state="done", slug=slug_for(ra, dec, half, target), kept=True, mb=spent())
            return
        out = package.build(target, ra, dec, half, None, 24, progress, images=kept, listed=len(images))
        job.update(state="done", slug=out.name, mb=spent(), done=len(kept))
    except BaseException as ex:
        job.update(state="error", code="offline" if isinstance(ex, net.OfflineError) else "failed", error=str(ex)[:200])
    finally:
        with _LOCK:
            _RUNNING.pop(key, None)


def start_build(ra: float, dec: float, half: int = 24, max_exp: int = MAX_EXPOSURES, target: str | None = None) -> str:
    if target:
        ra, dec = TARGETS[target]["center"]
    if not (math.isfinite(ra) and math.isfinite(dec) and -90.0 <= dec <= 90.0):
        raise BadRequest(f"not a sky position: ra={ra}, dec={dec}")
    key = (round(ra, 5), round(dec, 5), half, max_exp, target)
    slug = slug_for(ra, dec, half, target)
    with _LOCK:
        if key in _RUNNING:
            return _RUNNING[key]
        job_id = uuid.uuid4().hex[:10]
        if is_curated(slug):
            JOBS[job_id] = {"state": "done", "done": 0, "total": 0, "mb": 0.0, "slug": slug, "kept": True,
                            "note": "curated package; not rebuilt"}
            return job_id
        JOBS[job_id] = {"state": "listing", "done": 0, "total": 0, "mb": 0.0}
        _RUNNING[key] = job_id
    threading.Thread(target=_run, args=(job_id, key), daemon=True).start()
    return job_id


def count(ra: float, dec: float, half: int = 24, max_exp: int = MAX_EXPOSURES, target: str | None = None) -> dict:
    slug = slug_for(ra, dec, half, target)
    if is_curated(slug):
        return {"slug": slug, "kept": True}
    images, failed = cube.list_field(ra, dec, half)
    kept = cube.thin(images, max_exp)
    d = cube.field_dir(ra, dec, half)
    have = sum(1 for i in kept if (d / f"{i['obs_id']}_D{i['det']}.npz").exists())
    return {"slug": slug, "kept": False, "listed": len(images), "total": len(kept), "cached": have,
            "est_mb": round(cube.estimate_bytes(len(kept) - have, half) / 1e6, 1), "incomplete": failed}


class Handler(http.server.SimpleHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path in ("/api/build", "/api/count"):
            try:
                args = parse_request(q)
            except BadRequest as ex:
                return self._json({"error": str(ex)}, 400)
            if u.path == "/api/build":
                return self._json({"job": start_build(*args)})
            try:
                return self._json(count(*args))
            except net.OfflineError as ex:
                return self._json({"error": str(ex)[:200], "code": "offline"}, 503)
            except RuntimeError as ex:
                return self._json({"error": str(ex)[:200], "code": "archive"}, 502)
        if u.path == "/api/status":
            job = JOBS.get(q.get("job", [""])[0])
            return self._json(job or {"state": "error", "error": "unknown job"}, 200 if job else 404)
        if u.path == "/api/meter":
            return self._json(net.METER.snapshot())
        if u.path == "/api/log":
            log = cube.CACHE / "client.log"
            if "m" in q:
                cube.CACHE.mkdir(parents=True, exist_ok=True)
                with _LOCK, open(log, "a", encoding="utf-8") as f:
                    f.write(f"{time.strftime('%H:%M:%S')} {q['m'][0][:500]}\n")
                return self._json({"ok": True})
            lines = log.read_text(encoding="utf-8").splitlines()[-200:] if log.exists() else []
            return self._json({"lines": lines})
        return super().do_GET()

    def end_headers(self):
        if self.path.startswith("/data/") or self.path.split("?")[0].endswith((".js", ".html", ".css", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main(argv=None):
    _console.utf8_stdout()
    ap = argparse.ArgumentParser(prog="ektos.server")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--offline", action="store_true",
                    help=f"never use the network: builds come from the cache only (same as {net.OFFLINE_ENV}=1)")
    a = ap.parse_args(argv)
    if a.offline:
        os.environ[net.OFFLINE_ENV] = "1"
    handler = functools.partial(Handler, directory=str(WEB))
    Handler.extensions_map.update({".js": "text/javascript", ".f32": "application/octet-stream",
                                   ".woff2": "font/woff2"})
    srv = http.server.ThreadingHTTPServer((a.host, a.port), handler)
    print(f"Ektos: http://{a.host}:{a.port}/" + ("  (offline: cache only)" if net.offline() else ""), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
