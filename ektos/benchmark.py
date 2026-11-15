from __future__ import annotations

import json
import math
import sys

import numpy as np

from . import frames, inject, net, package
from .geom import propagate, tan_project

NUM, DEN = (4.0, 5.03), (3.0, 3.8)
THRESHOLD = inject.THRESHOLD
RADIUS = 6.15
KEEP_OUT = 20.0
N_RANDOM = 200
MAX_DRAWS = 50 * N_RANDOM
SCAN = (3.0, 4.0, 5.0, 6.0, 8.0)


def cold_map(man: dict, exps: list[dict], grid: frames.Grid):
    sw, swx, ks = np.zeros((grid.n, grid.n)), np.zeros((grid.n, grid.n)), []
    for v, vis in enumerate(man["visits"]):
        a = [e for e in exps if e["v"] == v and NUM[0] <= e["lam"] <= NUM[1]]
        b = [e for e in exps if e["v"] == v and DEN[0] <= e["lam"] <= DEN[1]]
        if len(a) < 3 or len(b) < 3:
            continue
        ia, ea, _ = frames.combine(a, grid)
        ib, eb, _ = frames.combine(b, grid)
        col = vis.get("star_colour_w2w1")
        k = col["k"] if col else 0.6
        img, err = ia - k * ib, np.hypot(ea, k * eb)
        ok = np.isfinite(img) & np.isfinite(err) & (err > 0)
        w = np.where(ok, 1.0 / np.where(ok, err, 1.0) ** 2, 0.0)
        sw += w
        swx += np.where(ok, w * img, 0.0)
        ks.append(k)
    return np.where(sw > 0, swx / np.maximum(sw, 1e-300), np.nan), len(ks), ks


def window_map(exps: list[dict], grid: frames.Grid, lam) -> np.ndarray:
    sel = [e for e in exps if lam[0] <= e["lam"] <= lam[1]]
    if len(sel) < 3:
        return np.full((grid.n, grid.n), np.nan)
    return frames.combine(sel, grid)[0]


def snr_map(img: np.ndarray) -> np.ndarray:
    d = inject.box_mean(img)
    v = d[np.isfinite(d)]
    if v.size < 50:
        return np.full(d.shape, np.nan)
    med = np.median(v)
    sig = 1.4826 * np.median(np.abs(v - med)) or 1e-30
    z = (d - med) / sig
    z[:3], z[-3:], z[:, :3], z[:, -3:] = np.nan, np.nan, np.nan, np.nan
    return z


def alarms(z: np.ndarray, grid: frames.Grid, threshold: float) -> list[tuple[float, float, float]]:
    n = z.shape[0]
    zz = np.where(np.isfinite(z), z, -1e9)
    pad = np.full((n + 4, n + 4), -1e9)
    pad[2:-2, 2:-2] = zz
    best = np.full((n, n), -1e9)
    for dr in range(5):
        for dc in range(5):
            if dr == 2 and dc == 2:
                continue
            best = np.maximum(best, pad[dr:dr + n, dc:dc + n])
    r, c = np.nonzero((zz >= threshold) & (zz > best))
    return sorted(((float(grid.xi[i, j]), float(grid.eta[i, j]), float(zz[i, j])) for i, j in zip(r, c)), key=lambda t: -t[2])


def near_max(z: np.ndarray, grid: frames.Grid, positions, radius: float = RADIUS) -> float:
    m = np.zeros(z.shape, bool)
    for x, y in positions:
        m |= np.hypot(grid.xi - x, grid.eta - y) <= radius
    v = z[m & np.isfinite(z)]
    return float(v.max()) if v.size else float("nan")


def _rate(k: int, n: int):
    return k / n if n else None


def _pct(rate, fmt: str) -> str:
    return "n/a" if rate is None else f"{100 * rate:{fmt}}%"


