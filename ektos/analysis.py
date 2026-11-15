from __future__ import annotations

import json
import sys

import numpy as np

from . import catalogs, cube, frames, motion, net, package, phot
from .geom import mjd_to_year, propagate, tan_project
from .targets import TARGETS

FLOOR = 0.10


def spherex_epochs(exps, grid, center, ast, gaia, stars, deblend=True, band="W2s"):
    out = []
    for v in frames.split_visits(exps):
        sel = frames.select(v, band)
        if len(sel) < 5:
            continue
        mjd = float(np.mean([e["mjd"] for e in sel]))
        img, err, _ = frames.combine(sel, grid)
        ra, dec = propagate(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], mjd, 0.0)
        px, py = (float(x) for x in tan_project(ra[0], dec[0], center[0], center[1]))
        k = None
        timg, terr = img, err
        if deblend:
            col = package.star_colour(v, grid, stars, exclude=(px, py))
            if col is not None:
                k = col[0]
                w1, e1, _ = frames.combine(frames.select(v, "W1s"), grid)
                timg, terr = img - k * w1, np.sqrt(err ** 2 + (k * e1) ** 2)
        f = phot.fit_centroid(timg, terr, grid, px, py, box_arcsec=20.0)
        if f is None or f["snr"] < 4:
            continue
        gx, gy, _ = motion.gaia_at(gaia, mjd, center, gmax=17.5)
        offs = []
        for x, y in zip(gx, gy):
            if abs(x) > grid.n * grid.scale / 2 - 25 or abs(y) > grid.n * grid.scale / 2 - 25:
                continue
            if np.hypot(x - px, y - py) < 14 or np.sum(np.hypot(gx - x, gy - y) < 12) > 1:
                continue
            s = phot.fit_centroid(img, err, grid, x, y, box_arcsec=18.0)
            if s and s["snr"] > 8 and np.hypot(s["xi"] - x, s["eta"] - y) < 2.5:
                offs.append((s["xi"] - x, s["eta"] - y, s["e_xi"], s["e_eta"]))
        if len(offs) >= 3:
            o = np.array(offs)
            ox, oy = float(np.median(o[:, 0])), float(np.median(o[:, 1]))
            eox = float(1.4826 * np.median(np.abs(o[:, 0] - ox)) / np.sqrt(len(o)))
            eoy = float(1.4826 * np.median(np.abs(o[:, 1] - oy)) / np.sqrt(len(o)))
        else:
            ox = oy = 0.0
            eox = eoy = 0.2
        out.append({"mjd": mjd, "xi": f["xi"] - ox, "eta": f["eta"] - oy,
                    "e_xi": float(np.sqrt(f["e_xi"] ** 2 + eox ** 2 + FLOOR ** 2)),
                    "e_eta": float(np.sqrt(f["e_eta"] ** 2 + eoy ** 2 + FLOOR ** 2)),
                    "n": len(sel), "n_ref": len(offs), "off_xi": ox, "off_eta": oy, "snr": f["snr"],
                    "raw_xi": f["xi"], "raw_eta": f["eta"], "k": k, "src": "SPHEREx"})
    return out


