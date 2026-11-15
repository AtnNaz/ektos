from __future__ import annotations

import json
import sys

import numpy as np

from . import _console, cube, frames, net, package, phot
from .geom import mjd_to_year
from .targets import TARGETS


def wing_flux(e, xi, eta, r_in=2.5, r_out=5.0, s_in=8.0, s_out=12.0):
    col, row = phot._pixel_of(e, xi, eta)
    h, w = e["data"].shape
    rr, cc = np.mgrid[0:h, 0:w]
    d = np.hypot(cc - col, rr - row)
    ann, sky, core = (d >= r_in) & (d <= r_out), (d >= s_in) & (d <= s_out), d < r_in
    if col - s_out < 0 or row - s_out < 0 or col + s_out > w - 1 or row + s_out > h - 1:
        return None
    a, s = e["data"][ann], e["data"][sky]
    if np.isnan(a).sum() > 0.03 * a.size or np.isfinite(s).sum() < 0.7 * s.size:
        return None
    sv = s[np.isfinite(s)]
    b = np.median(sv)
    sb = 1.4826 * np.median(np.abs(sv - b))
    good = np.isfinite(a)
    to_ujy = e["omega"] / phot.ARCSEC2_PER_SR * 1e12
    flux = (a[good] - b).sum() * a.size / good.sum()
    err = np.sqrt(a.size * sb ** 2 + (a.size * sb) ** 2 / max(1, sv.size))
    return float(flux * to_ujy), float(err * to_ujy), int(np.isnan(e["data"][core]).sum())