def wilson(k: int, n: int, zq: float = 1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    den = 1 + zq * zq / n
    mid, half = (p + zq * zq / (2 * n)) / den, zq * math.sqrt(p * (1 - p) / n + zq * zq / (4 * n * n)) / den
    return (max(0.0, mid - half), min(1.0, mid + half))


def field(slug: str, seed: int = 1) -> dict | None:
    man, exps = package.load_package(slug)
    exps = frames.prepare(exps)
    grid = frames.Grid(man["grid"]["n"] * man["grid"]["scale"])
    img, n_vis, ks = cold_map(man, exps, grid)
    if not n_vis:
        return {"slug": slug, "name": man["name"], "kind": man.get("kind", ""), "status": "no visit with both windows"}
    z = snr_map(img)
    ast, c = man["astrometry"], man["center"]
    if not ast:
        return {"slug": slug, "name": man["name"], "kind": man.get("kind", ""), "status": "no catalogue position"}
    used = [v for v in man["visits"] if v["n"] >= 6]
    if not used:
        return {"slug": slug, "name": man["name"], "kind": man.get("kind", ""), "status": "no visit with 6 exposures"}
    track = []
    for v in used:
        ra, dec = propagate(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], v["mjd"], ast.get("plx", 0.0))
        x, y = tan_project(ra[0], dec[0], c[0], c[1])
        track.append((float(x), float(y)))
    span = (used[-1]["mjd"] - used[0]["mjd"]) / 365.25 if len(used) > 1 else 0.0
    zt = near_max(z, grid, track)
    al = alarms(z, grid, min(SCAN))
    zd = snr_map(window_map(exps, grid, DEN))
    seen = lambda pts: (near_max(zd, grid, pts) >= THRESHOLD)
    zt_seen = bool(seen(track))
    away = lambda x, y: min(math.hypot(x - a, y - b) for a, b in track)
    rng = np.random.default_rng(seed)
    lim = (grid.n - 1) / 2 * grid.scale - 4 * grid.scale
    rand, rand_dark, draws = [], [], 0
    while len(rand) < N_RANDOM and draws < MAX_DRAWS:
        draws += 1
        x, y = rng.uniform(-lim, lim, 2)
        if away(x, y) < KEEP_OUT:
            continue
        v = near_max(z, grid, [(x, y)])
        if math.isfinite(v):
            rand.append(v)
            rand_dark.append(-1e9 if seen([(x, y)]) else v)
    rand, rand_dark = np.array(rand), np.array(rand_dark)
    area = float(np.isfinite(z).sum()) * grid.scale ** 2 / 3600.0
    top = al[0] if al else None
    return {
        "slug": slug, "name": man["name"], "kind": man.get("kind", ""), "status": "ok",
        "n_exp": len(exps), "n_visits": n_vis, "k": [round(k, 3) for k in ks], "k_default": all(v.get("star_colour_w2w1") is None for v in man["visits"]),
        "track": track, "motion": float(math.hypot(ast["pmra"], ast["pmdec"]) * span), "area": area,
        "z_target": zt,
        "rank": 1 + sum(1 for x, y, s in al if away(x, y) > RADIUS and s > zt) if math.isfinite(zt) else None,
        "top_is_target": bool(top and away(top[0], top[1]) <= RADIUS),
        "false": {str(t): sum(1 for x, y, s in al if s >= t and away(x, y) > KEEP_OUT) for t in SCAN},
        "random": {str(t): int((rand >= t).sum()) for t in SCAN}, "n_random": int(len(rand)),
        "seen_at_3um": zt_seen,
        "false_dark": {str(t): sum(1 for x, y, s in al if s >= t and away(x, y) > KEEP_OUT and not seen([(x, y)])) for t in SCAN},
        "random_dark": {str(t): int((rand_dark >= t).sum()) for t in SCAN},
    }