def fit_all(wise, spx, ast, center, show) -> None:
    if len(wise) >= 6:
        show("WISE only, no parallax", motion.fit5(wise, ast["ra"], ast["dec"], center, fit_plx=False))
        show("WISE only", motion.fit5(wise, ast["ra"], ast["dec"], center))
    if len(wise) >= 16:
        w = sorted(wise, key=lambda e: e["mjd"])
        show("WISE first half", motion.fit5(w[:len(w) // 2], ast["ra"], ast["dec"], center))
        show("WISE second half", motion.fit5(w[len(w) // 2:], ast["ra"], ast["dec"], center))
    if len(spx) >= 3:
        show("SPHEREx only, no parallax", motion.fit5(spx, ast["ra"], ast["dec"], center, fit_plx=False))
    if len(spx) >= 4 and len(wise) < 6:
        show("SPHEREx only", motion.fit5(spx, ast["ra"], ast["dec"], center))
    if len(wise) >= 6 and spx:
        show("WISE + SPHEREx", motion.fit5(wise + spx, ast["ra"], ast["dec"], center))


def half_split_systematic(fits: dict) -> dict | None:
    a, b = fits.get("WISE first half"), fits.get("WISE second half")
    if not a or not b or "plx" not in a or "plx" not in b:
        return None
    d = a["plx"] - b["plx"]
    noise = float(np.hypot(a["e_plx"], b["e_plx"]))
    return {"first": a["plx"], "second": b["plx"], "difference": float(d), "noise": noise,
            "n_sigma": float(abs(d) / noise), "systematic": float(np.sqrt(max(0.0, d * d - noise * noise)) / 2)}


def _report_systematic(res, say):
    s = half_split_systematic(res["fits"])
    if s:
        res["plx_systematic"] = s
        say(f"  parallax of the two WISE halves {s['first']:.3f} and {s['second']:.3f}: difference {s['difference']:+.3f}"
            f" = {s['n_sigma']:.1f} sigma of their noise {s['noise']:.3f} -> systematic +-{s['systematic']:.3f} arcsec")
    if "WISE only" in res["fits"] and "WISE + SPHEREx" in res["fits"]:
        w, ws = res["fits"]["WISE only"], res["fits"]["WISE + SPHEREx"]
        say(f"  SPHEREx's share: adding its epochs moves the parallax by {ws['plx'] - w['plx']:+.4f} arcsec"
            f" and its error from {w['e_plx']:.4f} to {ws['e_plx']:.4f}")


def _shower(res, say):
    def show(name, f):
        res["fits"][name] = f
        s = f"  {name:34s} mu_a={f['pm_xi']:+.4f}+-{f['e_pm_xi']:.4f}  mu_d={f['pm_eta']:+.4f}+-{f['e_pm_eta']:.4f}"
        if "plx" in f:
            s += f"  plx={f['plx']:.3f}+-{f['e_plx']:.3f} -> {1 / f['plx']:.2f} pc"
        say(s + f"  chi2/dof={f['chi2']:.1f}/{f['dof']}")
    return show


def refit(key: str, verbose=True) -> dict:
    path = package.WEB / key / "analysis.json"
    res = json.loads(path.read_text(encoding="utf-8"))
    T = TARGETS[key]
    say = print if verbose else (lambda *a, **k: None)
    res["fits"] = {}
    fit_all(res.get("wise_epochs", []), res.get("spherex_epochs", []), T["astrometry"], T["center"], _shower(res, say))
    _report_systematic(res, say)
    net.write_atomic(path, json.dumps(res, separators=(",", ":")))
    return res


def astrometry(key: str, verbose=True) -> dict:
    T = TARGETS[key]
    center, ast = T["center"], T["astrometry"]
    exps = frames.prepare(cube.fetch_field(center[0], center[1], 24))
    grid = frames.Grid(49 * package.NATIVE)
    gaia = catalogs.gaia(center[0], center[1])
    _, stars = package.reference_stars(exps, grid)
    say = print if verbose else (lambda *a, **k: None)

    wise = motion.wise_epochs(catalogs.wise_single_exposures(center[0], center[1], 0.03), ast, center, gaia)
    band = T.get("default_band", "W2s")
    spx_blend = spherex_epochs(exps, grid, center, ast, gaia, stars, deblend=False, band=band)
    spx = spherex_epochs(exps, grid, center, ast, gaia, stars, deblend=True, band=band) if band == "W2s" else spx_blend
    res = {"target": key, "wise_epochs": wise, "spherex_epochs": spx, "spherex_blended": spx_blend, "fits": {}}

    say(f"{len(wise)} WISE visits, {len(spx)} SPHEREx visits")
    for e in spx:
        say(f"  SPHEREx {float(mjd_to_year(e['mjd'])):.3f}: xi={e['xi']:+.2f}+-{e['e_xi']:.2f} eta={e['eta']:+.2f}+-{e['e_eta']:.2f}"
            f"  S/N={e['snr']:.0f}  frame offset ({e['off_xi']:+.2f},{e['off_eta']:+.2f}) from {e['n_ref']} Gaia stars  k={e['k']}")

    fit_all(wise, spx, ast, center, _shower(res, say))
    _report_systematic(res, say)
    if len(wise) >= 6:
        fw = res["fits"]["WISE only"]
        pred = []
        for label, eps in (("deblended", spx), ("blended", spx_blend)):
            for e in eps:
                dt = float(mjd_to_year(e["mjd"])) - fw["t_ref"]
                from .geom import parallax_factors
                pa, pd = parallax_factors(ast["ra"], ast["dec"], np.array([e["mjd"]]))
                px = fw["xi0"] + fw["pm_xi"] * dt + fw["plx"] * pa[0]
                py = fw["eta0"] + fw["pm_eta"] * dt + fw["plx"] * pd[0]
                epx = float(np.hypot(fw["e_xi0"], fw["e_pm_xi"] * dt)); epy = float(np.hypot(fw["e_eta0"], fw["e_pm_eta"] * dt))
                pred.append({"set": label, "mjd": e["mjd"], "pred_xi": float(px), "pred_eta": float(py),
                             "d_xi": float(e["xi"] - px), "d_eta": float(e["eta"] - py),
                             "s_xi": float(np.hypot(e["e_xi"], epx)), "s_eta": float(np.hypot(e["e_eta"], epy))})
                say(f"  prediction test ({label:9s}) {float(mjd_to_year(e['mjd'])):.3f}: observed - predicted = "
                    f"({e['xi'] - px:+.2f}+-{np.hypot(e['e_xi'], epx):.2f}, {e['eta'] - py:+.2f}+-{np.hypot(e['e_eta'], epy):.2f}) arcsec")
        res["prediction_test"] = pred
    res["literature"] = {"pmra": ast["pmra"], "pmdec": ast["pmdec"], "plx": ast["plx"]}
    out = package.WEB / key
    out.mkdir(parents=True, exist_ok=True)
    net.write_atomic(out / "analysis.json", json.dumps(res, separators=(",", ":")))
    return res


def detect_sources(img, err, grid, min_snr=6.0, sep=3):
    from scipy import ndimage
    z = np.nan_to_num(img, nan=-1e9)
    with np.errstate(invalid="ignore", divide="ignore"):
        snr = img / err
    mx = (ndimage.maximum_filter(z, 2 * sep + 1) == z) & (snr > min_snr)
    out = [(float(grid.xi[r, c]), float(grid.eta[r, c]), float(snr[r, c])) for r, c in zip(*np.nonzero(mx))]
    return sorted(out, key=lambda t: -t[2])


BINS = (("0.75-2.4", 0.73, 2.44), ("2.4-3.8", 2.44, 3.80), ("3.8-4.4", 3.80, 4.40), ("4.4-5.0", 4.40, 5.03))


def _binned(spec):
    out = {}
    for name, lo, hi in BINS:
        s = spec[(spec["lam"] >= lo) & (spec["lam"] < hi)]
        if len(s) < 3:
            out[name] = None
            continue
        med = np.median(s["flux"]); mad = 1.4826 * np.median(np.abs(s["flux"] - med)) or 1.0
        s = s[np.abs(s["flux"] - med) < 4 * np.maximum(mad, s["err"])]
        m, e = phot.weighted_mean(s["flux"], s["err"])
        out[name] = {"flux": m, "err": e, "n": int(len(s)), "scatter": float(np.std(s["flux"]) / np.sqrt(len(s)))}
    return out


def neighbours(exps, grid):
    nb = []
    for band in ("D3", "W1s"):
        img, err, _ = frames.combine(frames.select(exps, band), grid)
        for x, y, s in detect_sources(img, err, grid, 6.0):
            f = phot.fit_centroid(img, err, grid, x, y, box_arcsec=16.0)
            if f and all(np.hypot(f["xi"] - a, f["eta"] - b) > 5.0 for a, b, _ in nb):
                nb.append((f["xi"], f["eta"], s))
    return nb


def track_maker(ast: dict, center):
    def track_of(dx=0.0, dy=0.0):
        def tr(mjd):
            ra, dec = propagate(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], mjd, ast.get("plx", 0.0))
            x, y = tan_project(ra[0], dec[0], center[0], center[1])
            return float(x) + dx, float(y) + dy
        return tr
    return track_of


def mirror_positions(near, nbxy, tx, ty):
    for d, a, b, _ in near:
        if 6.0 < d < 25.0:
            mx, my = 2 * a - tx, 2 * b - ty
            if all(np.hypot(mx - p[0], my - p[1]) > 7.0 for p in nbxy) and abs(mx) < 110 and abs(my) < 110:
                yield a, b, mx, my


def blank_positions(seed, tx, ty, nbxy, max_tries: int = 5000):
    rng = np.random.default_rng(seed)
    for _ in range(max_tries):
        x, y = rng.uniform(-105, 105, 2)
        if np.hypot(x - tx, y - ty) < 15 or any(np.hypot(x - p[0], y - p[1]) < 12.0 for p in nbxy):
            continue
        yield float(x), float(y)


def control_stats(target, rand):
    out = {}
    for name in ("2.4-3.8", "3.8-4.4", "4.4-5.0"):
        rv = np.array([r["bins"][name]["flux"] for r in rand if r["bins"][name]])
        if len(rv) < 8 or not target[name]:
            continue
        med, sd = float(np.median(rv)), float(1.4826 * np.median(np.abs(rv - np.median(rv))))
        out[name] = {"median": med, "sigma": sd, "n": int(len(rv)), "z": float((target[name]["flux"] - med) / sd),
                     "n_as_large": int(np.sum(rv >= target[name]["flux"]))}
    return out


def cold_candidate(key: str, box: int = 9, n_random: int = 60, seed: int = 1, verbose=True, write: bool = True) -> dict:
    T = TARGETS[key]
    center, ast = T["center"], T["astrometry"]
    exps = frames.prepare(cube.fetch_field(center[0], center[1], 24))
    grid = frames.Grid(49 * package.NATIVE)
    say = print if verbose else (lambda *a, **k: None)

    nb = neighbours(exps, grid)
    mjd0 = float(np.mean([e["mjd"] for e in exps]))
    track_of = track_maker(ast, center)
    tx, ty = track_of()(mjd0)
    near = sorted(((np.hypot(a - tx, b - ty), a, b, s) for a, b, s in nb))
    say(f"{len(exps)} exposures; {len(nb)} neighbours catalogued in the field; nearest to the target:")
    for d, a, b, s in near[:5]:
        say(f"    {d:5.1f}\" away at ({a:+.1f},{b:+.1f}), S/N {s:.0f}")
    nbxy = [(a, b) for a, b, _ in nb]

    def measure(track, skip_near=None):
        nbs = nbxy if skip_near is None else [p for p in nbxy if np.hypot(p[0] - skip_near[0], p[1] - skip_near[1]) > 4.0]
        return _binned(phot.spectrum(exps, track, neighbours=nbs, box=box))

    target = measure(track_of())
    mirrors = [{"about": [a, b], "pos": [mx, my], "bins": measure(track_of(mx - tx, my - ty))}
               for a, b, mx, my in mirror_positions(near, nbxy, tx, ty)]
    rand = []
    for x, y in blank_positions(seed, tx, ty, nbxy):
        if len(rand) >= n_random:
            break
        b = measure(track_of(x - tx, y - ty))
        if b["4.4-5.0"] and b["2.4-3.8"]:
            rand.append({"pos": [x, y], "bins": b})
    res = {"target": key, "position": [tx, ty], "bins": target, "mirrors": mirrors, "random": rand,
           "n_neighbours": len(nb), "nearest": [[float(d), float(a), float(b), float(s)] for d, a, b, s in near[:5]]}

    say("flux at the target track (uJy), error-weighted mean per band; 'scatter' = std/sqrt(n) of the exposures:")
    for name, _, _ in BINS:
        t = target[name]
        if t:
            say(f"    {name:9s} um: {t['flux']:+8.1f} +- {t['err']:.1f} (scatter {t['scatter']:.1f}, n={t['n']})")
    control = control_stats(target, rand)
    if control:
        res["control"] = control
    for name, c in control.items():
        say(f"    control, {c['n']} blank positions, {name} um: median {c['median']:+.1f}, robust sigma {c['sigma']:.1f} uJy"
            f"  -> target is {c['z']:+.1f} sigma")
    for m in mirrors:
        b = m["bins"]["4.4-5.0"]
        if b:
            say(f"    mirror about ({m['about'][0]:+.1f},{m['about'][1]:+.1f}): 4.4-5.0 um {b['flux']:+.1f} +- {b['err']:.1f} uJy")
    res["colour_excess"] = colour_excess(res, say)
    if write:
        (package.WEB / key).mkdir(parents=True, exist_ok=True)
        net.write_atomic(package.WEB / key / "candidate.json", json.dumps(res, separators=(",", ":")))
    return res


def candidate_refit(key: str, verbose=True) -> dict:
    path = package.WEB / key / "candidate.json"
    res = json.loads(path.read_text(encoding="utf-8"))
    say = print if verbose else (lambda *a, **k: None)
    say(f"{key}: {len(res['random'])} blank controls and {len(res['mirrors'])} mirror controls from {path.name}")
    res["colour_excess"] = colour_excess(res, say)
    net.write_atomic(path, json.dumps(res, separators=(",", ":")))
    return res


Y_TEMPLATE = {"3.8-4.4": 0.53, "4.4-5.0": 1.0}


def colour_excess(res: dict, say=print) -> dict:
    def vec(b, n):
        return b[n]["flux"] if b.get(n) else np.nan
    names = ("2.4-3.8", "3.8-4.4", "4.4-5.0")
    R = np.array([[vec(c["bins"], n) for n in names] for c in res["random"]])
    R = R[np.all(np.isfinite(R), axis=1)]
    T = np.array([vec(res["bins"], n) for n in names])
    out = {"n_controls": int(len(R)), "bands": {}}
    if len(R) < 20 or not np.all(np.isfinite(T)):
        return out
    Ec, Et, sig = {}, {}, {}
    for j, n in ((1, "3.8-4.4"), (2, "4.4-5.0")):
        x, y = R[:, 0], R[:, j]
        a, b = np.triu_indices(len(x), 1)
        ok = np.abs(x[a] - x[b]) > 1e-6
        c = float(np.median((y[a] - y[b])[ok] / (x[a] - x[b])[ok]))
        e = y - c * x
        med = float(np.median(e))
        Ec[n], Et[n] = e - med, float(T[j] - c * T[0] - med)
        sig[n] = float(1.4826 * np.median(np.abs(e - med)))
        raw = float(1.4826 * np.median(np.abs(y - np.median(y))))
        out["bands"][n] = {"c": c, "median": med, "raw_sigma": raw, "sigma": sig[n], "excess": Et[n],
                           "z": Et[n] / sig[n], "n_as_large": int((Ec[n] >= Et[n]).sum())}
        say(f"    colour excess {n} um: c={c:.2f}; blank-sky scatter {raw:.0f} -> {sig[n]:.0f} uJy; target {Et[n]:+.0f} uJy"
            f" = {Et[n] / sig[n]:+.1f} sigma; {int((Ec[n] >= Et[n]).sum())} of {len(e)} controls as large")
    w = {n: Y_TEMPLATE[n] / sig[n] ** 2 for n in Y_TEMPLATE}
    norm = np.sqrt(sum(Y_TEMPLATE[n] ** 2 / sig[n] ** 2 for n in Y_TEMPLATE))
    st = sum(w[n] * Et[n] for n in w) / norm
    sc = sum(w[n] * Ec[n] for n in w) / norm
    n_big = int((sc >= st).sum())
    amp = sum(w[n] * Et[n] for n in w) / sum(Y_TEMPLATE[n] ** 2 / sig[n] ** 2 for n in Y_TEMPLATE)
    out["matched"] = {"stat": float(st), "n_as_large": n_big, "p_empirical": (n_big + 1) / (len(sc) + 1),
                      "amplitude_4.4_5.0": float(amp), "amplitude_err": float(1.0 / norm)}
    say(f"    matched filter (Y-dwarf template over 3.8-5.0 um): statistic {st:+.1f}; {n_big} of {len(sc)} blank controls"
        f" reach it -> empirical chance probability {(n_big + 1) / (len(sc) + 1):.3f}")
    say(f"    best-fit Y-dwarf amplitude at 4.4-5.0 um: {amp:+.0f} +- {1.0 / norm:.0f} uJy")
    ms = []
    for m in res["mirrors"]:
        b = m["bins"]
        if all(b.get(n) for n in names):
            em = {n: vec(b, n) - out["bands"][n]["c"] * vec(b, "2.4-3.8") - out["bands"][n]["median"] for n in Y_TEMPLATE}
            ms.append(float(sum(w[n] * em[n] for n in w) / norm))
    out["mirror_stats"] = ms
    if ms:
        say("    same statistic at the mirror controls: " + ", ".join(f"{v:+.1f}" for v in ms))
    return out


README_CONTROLS = {"wise0855": 150, "smdet1": 300}


def _candidate_cli(name: str, args: list[str]) -> None:
    if args[:1] == ["refit"]:
        candidate_refit(name)
        return
    force = "--force" in args
    nums = [a for a in args if a != "--force"]
    stored = package.WEB / name / "candidate.json"
    have = len(json.loads(stored.read_text(encoding="utf-8"))["random"]) if stored.exists() else 0
    n = int(nums[0]) if nums else (have or README_CONTROLS.get(name, 60))
    if have > n and not force:
        sys.exit(f"{stored} holds {have} blank controls; a run with {n} would replace it with a weaker result. "
                 f"Give {have} or more, or add --force.")
    cold_candidate(name, n_random=n)


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "wise0855"
    if len(sys.argv) > 2 and sys.argv[2] == "candidate":
        _candidate_cli(name, sys.argv[3:])
    elif len(sys.argv) > 2 and sys.argv[2] == "refit":
        refit(name)
    else:
        astrometry(name)
