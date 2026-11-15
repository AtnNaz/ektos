from __future__ import annotations

import math
import sys

import numpy as np

from . import frames, phot

BOX = 7
HIT_RADIUS = 12.0
MARGIN = 30.0


class Mulberry32:
    def __init__(self, seed: int):
        self.a = seed & 0xFFFFFFFF

    @staticmethod
    def _imul(a: int, b: int) -> int:
        return (a * b) & 0xFFFFFFFF

    def random(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = self._imul(t ^ (t >> 15), t | 1)
        t ^= (t + self._imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


def inject(exps: list[dict], pos, flux) -> list[dict]:
    out = []
    for e in exps:
        p = pos(e)
        if p is None:
            out.append(e)
            continue
        col, row = phot._pixel_of(e, p[0], p[1])
        h, w = e["data"].shape
        c0, r0 = int(math.floor(col + 0.5)), int(math.floor(row + 0.5))
        ca, cb, ra, rb = max(0, c0 - BOX), min(w, c0 + BOX + 1), max(0, r0 - BOX), min(h, r0 + BOX + 1)
        if cb <= ca or rb <= ra:
            out.append(e)
            continue
        scale = np.sqrt(abs(np.linalg.det(e["M"])))
        fwhm = e["psf_fwhm"] if np.isfinite(e["psf_fwhm"]) else 8.0
        sg = fwhm * phot.FWHM2SIG / scale
        rr, cc = np.mgrid[ra:rb, ca:cb]
        psf = np.exp(-0.5 * ((cc - col) ** 2 + (rr - row) ** 2) / sg ** 2) / (2 * np.pi * sg ** 2)
        to_ujy = e["omega"] / phot.ARCSEC2_PER_SR * 1e12
        e2 = dict(e)
        data = e["data"].astype(np.float64)
        data[ra:rb, ca:cb] += flux(e) / to_ujy * psf
        e2["data"] = data.astype(np.float32)
        out.append(e2)
    return out


def flux_sigma(exps: list[dict], xi: float, eta: float) -> float:
    w = 0.0
    for e in exps:
        r = phot.forced_flux(e, xi, eta)
        if r is not None and r[1] > 0:
            w += 1.0 / r[1] ** 2
    return 1.0 / math.sqrt(w) if w > 0 else float("nan")


def make_trials(field_arcsec: float, seed: int = 1, snrs=(6.0, 10.0, 16.0), shifts=(3.0, 6.0, 12.0),
                reps: int = 1, catch: int = 3, flip: int = 0) -> list[dict]:
    rng = Mulberry32(seed)
    lim = field_arcsec / 2.0 - MARGIN
    cells = []
    for m in (0, 1):
        for s in snrs:
            for d in shifts:
                for _ in range(reps):
                    cells.append((m, float(s), float(d)))
        for _ in range(catch):
            cells.append((m, 0.0, 0.0))
    trials = []
    for i, (m, s, d) in enumerate(cells):
        u1, u2, u3, u4 = rng.random(), rng.random(), rng.random(), rng.random()
        trials.append({"id": i, "mode": "stereo" if (m + flip) % 2 else "blink", "snr": s, "shift": d,
                       "angle": 2.0 * math.pi * u1, "xi": (2.0 * u2 - 1.0) * lim, "eta": (2.0 * u3 - 1.0) * lim,
                       "key": u4})
    order = sorted(range(len(trials)), key=lambda i: trials[i]["key"])
    return [trials[i] for i in order]


def trial_positions(tr: dict):
    a = (tr["xi"], tr["eta"])
    return a, (a[0] + tr["shift"] * math.cos(tr["angle"]), a[1] + tr["shift"] * math.sin(tr["angle"]))


def build_trial(exps: list[dict], tr: dict, va: int, vb: int, lam):
    ea = [e for e in exps if e["v"] == va and lam[0] <= e["lam"] <= lam[1]]
    eb = [e for e in exps if e["v"] == vb and lam[0] <= e["lam"] <= lam[1]]
    if not tr["snr"]:
        return ea, eb, 0.0
    pa, pb = trial_positions(tr)
    sa, sb = flux_sigma(ea, *pa), flux_sigma(eb, *pb)
    if not (np.isfinite(sa) and np.isfinite(sb)):
        return ea, eb, float("nan")
    f = tr["snr"] * max(sa, sb)
    return inject(ea, lambda e: pa, lambda e: f), inject(eb, lambda e: pb, lambda e: f), f


def box_mean(img: np.ndarray) -> np.ndarray:
    n = img.shape[0]
    pad = np.full((n + 2, n + 2), np.nan)
    pad[1:-1, 1:-1] = img
    s, c = np.zeros((n, n)), np.zeros((n, n))
    for dr in (0, 1, 2):
        for dc in (0, 1, 2):
            v = pad[dr:dr + n, dc:dc + n]
            ok = np.isfinite(v)
            s += np.where(ok, v, 0.0)
            c += ok
    out = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    out[~np.isfinite(img)] = np.nan
    return out


def zmap(img_a: np.ndarray, img_b: np.ndarray) -> np.ndarray:
    d = box_mean(img_b.astype(np.float64) - img_a.astype(np.float64))
    v = d[np.isfinite(d)]
    if v.size < 50:
        return np.full(d.shape, np.nan)
    med = np.median(v)
    sig = 1.4826 * np.median(np.abs(v - med)) or 1e-30
    z = np.abs(d - med) / sig
    z[:3], z[-3:], z[:, :3], z[:, -3:] = np.nan, np.nan, np.nan, np.nan
    return z


def peak_near(z: np.ndarray, grid: frames.Grid, positions, radius: float = HIT_RADIUS) -> float:
    m = np.zeros(z.shape, bool)
    for x, y in positions:
        m |= np.hypot(grid.xi - x, grid.eta - y) <= radius
    v = z[m & np.isfinite(z)]
    return float(v.max()) if v.size else 0.0


def count_peaks(z: np.ndarray, threshold: float) -> int:
    n = z.shape[0]
    zz = np.where(np.isfinite(z), z, -1.0)
    pad = np.full((n + 4, n + 4), -1.0)
    pad[2:-2, 2:-2] = zz
    best = np.full((n, n), -1.0)
    for dr in range(5):
        for dc in range(5):
            if dr == 2 and dc == 2:
                continue
            best = np.maximum(best, pad[dr:dr + n, dc:dc + n])
    return int(((zz > threshold) & (zz > best)).sum())


def is_hit(tr: dict, xi: float, eta: float) -> bool:
    a, b = trial_positions(tr)
    return min(math.hypot(xi - a[0], eta - a[1]), math.hypot(xi - b[0], eta - b[1])) <= HIT_RADIUS


THRESHOLD = 5.0


def run(slug: str, reps: int = 10, seed: int = 1, va: int | None = None, vb: int | None = None,
        lam=(4.0, 5.03), threshold: float = THRESHOLD, verbose=True, snrs=(6.0, 10.0, 16.0), shifts=(3.0, 6.0, 12.0)) -> dict:
    from . import package
    man, exps = package.load_package(slug)
    exps = frames.prepare(exps)
    grid = frames.Grid(man["grid"]["n"] * man["grid"]["scale"])
    nvis = len(man["visits"])
    counts = [sum(1 for e in exps if e["v"] == v and lam[0] <= e["lam"] <= lam[1]) for v in range(nvis)]
    usable = [v for v in range(nvis) if counts[v] >= 8]
    chosen = va is None or vb is None
    if chosen and not usable:
        raise ValueError(f"{slug}: no visit has the 8 exposures in {lam[0]}-{lam[1]} um a plate needs "
                         f"(exposures per visit: {counts})")
    va = usable[0] if va is None else va
    vb = usable[-1] if vb is None else vb
    for v in (va, vb):
        if not 0 <= v < nvis or counts[v] == 0:
            raise ValueError(f"{slug}: visit {v} has no exposures in {lam[0]}-{lam[1]} um (exposures per visit: {counts})")
    if chosen and va == vb:
        raise ValueError(f"{slug}: a plate pair needs two visits with at least 8 exposures in {lam[0]}-{lam[1]} um; "
                         f"only visit {va} has that (exposures per visit: {counts})")
    say = print if verbose else (lambda *a, **k: None)
    trials = [t for t in make_trials(grid.n * grid.scale, seed, snrs=snrs, shifts=shifts, reps=reps, catch=0) if t["mode"] == "blink"]
    ea, eb, _ = build_trial(exps, {"snr": 0}, va, vb, lam)
    a0, _, _ = frames.combine(ea, grid)
    b0, _, _ = frames.combine(eb, grid)
    z0 = zmap(a0, b0)
    false_peaks = count_peaks(z0, threshold)
    say(f"{slug}: epochs {va} ({counts[va]} exposures) and {vb} ({counts[vb]}), window {lam[0]}-{lam[1]} um, threshold {threshold} sigma")
    say(f"  empty plate pair (control b): {false_peaks} candidates above the threshold, strongest {np.nanmax(z0):.1f} sigma")
    rows, cells = [], {}
    for tr in trials:
        xa, xb, f = build_trial(exps, tr, va, vb, lam)
        if not np.isfinite(f):
            continue
        ia, _, _ = frames.combine(xa, grid)
        ib, _, _ = frames.combine(xb, grid)
        pos = trial_positions(tr)
        z1, zc = peak_near(zmap(ia, ib), grid, pos), peak_near(z0, grid, pos)
        already = zc > threshold
        found = z1 > threshold and not already
        rows.append({**{k: tr[k] for k in ("id", "snr", "shift", "angle", "xi", "eta")}, "flux": f, "z": z1,
                     "z_control": zc, "found": bool(found), "already": bool(already)})
        c = cells.setdefault((tr["snr"], tr["shift"]), [0, 0, 0, 0.0])
        c[0] += 1; c[1] += found; c[2] += already; c[3] += f
    say("  formal S/N  shift   found     already there (control a)   mean flux")
    for (s_, d), (n, h, ch, fs) in sorted(cells.items()):
        say(f"     {s_:5.0f}   {d:4.0f}\"   {h:3d}/{n:<3d}         {ch:3d}/{n:<3d}             {fs / n:7.0f} uJy")
    return {"slug": slug, "va": va, "vb": vb, "lam": list(lam), "threshold": threshold, "false_peaks": false_peaks,
            "strongest": float(np.nanmax(z0)), "trials": rows, "cells": [{"snr": s_, "shift": d, "n": n, "found": h, "already": ch, "flux": fs / n}
                                      for (s_, d), (n, h, ch, fs) in sorted(cells.items())]}


LIMIT_SNRS = (4.0, 6.0, 8.0, 12.0, 16.0, 24.0)


def limit(slug: str, va: int | None = None, vb: int | None = None, lam=(4.0, 5.03), seed: int = 1, reps: int = 12,
          shift: float = 12.0, snrs=LIMIT_SNRS, need: float = 0.9, verbose=True) -> dict:
    m = run(slug, reps=reps, seed=seed, va=va, vb=vb, lam=lam, verbose=False, snrs=snrs, shifts=(shift,))
    if m["va"] == m["vb"]:
        raise SystemExit(f"{slug}: the limit needs two visits with data in this window; only visit {m['va']} has enough")
    level = None
    for c in reversed(m["cells"]):
        if c["n"] and c["found"] / c["n"] >= need:
            level = c
        else:
            break
    if verbose:
        print(f"{slug}: visits {m['va']} and {m['vb']}, window {lam[0]}-{lam[1]} um, sources moved by {shift:g} arcsec")
        for c in m["cells"]:
            print(f"   {c['flux']:8.0f} uJy (S/N {c['snr']:g}): found {c['found']}/{c['n']}, already there {c['already']}/{c['n']}")
        print(f"   candidates above {m['threshold']:g} sigma on the empty pair: {m['false_peaks']}")
        print("   limit: " + (f"{level['flux']:.0f} uJy ({level['found']}/{level['n']})" if level else f"none: no level reaches {need:.0%}"))
    return {"slug": slug, "va": m["va"], "vb": m["vb"], "lam": list(lam), "shift": shift, "need": need, "threshold": m["threshold"],
            "false_peaks": m["false_peaks"], "strongest": m["strongest"], "cells": m["cells"], "level": level}


if __name__ == "__main__":
    import argparse

    from . import _console
    _console.utf8_stdout()
    ap = argparse.ArgumentParser(prog="ektos.inject")
    ap.add_argument("slug", nargs="?", default="wise0855")
    ap.add_argument("--reps", type=int, default=10, help="trials per (S/N, shift) cell and display mode")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--a", type=int, default=None)
    ap.add_argument("--b", type=int, default=None)
    ap.add_argument("--lam", default="4.0-5.03")
    ap.add_argument("--limit", action="store_true", help="the sensitivity limit of the pair instead of the detection table")
    a = ap.parse_args()
    lo, hi = (float(x) for x in a.lam.split("-"))
    try:
        if a.limit:
            limit(a.slug, va=a.a, vb=a.b, lam=(lo, hi), seed=a.seed)
        else:
            run(a.slug, reps=a.reps, seed=a.seed, va=a.a, vb=a.b, lam=(lo, hi))
    except ValueError as ex:
        sys.exit(f"ektos.inject: {ex}")
    sys.exit(0)