def decompose(lam, mjd, flux, err, det, t_bin=10.0, knots_per_det=10):
    lam, mjd, flux, err, det = (np.asarray(v) for v in (lam, mjd, flux, err, det))
    ok = (flux > 5 * err) & np.isfinite(flux)
    lam, mjd, flux, err, det = lam[ok], mjd[ok], flux[ok], err[ok], det[ok]
    if len(flux) < 2:
        raise ValueError(f"decompose: {len(flux)} measurement(s) with S/N > 5; a light curve needs more")
    y = np.log(flux)
    sy = err / flux
    sy = np.hypot(sy, 0.02)
    edges = np.arange(mjd.min(), mjd.max() + t_bin, t_bin)
    tb = np.clip(np.digitize(mjd, edges) - 1, 0, len(edges) - 2)
    used = np.unique(tb)
    tmap = {b: i for i, b in enumerate(used)}
    ti = np.array([tmap[b] for b in tb])
    cols, knot_lam = [], []
    for dnum in np.unique(det):
        m = det == dnum
        if lam[m].max() <= lam[m].min():
            c = np.zeros(len(lam))
            c[m] = 1.0
            cols.append(c)
            knot_lam.append(float(lam[m][0]))
            continue
        k = np.linspace(lam[m].min(), lam[m].max(), min(knots_per_det, max(2, m.sum() // 6)))
        for j, kj in enumerate(k):
            c = np.zeros(len(lam))
            step = k[1] - k[0]
            c[m] = np.clip(1 - np.abs(lam[m] - kj) / step, 0, 1)
            cols.append(c)
            knot_lam.append(kj)
    S = np.column_stack(cols)
    if len(y) < S.shape[1] + len(used):
        raise ValueError(f"decompose: {len(y)} measurements for {S.shape[1]} spectral knots and {len(used)} time bins; "
                         "too few to separate the spectrum from the light curve")
    Tm = np.zeros((len(lam), len(used)))
    Tm[np.arange(len(lam)), ti] = 1
    A = np.vstack([np.hstack([S, Tm]) / sy[:, None], np.hstack([np.zeros(S.shape[1]), np.ones(len(used))])[None, :] * 1e3])
    b = np.concatenate([y / sy, [0.0]])
    for _ in range(3):
        p, *_ = np.linalg.lstsq(A, b, rcond=None)
        res = (y - np.hstack([S, Tm]) @ p) / sy
        sd = 1.4826 * np.median(np.abs(res - np.median(res)))
        keep = np.abs(res) < 4 * max(sd, 1.0)
        A = np.vstack([np.hstack([S, Tm])[keep] / sy[keep, None], A[-1:]])
        b = np.concatenate([(y / sy)[keep], [0.0]])
    cov = np.linalg.pinv(A.T @ A)
    chi2r = float((res[keep] ** 2).sum() / max(1, keep.sum() - A.shape[1]))
    ns = S.shape[1]
    a = p[ns:]
    ea = np.sqrt(np.diag(cov)[ns:] * max(1.0, chi2r))
    tmid = np.array([mjd[ti == i].mean() for i in range(len(used))])
    nper = np.array([(ti == i).sum() for i in range(len(used))])
    return {"mjd": tmid.tolist(), "year": mjd_to_year(tmid).tolist(), "dmag": (2.5 / np.log(10) * a).tolist(),
            "e_dmag": (2.5 / np.log(10) * ea).tolist(), "n": nper.tolist(), "knots": knot_lam, "s": p[:ns].tolist(),
            "chi2r": chi2r, "rms_mag": float(2.5 / np.log(10) * np.std((y - np.hstack([S, Tm]) @ p)[keep])),
            "n_used": int(keep.sum()), "n_all": int(len(y)),
            "_res": (lam, mjd, 2.5 / np.log(10) * (y - np.hstack([S, Tm]) @ p), keep)}


def colour_curve(dec, split=2.44):
    lam, mjd, res, keep = dec["_res"]
    out = []
    for t in dec["mjd"]:
        m = keep & (np.abs(mjd - t) < 6.0)
        b, r = m & (lam < split), m & (lam >= split)
        if b.sum() >= 4 and r.sum() >= 4:
            out.append({"mjd": float(t), "blue": float(np.mean(res[b])), "red": float(np.mean(res[r])),
                        "e_blue": float(np.std(res[b]) / np.sqrt(b.sum())), "e_red": float(np.std(res[r]) / np.sqrt(r.sum()))})
    return out


def period_fit(mjd, dmag, e_dmag, n, published=None, min_n: int = 5, step: float = 0.5) -> dict | None:
    t, m, e, n = (np.asarray(v, float) for v in (mjd, dmag, e_dmag, n))
    k = (n >= min_n) & np.isfinite(m) & (e > 0)
    t, m, e = t[k], m[k], e[k]
    if len(t) < 8:
        return None
    span = t.max() - t.min()
    periods = np.arange(120.0, max(125.0, min(500.0, span)), step)
    chi2, amp = np.empty(len(periods)), np.empty(len(periods))
    for i, p in enumerate(periods):
        A = np.column_stack([np.ones_like(t), np.sin(2 * np.pi * t / p), np.cos(2 * np.pi * t / p)]) / e[:, None]
        sol, *_ = np.linalg.lstsq(A, m / e, rcond=None)
        r = m / e - A @ sol
        chi2[i], amp[i] = r @ r, 2.0 * np.hypot(sol[1], sol[2])
    i = int(np.argmin(chi2))
    dof = len(t) - 3
    ok = chi2 <= chi2[i] + chi2[i] / dof
    lo = i
    while lo > 0 and ok[lo - 1]:
        lo -= 1
    hi = i
    while hi < len(periods) - 1 and ok[hi + 1]:
        hi += 1
    return {"best_d": float(periods[i]), "lo_d": float(periods[lo]), "hi_d": float(periods[hi]), "published_d": published,
            "chi2": float(chi2[i]), "dof": int(dof), "amp_mag": float(amp[i]), "n_bins": int(len(t))}


def refit_period(key: str, verbose=True) -> dict | None:
    path = package.WEB / key / "variable.json"
    res = json.loads(path.read_text(encoding="utf-8"))
    lc = res["light_curve"]
    per = period_fit(lc["mjd"], lc["dmag"], lc["e_dmag"], lc["n"], TARGETS[key].get("period"))
    if per:
        res["period"] = per
        net.write_atomic(path, json.dumps(res, separators=(",", ":")))
        if verbose:
            print(f"{key}: period {per['best_d']:.1f} d ({per['lo_d']:.1f} - {per['hi_d']:.1f}), peak-to-peak {per['amp_mag']:.2f} mag, "
                  f"chi2 {per['chi2']:.1f} / {per['dof']} over {per['n_bins']} bins; published {per['published_d']}")
    return per


def run(key: str, verbose=True, t_bin=10.0) -> dict:
    T = TARGETS[key]
    center = T["center"]
    exps = frames.prepare(cube.fetch_field(center[0], center[1], 24))
    say = print if verbose else (lambda *a, **k: None)
    probe = [wing_flux(e, 0.0, 0.0) for e in exps]
    nsat = sum(1 for r in probe if r and r[2] > 0)
    nall = sum(1 for r in probe if r)
    wings = nsat > 0.05 * max(1, nall)
    r_in, r_out = (2.5, 5.0) if wings else (0.0, 2.5)
    rows = []
    for e in exps:
        r = wing_flux(e, 0.0, 0.0, r_in, r_out)
        if r:
            rows.append((e["lam"], e["mjd"], r[0], r[1], e["det"]))
    if not rows:
        raise ValueError(f"{key}: none of the {len(exps)} exposures has a complete aperture around the star")
    arr = np.array(rows)
    say(f"{key}: {len(exps)} exposures; core saturated in {nsat} of {nall} ({100 * nsat / max(1, nall):.0f}%) -> "
        f"{'wing annulus 2.5-5 px' if wings else 'core aperture r < 2.5 px'}; photometry on {len(arr)}")
    dec = decompose(arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3], arr[:, 4].astype(int), t_bin=t_bin)
    grid = frames.Grid(49 * package.NATIVE)
    _, stars = package.reference_stars(exps, grid)
    ctrl = None
    cand = sorted((s for s in stars if np.hypot(s["xi"], s["eta"]) > 40 and abs(s["xi"]) < 75 and abs(s["eta"]) < 75),
                  key=lambda s: -s["snr"])
    for s in cand[:3]:
        crow = [(e["lam"], e["mjd"], *r[:2], e["det"]) for e in exps if (r := wing_flux(e, s["xi"], s["eta"], 0.0, 2.5)) is not None]
        if len(crow) > 0.6 * len(arr):
            c = np.array(crow)
            try:
                cd = decompose(c[:, 0], c[:, 1], c[:, 2], c[:, 3], c[:, 4].astype(int), t_bin=t_bin)
            except ValueError:
                continue
            ccol = colour_curve(cd)
            ctrl = {"pos": [s["xi"], s["eta"]], "year": cd["year"], "dmag": cd["dmag"], "e_dmag": cd["e_dmag"],
                    "rms_mag": cd["rms_mag"], "range_mag": float(np.ptp(cd["dmag"])), "colour": ccol,
                    "colour_range_mag": float(np.ptp([c["blue"] - c["red"] for c in ccol])) if ccol else None}
            break
    amp = float(np.ptp(dec["dmag"]))
    say(f"  light curve: {len(dec['mjd'])} time bins of {t_bin:.0f} d; peak-to-peak {amp:.2f} mag; "
        f"per-exposure scatter about the model {dec['rms_mag']:.3f} mag; {dec['n_used']}/{dec['n_all']} exposures used")
    for y, m, em, n in zip(dec["year"], dec["dmag"], dec["e_dmag"], dec["n"]):
        say(f"    {y:.3f}  {m:+.3f} +- {em:.3f} mag   ({n} exposures)")
    if ctrl:
        say(f"  control star at ({ctrl['pos'][0]:+.0f},{ctrl['pos'][1]:+.0f}): peak-to-peak {ctrl['range_mag']:.2f} mag over the same bins (should be ~0)")
        for c in ctrl["colour"]:
            say(f"      control colour {float(mjd_to_year(c['mjd'])):.3f}  blue {c['blue']:+.3f}+-{c['e_blue']:.3f}   red {c['red']:+.3f}+-{c['e_red']:.3f}")
    col = colour_curve(dec)
    if col:
        say("  colour residual per bin (mag; blue = below 2.44 um, red = above):")
        for c in col:
            say(f"    {float(mjd_to_year(c['mjd'])):.3f}  blue {c['blue']:+.3f}+-{c['e_blue']:.3f}   red {c['red']:+.3f}+-{c['e_red']:.3f}")
    res = {"target": key, "aperture": "wings" if wings else "core", "t_bin": t_bin, "light_curve": {k: dec[k] for k in ("mjd", "year", "dmag", "e_dmag", "n")},
           "spectrum": {"knots": dec["knots"], "log_s": dec["s"]}, "rms_mag": dec["rms_mag"], "amplitude_mag": amp,
           "n_used": dec["n_used"], "n_all": dec["n_all"], "saturated_fraction": nsat / max(1, len(arr)),
           "control": ctrl, "colour": col}
    if T.get("period"):
        per = period_fit(dec["mjd"], dec["dmag"], dec["e_dmag"], dec["n"], T["period"])
        if per:
            res["period"] = per
            say(f"  sinusoid: period {per['best_d']:.1f} d ({per['lo_d']:.1f} - {per['hi_d']:.1f}), peak-to-peak {per['amp_mag']:.2f} mag, "
                f"chi2 {per['chi2']:.1f} / {per['dof']}; published {per['published_d']} d")
    out = package.WEB / key
    out.mkdir(parents=True, exist_ok=True)
    net.write_atomic(out / "variable.json", json.dumps(res, separators=(",", ":")))
    return res


if __name__ == "__main__":
    _console.utf8_stdout()
    name = sys.argv[1] if len(sys.argv) > 1 else "rwaur"
    if len(sys.argv) > 2 and sys.argv[2] == "period":
        refit_period(name)
    else:
        run(name)