def run(root=None, verbose=True) -> dict:
    say = print if verbose else (lambda *a, **k: None)
    index = json.loads((package.WEB / "index.json").read_text(encoding="utf-8"))
    slugs = sorted(s for s, f in index.items() if f.get("group") == "ydwarf")
    extra = {}
    if root:
        try:
            from . import ydwarfs
            extra = {"y_" + t["dir"]: t for t in ydwarfs.targets(root)}
        except OSError:
            extra = {}
    rows = []
    for s in slugs:
        r = field(s)
        t = extra.get(s)
        if t:
            r["w2"], r["glat"], r["teff"] = t["w2"], t["glat"], t["teff"]
        rows.append(r)
        if r["status"] != "ok":
            say(f"{r['name']:34s} {r['status']}")
            continue
        say(f"{r['name']:34s} W2 {r.get('w2') or float('nan'):5.2f}  z at the dwarf {r['z_target']:+6.1f}  rank {r['rank']}"
            f"  false alarms >=5: {r['false']['5.0']:2d}  empty positions >=5: {r['random']['5.0']:3d}/{r['n_random']}")
    ok = [r for r in rows if r["status"] == "ok" and math.isfinite(r["z_target"])]
    if not ok:
        raise ValueError(f"benchmark: none of the {len(rows)} Y dwarf fields could be scored")
    scan = {}
    for t in SCAN:
        caught = sum(1 for r in ok if r["z_target"] >= t)
        nf = sum(r["false"][str(t)] for r in ok)
        kr, nr = sum(r["random"][str(t)] for r in ok), sum(r["n_random"] for r in ok)
        scan[str(t)] = {"caught": caught, "of": len(ok), "caught_ci": wilson(caught, len(ok)),
                        "false_alarms": nf, "false_per_field": nf / len(ok), "false_per_arcmin2": nf / sum(r["area"] for r in ok),
                        "fields_without_false": sum(1 for r in ok if r["false"][str(t)] == 0),
                        "random_hits": kr, "random_n": nr, "random_rate": _rate(kr, nr), "random_ci": wilson(kr, nr)}
        cd = sum(1 for r in ok if r["z_target"] >= t and not r["seen_at_3um"])
        fd, kd = sum(r["false_dark"][str(t)] for r in ok), sum(r["random_dark"][str(t)] for r in ok)
        scan[str(t)]["dark"] = {"caught": cd, "caught_ci": wilson(cd, len(ok)), "false_alarms": fd, "false_per_field": fd / len(ok),
                                "false_per_arcmin2": fd / sum(r["area"] for r in ok),
                                "fields_without_false": sum(1 for r in ok if r["false_dark"][str(t)] == 0),
                                "random_hits": kd, "random_rate": _rate(kd, nr), "random_ci": wilson(kd, nr)}
    res = {"threshold": THRESHOLD, "radius": RADIUS, "keep_out": KEEP_OUT, "windows": {"num": NUM, "den": DEN},
           "n_fields": len(rows), "n_scored": len(ok), "scan": scan, "fields": rows}
    net.write_atomic(package.WEB / "benchmark.json", json.dumps(res, separators=(",", ":"), allow_nan=False, default=float))
    m = scan[str(THRESHOLD)]
    say(f"\n{m['caught']} of {m['of']} known Y dwarfs have an alarm (>= {THRESHOLD:g} sigma) within {RADIUS} arcsec;"
        f" 95% interval {100 * m['caught_ci'][0]:.0f}-{100 * m['caught_ci'][1]:.0f}%")
    say(f"control, the same test at {m['random_n']} empty positions: {m['random_hits']} pass = {_pct(m['random_rate'], '.2f')}"
        f" (95% interval {100 * m['random_ci'][0]:.2f}-{100 * m['random_ci'][1]:.2f}%)")
    say(f"false alarms elsewhere: {m['false_alarms']} in {m['of']} fields = {m['false_per_field']:.2f} per field,"
        f" {m['false_per_arcmin2']:.3f} per square arcminute; {m['fields_without_false']} fields have none")
    say("threshold  caught   false/field   empty positions passing   |  second pass (dark at 3.0-3.8 um): caught, false/field, empty passing, fields with no false alarm")
    for t in SCAN:
        m = scan[str(t)]
        d = m["dark"]
        say(f"   {t:4.1f}    {m['caught']:2d}/{m['of']}     {m['false_per_field']:6.2f}        {_pct(m['random_rate'], '5.2f')}"
            f"              |  {d['caught']:2d}/{m['of']}   {d['false_per_field']:5.2f}   {_pct(d['random_rate'], '5.2f')}   {d['fields_without_false']}")
    miss = [r for r in ok if r["z_target"] < THRESHOLD]
    say("missed at 5 sigma: " + "; ".join(f"{r['name']} (W2 {r.get('w2')}, b {r.get('glat')}, z {r['z_target']:+.1f})" for r in miss))
    w2 = sorted((r["w2"], r["z_target"] >= THRESHOLD) for r in ok if r.get("w2"))
    for cut in (14.5, 15.0, 15.5, 16.0, 16.5):
        sub = [c for m_, c in w2 if m_ <= cut]
        say(f"   W2 <= {cut}: {sum(sub)} of {len(sub)} caught")
    return res


