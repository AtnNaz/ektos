from __future__ import annotations

import json
import math
import sys

import numpy as np

from . import frames, inject, package, phot
from .geom import parallax_factors, propagate, tan_project

STEP = 5


def _clean(v):
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, (float, np.floating)):
        return float(v) if math.isfinite(v) else None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


FIELDS = [("wise0855_h40", 1, 2, (4.0, 5.03)), ("rdra", 2, 3, (1.3, 1.7)), ("luhman16", 0, 1, (1.0, 2.0)),
          ("smdet1", 1, 2, (4.4, 5.03)), ("epsindib", 0, 3, (4.0, 5.03))]
MAX_FITS = 8


def fit_at_bound(f: dict, x0: float, y0: float, box: float = 22.0) -> bool:
    s = f["fwhm"] * phot.FWHM2SIG
    return (abs(f["xi"] - x0) >= box / 2 - 0.05 or abs(f["eta"] - y0) >= box / 2 - 0.05
            or s <= 2.01 or s >= 7.99 or f["amp"] <= 0)


def field_reference(slug: str, va: int, vb: int, lam) -> dict:
    man, exps = package.load_package(slug)
    used = frames.prepare(exps)
    grid = frames.Grid(man["grid"]["n"] * man["grid"]["scale"])
    in_win = lambda e, v: e["v"] == v and lam[0] <= e["lam"] <= lam[1]
    ea = [e for e in used if in_win(e, va)]
    img, err, cnt = frames.combine(ea, grid)
    seeds = [(s["xi"], s["eta"]) for s in man["ref_stars"][:MAX_FITS]]
    ast = man.get("astrometry")
    if ast:
        ra, dec = propagate(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], man["visits"][va]["mjd"], 0.0)
        seeds.append(tuple(float(x) for x in tan_project(ra[0], dec[0], man["center"][0], man["center"][1])))
    fits, at_bound = [], []
    for x, y in seeds:
        f = phot.fit_centroid(img, err, grid, x, y)
        fits.append(None if f is None else [f[k] for k in ("xi", "eta", "e_xi", "e_eta", "amp", "fwhm", "snr", "chi2r")])
        at_bound.append(f is not None and fit_at_bound(f, x, y))
    px, py = seeds[0] if seeds else (0.0, 0.0)
    forced = [phot.forced_flux(e, px, py) for e in ea]
    return {"slug": slug, "va": va, "vb": vb, "lam": list(lam), "n_all": len(exps), "n_used": len(used),
            "n_window": len(ea), "dropped": [i for i, e in enumerate(exps) if not any(e is u for u in used)],
            "stack": {"img": img[::STEP, ::STEP].ravel().tolist(), "err": err[::STEP, ::STEP].ravel().tolist(),
                      "cnt": cnt[::STEP, ::STEP].ravel().tolist()},
            "noise_scale": frames.noise_scale(img, err),
            "seeds": [list(s) for s in seeds], "fits": fits, "at_bound": at_bound,
            "forced": {"xi": px, "eta": py, "flux": [f[0] if f else None for f in forced], "err": [f[1] if f else None for f in forced]}}


def reference(slug: str = "wise0855", va: int = 1, vb: int = 2, lam=(4.0, 5.03)) -> dict:
    man, exps = package.load_package(slug)
    exps = frames.prepare(exps)
    grid = frames.Grid(man["grid"]["n"] * man["grid"]["scale"])
    in_win = lambda e, v: e["v"] == v and lam[0] <= e["lam"] <= lam[1]
    ea, eb = [e for e in exps if in_win(e, va)], [e for e in exps if in_win(e, vb)]
    img, err, _ = frames.combine(ea, grid)

    ast = man.get("astrometry")
    if ast:
        ra, dec = propagate(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], man["visits"][va]["mjd"], 0.0)
        px, py = (float(x) for x in tan_project(ra[0], dec[0], man["center"][0], man["center"][1]))
    else:
        px, py = 20.0, -15.0
    forced = [phot.forced_flux(e, px, py) for e in ea]

    trials = inject.make_trials(grid.n * grid.scale, seed=1)
    tr = next(t for t in trials if t["snr"] >= 10 and t["shift"] >= 6)
    xa, xb, flux = inject.build_trial(exps, tr, va, vb, lam)
    ia, _, _ = frames.combine(xa, grid)
    ib, _, _ = frames.combine(xb, grid)
    pa, pb = inject.trial_positions(tr)
    z = inject.zmap(ia, ib)
    recovered = []
    for e, o in zip(xa, ea):
        fo = phot.forced_flux(o, *pa)
        if fo:
            recovered.append(phot.forced_flux(e, *pa)[0] - fo[0])
    mach = inject.run(slug, reps=3, seed=1, va=va, vb=vb, lam=lam, verbose=False)

    plx_mjd = [m["mjd"] for m in man["exposures"][::max(1, len(man["exposures"]) // 12)]] + [55200.0, 58000.0, 61000.0]
    plx_a, plx_d = parallax_factors(man["center"][0], man["center"][1], np.array(plx_mjd))

    return _clean({
        "slug": slug, "va": va, "vb": vb, "lam": list(lam), "step": STEP,
        "parallax": {"ra": man["center"][0], "dec": man["center"][1], "mjd": plx_mjd, "pa": list(plx_a), "pd": list(plx_d)},
        "fields": [field_reference(*f) for f in FIELDS],
        "stack": {"n_exp": len(ea), "img": img[::STEP, ::STEP].ravel().tolist(), "err": err[::STEP, ::STEP].ravel().tolist()},
        "forced": {"xi": px, "eta": py, "flux": [f[0] if f else None for f in forced], "err": [f[1] if f else None for f in forced]},
        "grid_n": {str(f): frames.Grid(float(f)).n for f in range(60, 500, 20)},
        "trials": [{k: t[k] for k in ("id", "mode", "snr", "shift", "angle", "xi", "eta")} for t in trials],
        "inject": {"trial": tr["id"], "flux": flux,
                   "sigma_a": inject.flux_sigma(ea, *pa), "sigma_b": inject.flux_sigma(eb, *pb),
                   "img_a": ia[::STEP, ::STEP].ravel().tolist(), "img_b": ib[::STEP, ::STEP].ravel().tolist(),
                   "recovered_a": recovered,
                   "z": z[::STEP, ::STEP].ravel().tolist(), "z_peak": inject.peak_near(z, grid, (pa, pb))},
        "machine": {"threshold": mach["threshold"], "false_peaks": mach["false_peaks"],
                    "trials": [{k: t[k] for k in ("id", "flux", "z", "z_control", "found", "already")} for t in mach["trials"]],
                    "cells": mach["cells"]},
    })


if __name__ == "__main__":
    ref = reference(sys.argv[1] if len(sys.argv) > 1 else "wise0855")
    out = package.WEB / "parity.json"
    out.write_text(json.dumps(ref, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    rec = ref["inject"]["recovered_a"]
    print(f"wrote {out}: stack of {ref['stack']['n_exp']} exposures, {len(ref['trials'])} trials, "
          f"{len(ref['machine']['trials'])} machine-observer trials")
    print(f"closed loop: injected {ref['inject']['flux']:.2f} uJy, forced photometry recovers "
          f"{min(rec):.2f} .. {max(rec):.2f} uJy more than without the source ({len(rec)} exposures)")
