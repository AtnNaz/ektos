from __future__ import annotations

import gc
import http.client
import os
import pathlib
import socket
import ssl
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import _console

OVERHEAD = 750
OFFLINE_ENV = "EKTOS_OFFLINE"
CONNECT_BUDGET = 60.0
DOWN_FOR = 60.0


class OfflineError(RuntimeError):
    pass


class HostDown(RuntimeError):
    pass


def offline() -> bool:
    return os.environ.get(OFFLINE_ENV, "").strip().lower() in ("1", "true", "yes", "on")


def require_online(what: str):
    if offline():
        raise OfflineError(f"{OFFLINE_ENV}=1: not fetching {what}")


def warn(msg: str):
    print(f"ektos: {msg}", file=sys.stderr, flush=True)


class Meter:
    def __init__(self):
        self._lock = threading.Lock()
        self.bytes = 0
        self.requests = 0
        self.retries = 0

    def add(self, nbytes: int, requests: int = 1):
        with self._lock:
            self.bytes += nbytes + OVERHEAD * requests
            self.requests += requests

    def retry(self):
        with self._lock:
            self.retries += 1

    def snapshot(self) -> dict:
        with self._lock:
            return {"bytes": self.bytes, "mb": round(self.bytes / 1e6, 2),
                    "requests": self.requests, "retries": self.retries}


METER = Meter()
_local = threading.local()


def _make_context() -> ssl.SSLContext:
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        return ssl.create_default_context()


_ctx = _make_context()

_LOOPBACK = ("localhost", "127.0.0.1", "::1")
_create_connection = getattr(socket.create_connection, "unguarded", socket.create_connection)


def _guarded_create_connection(address, *args, **kwargs):
    if offline() and str(address[0]).lower() not in _LOOPBACK:
        raise OfflineError(f"{OFFLINE_ENV}=1: not connecting to {address[0]}")
    return _create_connection(address, *args, **kwargs)


_guarded_create_connection.unguarded = _create_connection
socket.create_connection = _guarded_create_connection

if _console.entry_is_ektos():
    _console.utf8_stdout()

_down_lock = threading.Lock()
_down: dict[str, float] = {}


def _check_host(host: str):
    with _down_lock:
        until = _down.get(host)
        if until is not None and time.monotonic() >= until:
            del _down[host]
            until = None
    if until is not None:
        raise HostDown(f"{host} could not be reached; not trying again for {until - time.monotonic():.0f} s")


def _mark_down(host: str):
    with _down_lock:
        _down[host] = time.monotonic() + DOWN_FOR


def _retryable_status(status: int) -> bool:
    return not (400 <= status < 500) or status == 429


def _conn(host: str) -> http.client.HTTPSConnection:
    pool = getattr(_local, "pool", None)
    if pool is None:
        pool = _local.pool = {}
    c = pool.get(host)
    if c is None:
        c = pool[host] = http.client.HTTPSConnection(host, timeout=45, context=_ctx)
    return c


def _drop(host: str):
    pool = getattr(_local, "pool", {})
    c = pool.pop(host, None)
    if c is not None:
        try:
            c.close()
        except Exception:
            pass


def _give_up(attempt: int, retries: int, no_connect: bool, t0: float) -> bool:
    return attempt >= retries or (no_connect and time.monotonic() - t0 >= CONNECT_BUDGET)


def get_range(host: str, path: str, start: int | None = None, end: int | None = None,
              suffix: int | None = None, retries: int = 6) -> tuple[bytes, int | None]:
    require_online(f"https://{host}{path}")
    _check_host(host)
    rng = f"bytes=-{suffix}" if suffix is not None else f"bytes={start}-{end}"
    last, t0, attempt = None, time.monotonic(), 0
    while True:
        no_connect = False
        try:
            c = _conn(host)
            if c.sock is None:
                try:
                    c.connect()
                except OSError:
                    no_connect = True
                    raise
            c.request("GET", path, headers={"Range": rng, "Connection": "keep-alive"})
            r = c.getresponse()
            body = r.read()
            if r.status in (200, 206):
                METER.add(len(body))
                cr = r.getheader("Content-Range")
                total = int(cr.split("/")[1]) if cr and "/" in cr else None
                return body, total
            METER.add(len(body))
            last = RuntimeError(f"HTTP {r.status} for {path} [{rng}]")
            if not _retryable_status(r.status):
                raise last
        except (http.client.HTTPException, OSError, ssl.SSLError) as e:
            last = e
            _drop(host)
        attempt += 1
        if _give_up(attempt, retries, no_connect, t0):
            break
        METER.retry()
        time.sleep(min(8.0, 0.4 * 2 ** (attempt - 1)))
    if no_connect:
        _mark_down(host)
    raise RuntimeError(f"network failed after {attempt} tries: {last}")


def get_url(url: str, timeout: float = 90, retries: int = 4) -> bytes:
    require_online(url)
    host = urllib.parse.urlsplit(url).hostname or url
    _check_host(host)
    last, t0, attempt = None, time.monotonic(), 0
    while True:
        no_connect = False
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ektos-spherex/0.1"})
            with urllib.request.urlopen(req, timeout=timeout, context=_ctx) as r:
                body = r.read()
            METER.add(len(body))
            return body
        except OfflineError:
            raise
        except urllib.error.HTTPError as e:
            last = e
            if not _retryable_status(e.code):
                raise RuntimeError(f"GET failed: HTTP {e.code} {url} ({e.reason})") from e
        except urllib.error.URLError as e:
            last = e
            no_connect = True
        except Exception as e:
            last = e
        attempt += 1
        if _give_up(attempt, retries, no_connect, t0):
            break
        METER.retry()
        time.sleep(min(10.0, 1.0 * 2 ** (attempt - 1)))
    if no_connect:
        _mark_down(host)
    raise RuntimeError(f"GET failed after {attempt} tries: {url} ({last})")


def write_atomic(path, data: bytes | str | None = None, writer=None, encoding: str = "utf-8"):
    path = pathlib.Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            if writer is not None:
                writer(f)
            elif isinstance(data, str):
                f.write(data.replace("\n", os.linesep).encode(encoding))
            else:
                f.write(data)
        try:
            os.chmod(tmp, 0o644)
        except OSError:
            pass
        for i in range(8):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if i == 7:
                    raise
                time.sleep(0.05 * 2 ** i)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def describe(err: BaseException) -> str:
    return f"{type(err).__name__}: {str(err)[:80]}"


def drop_corrupt(path, why: str):
    path = pathlib.Path(path)
    for attempt in range(2):
        try:
            path.unlink()
            warn(f"cache file {path} could not be read ({why}); removed")
            return
        except FileNotFoundError:
            return
        except PermissionError as ex:
            if attempt == 0:
                gc.collect()
                continue
            warn(f"cache file {path} could not be read ({why}) and not removed ({ex})")
        except OSError as ex:
            warn(f"cache file {path} could not be read ({why}) and not removed ({ex})")
            return