def is_t_dwarf(f: dict) -> bool:
    return str(f.get("kind", "")).lstrip().startswith("T")


def summary(verbose=True) -> dict:
    b = json.loads((package.WEB / "benchmark.json").read_text(encoding="utf-8"))
    ok = [f for f in b["fields"] if f.get("status") == "ok"]
    groups = {"all": ok, "Y": [f for f in ok if not is_t_dwarf(f)], "T": [f for f in ok if is_t_dwarf(f)]}
    say = print if verbose else (lambda *a, **k: None)
    out = {}
    for name, fs in groups.items():
        rows = {}
        for t in (str(x) for x in SCAN):
            th = float(t)
            caught = sum(1 for f in fs if f.get("z_target") is not None and f["z_target"] >= th)
            fa = sum(f["false"][t] for f in fs)
            rh, rn = sum(f["random"][t] for f in fs), sum(f["n_random"] for f in fs)
            dark = sum(1 for f in fs if f.get("z_target") is not None and f["z_target"] >= th and not f["seen_at_3um"])
            rows[t] = {"caught": caught, "of": len(fs), "caught_ci": wilson(caught, len(fs)),
                       "false_per_field": _rate(fa, len(fs)), "random_hits": rh, "random_n": rn, "random_rate": _rate(rh, rn),
                       "dark_caught": dark, "dark_false_per_field": _rate(sum(f["false_dark"][t] for f in fs), len(fs)),
                       "dark_random_rate": _rate(sum(f["random_dark"][t] for f in fs), rn)}
        by_w2 = {str(w): [sum(1 for f in fs if f["w2"] <= w and f["z_target"] >= THRESHOLD), sum(1 for f in fs if f["w2"] <= w)]
                 for w in (14.5, 15.0, 15.5, 16.0, 16.5)}
        out[name] = {"n": len(fs), "scan": rows, "by_w2": by_w2,
                     "top_is_target": sum(1 for f in fs if f.get("top_is_target"))}
        r = rows[str(THRESHOLD)]
        say(f"{name:>3} ({len(fs)} fields): {r['caught']}/{r['of']} caught at {THRESHOLD:g} sigma "
            f"(95% {100 * r['caught_ci'][0]:.0f}-{100 * r['caught_ci'][1]:.0f}%), {r['false_per_field'] or 0:.2f} false alarms per field, "
            f"blank positions {_pct(r['random_rate'], '.1f')}; dark at 3-3.8 um: {r['dark_caught']} caught, "
            f"{r['dark_false_per_field'] or 0:.2f} false per field; by W2: "
            + ", ".join(f"<={w} {c}/{n}" for w, (c, n) in by_w2.items()))
    for t in (str(x) for x in SCAN):
        if out["all"]["scan"][t]["caught"] != b["scan"][t]["caught"]:
            raise RuntimeError(f"summary does not reproduce the stored scan at {t} sigma")
    say("T dwarfs: " + ", ".join(f"{f['name']} ({f['kind'].split(',')[0]})" for f in groups["T"]))
    return out


if __name__ == "__main__":
    from . import _console
    from .ydwarfs import DATA_ROOT
    _console.utf8_stdout()
    if sys.argv[1:2] == ["summary"]:
        summary()
        sys.exit(0)
    try:
        run(sys.argv[1] if len(sys.argv) > 1 else DATA_ROOT)
    except ValueError as ex:
        sys.exit(f"ektos.benchmark: {ex}")
