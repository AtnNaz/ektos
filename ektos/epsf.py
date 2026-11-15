from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
import time

import numpy as np
from astropy.io import fits
from scipy.interpolate import RectBivariateSpline

from . import analysis, cube, frames, net, package, phot
from .targets import TARGETS

INTERP = "nearest"
ORIENTS = ("as stored", "x flipped", "y flipped", "rotated 180", "transposed",
           "transposed, x flipped", "transposed, y flipped", "anti-transposed")

_NAME = re.compile(r"_(\d{4}W\d+_\w+?)_D(\d)\.fits$")
_FILES: dict[tuple[str, int], pathlib.Path] = {}
_ZONES: dict[str, "Zones"] = {}
_GEOM: dict[tuple[str, int], tuple] = {}


def register(folder) -> int:
    folder = pathlib.Path(folder)
    for p in sorted((folder / "cutouts" if (folder / "cutouts").is_dir() else folder).glob("*.fits")):
        m = _NAME.search(p.name)
        if m:
            _FILES[(m.group(1), int(m.group(2)))] = p
        else:
            h = fits.getheader(p, "IMAGE")
            _FILES[(str(h["OBSID"]), int(h["DETECTOR"]))] = p
    return len(_FILES)


def _oriented(P, k: int):
    if k & 4:
        P = P.T
    if k & 1:
        P = P[:, ::-1]
    if k & 2:
        P = P[::-1, :]
    return P


class Zones:
    def __init__(self, tab, hdr):
        self.ovx, self.ovy = int(hdr["OVSMPX"]), int(hdr["OVSMPY"])
        self.P = np.asarray(tab["EPSF"], float)
        bx, by = np.asarray(tab["BINX"]), np.asarray(tab["BINY"])
        self.row = np.full((by.max() + 1, bx.max() + 1), -1)
        self.row[by, bx] = np.arange(len(bx))
        xc, yc = np.asarray(tab["XCENTER"], float), np.asarray(tab["YCENTER"], float)
        self.xc, self.yc = xc[self.row[0, :]], yc[self.row[:, 0]]
        if (self.row < 0).any() or np.any(np.diff(self.xc) <= 0) or np.any(np.diff(self.yc) <= 0) \
                or not np.allclose(xc, self.xc[bx]) or not np.allclose(yc, self.yc[by]):
            raise ValueError("EPSF zones are not a regular grid")
        self.neff, self.cwave = np.asarray(tab["NEFF_MEAN"], float), np.asarray(tab["CWAVE"], float)
        self._spl: dict[tuple[int, int], tuple] = {}

    def weights(self, x: float, y: float, interp: str = INTERP):
        if interp == "nearest":
            return [(int(self.row[np.argmin(np.abs(self.yc - y)), np.argmin(np.abs(self.xc - x))]), 1.0)]
        out = []
        fx = float(np.clip(np.interp(x, self.xc, np.arange(len(self.xc))), 0, len(self.xc) - 1))
        fy = float(np.clip(np.interp(y, self.yc, np.arange(len(self.yc))), 0, len(self.yc) - 1))
        ix, iy = min(int(fx), len(self.xc) - 2), min(int(fy), len(self.yc) - 2)
        for j, wy in ((iy, 1 - (fy - iy)), (iy + 1, fy - iy)):
            for i, wx in ((ix, 1 - (fx - ix)), (ix + 1, fx - ix)):
                if wx * wy > 0:
                    out.append((int(self.row[j, i]), wx * wy))
        return out

    def _spline(self, row: int, orient: int):
        k = (row, orient)
        if k not in self._spl:
            P = _oriented(self.P[row], orient)
            ny, nx = P.shape
            s = RectBivariateSpline(np.arange(ny), np.arange(nx), P * (self.ovx * self.ovy / P.sum()), kx=3, ky=3, s=0)
            self._spl[k] = (s, (ny - 1) / 2.0, (nx - 1) / 2.0, ny, nx)
        return self._spl[k]

    def stamp(self, x: float, y: float, dx, dy, interp: str = INTERP, orient: int = 0, integrate: bool = False):
        dx, dy = np.asarray(dx, float), np.asarray(dy, float)
        out = np.zeros(dx.shape)
        sub = ((np.arange(self.ovx) + 0.5) / self.ovx - 0.5) if integrate else np.zeros(1)
        for row, w in self.weights(x, y, interp):
            s, cy, cx, ny, nx = self._spline(row, orient)
            for ax in sub:
                for ay in sub:
                    u, v = cx + self.ovx * (dx + ax), cy + self.ovy * (dy + ay)
                    ok = (u >= 0) & (u <= nx - 1) & (v >= 0) & (v <= ny - 1)
                    out[ok] += w * s.ev(v[ok], u[ok]) / sub.size ** 2
        return out


def exposure_psf(e):
    k = (e["obs_id"], int(e["det"]))
    if k in _GEOM:
        return _GEOM[k]
    path = _FILES.get(k)
    if path is None:
        _GEOM[k] = None
        return None
    with fits.open(path, memmap=False) as h:
        ih = h["IMAGE"].header
        img = np.asarray(h["IMAGE"].data, np.float32)
        tab, eh = h["EPSF"].data, h["EPSF"].header
        dig = hashlib.md5(np.ascontiguousarray(tab["EPSF"]).tobytes()).hexdigest()
        if dig not in _ZONES:
            _ZONES[dig] = Zones(tab, eh)
    sx, sy = 1.0 - float(ih["CRPIX1A"]), 1.0 - float(ih["CRPIX2A"])
    n_r, n_c = e["data"].shape
    geom = None
    for cx0, cy0 in ((e["x0"], e["y0"]), (int(round(e["x0"] - sx)), int(round(e["y0"] - sy)))):
        win = np.full((n_r, n_c), np.nan, np.float32)
        xa, xb, ya, yb = max(cx0, 0), min(cx0 + n_c, img.shape[1]), max(cy0, 0), min(cy0 + n_r, img.shape[0])
        if xb > xa and yb > ya:
            win[ya - cy0:yb - cy0, xa - cx0:xb - cx0] = img[ya:yb, xa:xb]
        both = np.isfinite(win) & np.isfinite(e["data"])
        if both.sum() > 0.5 * np.isfinite(e["data"]).sum() and np.array_equal(win[both], e["data"][both]):
            geom = (_ZONES[dig], cx0 + sx, cy0 + sy)
            break
    if geom is None:
        raise ValueError(f"{path.name}: the cached window is not a sub-image of this cutout")
    _GEOM[k] = geom
    return geom


def _pix(e, pts):
    return np.linalg.solve(e["M"], (np.atleast_2d(np.asarray(pts, float)) - e["c"]).T).T


def fit_box(e, xi, eta, box: int = 7, neighbours=(), psf: str = "epsf", interp: str = INTERP,
            orient: int = 0, integrate: bool = False):
    col, row = phot._pixel_of(e, xi, eta)
    h, w = e["data"].shape
    half = box // 2
    c0, r0 = int(round(col)), int(round(row))
    if not (half <= c0 < w - half and half <= r0 < h - half):
        return None
    sub = e["data"][r0 - half:r0 + half + 1, c0 - half:c0 + half + 1].astype(float)
    good = np.isfinite(sub)
    if good.sum() < 0.8 * sub.size:
        return None
    rr, cc = np.mgrid[r0 - half:r0 + half + 1, c0 - half:c0 + half + 1]
    if psf == "gauss":
        scale = np.sqrt(abs(np.linalg.det(e["M"])))
        sg = (e["psf_fwhm"] if np.isfinite(e["psf_fwhm"]) else 8.0) * phot.FWHM2SIG / scale

        def shape(c, r):
            return np.exp(-0.5 * ((cc - c) ** 2 + (rr - r) ** 2) / sg ** 2) / (2 * np.pi * sg ** 2)
    else:
        g = exposure_psf(e)
        if g is None:
            return None
        zones, ox, oy = g

        def shape(c, r):
            return zones.stamp(c + ox, r + oy, cc - c, rr - r, interp, orient, integrate)

    cols = [shape(col, row)[good]]
    if len(neighbours):
        for nc, nr in _pix(e, neighbours):
            if abs(nc - col) < box and abs(nr - row) < box:
                p = shape(nc, nr)[good]
                if psf == "gauss" or p.any():
                    cols.append(p)
    cols.append(np.ones(good.sum()))
    A = np.column_stack(cols)
    try:
        ata_inv = np.linalg.inv(A.T @ A)
    except np.linalg.LinAlgError:
        return None
    sol = ata_inv @ (A.T @ sub[good])
    to_ujy = e["omega"] / phot.ARCSEC2_PER_SR * 1e12
    res = sub[good] - A @ sol
    peak = sub[half, half] if good[half, half] else sub[good].max()
    return {"flux": float(sol[0] * to_ujy), "err": float(np.sqrt(ata_inv[0, 0]) * e["sig"] * to_ujy),
            "n": int(good.sum()), "resid": float(np.sqrt(np.mean(res ** 2))),
            "peak": float(peak - e.get("bg", 0.0))}


def forced_flux_epsf(e, xi, eta, box: int = 7, neighbours=(), interp: str = INTERP):
    r = fit_box(e, xi, eta, box, neighbours, "epsf", interp)
    return None if r is None else (r["flux"], r["err"], r["n"])


def spectrum(exps, track, neighbours=(), box: int = 7, interp: str = INTERP):
    rows = []
    for e in exps:
        xi, eta = track(e["mjd"])
        r = forced_flux_epsf(e, xi, eta, box, neighbours, interp)
        if r is not None:
            rows.append((e["lam"], e["bw"], r[0], r[1], e["mjd"], e["det"]))
    out = np.array(rows, dtype=[("lam", "f8"), ("bw", "f8"), ("flux", "f8"), ("err", "f8"),
                                ("mjd", "f8"), ("det", "i4")])
    return np.sort(out, order="lam")


def neff_check(zones: Zones, n_phase: int = 200, seed: int = 0, every: int = 7) -> dict:
    rng = np.random.default_rng(seed)
    ph = rng.uniform(-0.5, 0.5, (n_phase, 2))
    dy, dx = np.mgrid[-4:5, -4:5].astype(float)
    out = {}
    rows = np.arange(0, len(zones.P), every)
    for name, integ in (("sampled", False), ("integrated", True)):
        ratio, tot = [], []
        for r in rows:
            j, i = np.argwhere(zones.row == r)[0]
            ne, sm = [], []
            for a, b in ph:
                p = zones.stamp(zones.xc[i], zones.yc[j], dx - a, dy - b, "nearest", 0, integ)
                ne.append(p.sum() ** 2 / (p ** 2).sum())
                sm.append(p.sum())
            ratio.append(np.mean(ne) / zones.neff[r])
            tot.append(sm)
        tot = np.array(tot)
        out[name] = {"neff_over_table_median": float(np.median(ratio)), "neff_over_table_min": float(np.min(ratio)),
                     "neff_over_table_max": float(np.max(ratio)), "total_mean": float(tot.mean()),
                     "total_rms_with_phase": float(np.median(tot.std(axis=1))), "n_zones": int(len(rows))}
    return out


def isolated_stars(exps, grid, nb, n: int = 5, clear: float = 30.0, edge: float = 105.0):
    _, stars = package.reference_stars(exps, grid)
    out = []
    for s in sorted(stars, key=lambda s: -s["amp"]):
        d = np.array([np.hypot(a - s["xi"], b - s["eta"]) for a, b, _ in nb])
        if abs(s["xi"]) < edge and abs(s["eta"]) < edge and np.sum(d < clear) <= 1 and np.sum(d < 4.0) <= 1:
            out.append(s)
    return out[:n]


def _star_fits(exps, stars, nbxy, box, min_peak_snr=30.0, **kw):
    for si, s in enumerate(stars):
        nbs = [p for p in nbxy if np.hypot(p[0] - s["xi"], p[1] - s["eta"]) > 4.0]
        for e in exps:
            g = fit_box(e, s["xi"], s["eta"], box, nbs, "gauss")
            if g is None or g["peak"] < min_peak_snr * e["sig"]:
                continue
            yield si, e, g, {k: fit_box(e, s["xi"], s["eta"], box, nbs, "epsf", **v) for k, v in kw.items()}


def orientation_check(exps, stars, nbxy, box: int = 9) -> dict:
    acc = {"SWIR D1-3": [], "MWIR D4-6": []}
    for _, e, g, f in _star_fits(exps, stars, nbxy, box, **{str(k): {"orient": k} for k in range(8)}):
        if all(f.values()):
            acc["SWIR D1-3" if e["det"] <= 3 else "MWIR D4-6"].append(
                [g["resid"] / g["peak"]] + [f[str(k)]["resid"] / f[str(k)]["peak"] for k in range(8)])
    out = {}
    for name, v in acc.items():
        v = np.array(v)
        if len(v) == 0:
            continue
        best = np.argmin(v[:, 1:], axis=1)
        out[name] = {"n_fits": int(len(v)), "gauss_median_resid": float(np.median(v[:, 0])),
                     "orientations": [{"orientation": ORIENTS[k], "median_resid": float(np.median(v[:, 1 + k])),
                                       "best_in": int(np.sum(best == k))} for k in range(8)]}
    return out


def star_check(exps, stars, nbxy, box: int = 9) -> dict:
    rows = []
    for si, e, g, f in _star_fits(exps, stars, nbxy, box, nearest={"interp": "nearest"}, bilinear={"interp": "bilinear"},
                                  integrated={"integrate": True}):
        if all(f.values()):
            n, b, i = f["nearest"], f["bilinear"], f["integrated"]
            rows.append((si, e["det"], e["lam"], g["resid"] / g["peak"], n["resid"] / n["peak"], b["resid"] / b["peak"],
                         i["resid"] / i["peak"], n["flux"] / g["flux"], e["sig"] / g["peak"], g["flux"]))
    r = np.array(rows)
    out = {"n_fits": int(len(r)), "stars": [], "by_detector": []}
    if len(r) == 0:
        return out

    def summary(m):
        q = r[m]
        return {"n": int(m.sum()), "lam": float(np.median(q[:, 2])), "resid_gauss": float(np.median(q[:, 3])),
                "resid_epsf": float(np.median(q[:, 4])), "resid_epsf_bilinear": float(np.median(q[:, 5])),
                "resid_epsf_integrated": float(np.median(q[:, 6])), "noise_floor": float(np.median(q[:, 8])),
                "flux_ratio": float(np.median(q[:, 7])),
                "flux_ratio_scatter": float(1.4826 * np.median(np.abs(q[:, 7] - np.median(q[:, 7]))))}
    for si, s in enumerate(stars):
        m = r[:, 0] == si
        if m.any():
            out["stars"].append({"xi": float(s["xi"]), "eta": float(s["eta"]),
                                 "median_flux_gauss": float(np.median(r[m, 9])), **summary(m)})
    for det in range(1, 7):
        m = r[:, 1] == det
        if m.any():
            out["by_detector"].append({"det": det, **summary(m)})
    out["all"] = summary(np.ones(len(r), bool))
    return out


def _exposures(center, half: int = 24):
    listing = cube.field_dir(center[0], center[1], half) / "listing.json"
    if not listing.exists():
        raise FileNotFoundError("field not in the cache: run python -m ektos.cutouts first")
    return frames.prepare(cube.fetch_field(center[0], center[1], half, images=json.loads(listing.read_text())))


def candidate_check(key: str, folder, box: int = 9, n_random: int = 60, seed: int = 1, n_stars: int = 5,
                    verbose=True, write: bool = True) -> dict:
    t0 = time.time()
    say = print if verbose else (lambda *a, **k: None)
    T = TARGETS[key]
    center, ast = T["center"], T["astrometry"]
    n_files = register(folder)
    exps = _exposures(center)
    grid = frames.Grid(49 * package.NATIVE)
    have = [e for e in exps if exposure_psf(e) is not None]
    say(f"{len(exps)} exposures, {len(have)} with an ePSF ({n_files} cutout files indexed, {len(_ZONES)} distinct EPSF tables)")
    nb = analysis.neighbours(exps, grid)
    nbxy = [(a, b) for a, b, _ in nb]
    res = {"target": key, "n_exposures": len(exps), "n_with_epsf": len(have), "n_neighbours": len(nb),
           "box": box, "interp": INTERP, "seed": seed}

    by_det = {}
    for e in have:
        by_det.setdefault(int(e["det"]), exposure_psf(e)[0])
    res["neff"] = {str(d): neff_check(z) for d, z in sorted(by_det.items())}
    for d, v in res["neff"].items():
        say(f"  D{d}: N_eff rendered / NEFF_MEAN = {v['sampled']['neff_over_table_median']:.3f} sampled, "
            f"{v['integrated']['neff_over_table_median']:.3f} pixel-integrated; rendered total "
            f"{v['sampled']['total_mean']:.4f} +- {v['sampled']['total_rms_with_phase']:.4f} with sub-pixel position")
    stars = isolated_stars(exps, grid, nb, n_stars)
    res["orientation"] = orientation_check(have, stars, nbxy, box)
    for name, v in res["orientation"].items():
        say(f"  orientation, {name}, {v['n_fits']} star fits (Gaussian residual {v['gauss_median_resid']:.4f} of peak):")
        for o in v["orientations"]:
            say(f"      {o['orientation']:22s} median residual {o['median_resid']:.4f} of peak, best in {o['best_in']}")
    res["stars"] = star_check(have, stars, nbxy, box)
    say("  bright isolated stars: residual rms / peak, Gaussian -> ePSF (bilinear zones; pixel-integrated), flux ePSF / Gaussian")
    for v in res["stars"]["by_detector"]:
        say(f"      D{v['det']} {v['lam']:.2f} um n={v['n']:3d}: {v['resid_gauss']:.4f} -> {v['resid_epsf']:.4f} "
            f"({v['resid_epsf_bilinear']:.4f}; {v['resid_epsf_integrated']:.4f}), noise {v['noise_floor']:.4f}; "
            f"ratio {v['flux_ratio']:.3f} +- {v['flux_ratio_scatter']:.3f}")

    mjd0 = float(np.mean([e["mjd"] for e in exps]))
    track_of = analysis.track_maker(ast, center)
    tx, ty = track_of()(mjd0)
    near = sorted(((np.hypot(a - tx, b - ty), a, b, s) for a, b, s in nb))

    def measure(track, psf, also=None):
        if also is None:
            if psf == "gauss":
                return analysis._binned(phot.spectrum(exps, track, neighbours=nbxy, box=box))
            return analysis._binned(spectrum(exps, track, neighbours=nbxy, box=box))
        fn = phot.forced_flux if psf == "gauss" else forced_flux_epsf
        rows = []
        for e in exps:
            r = fn(e, *track(e["mjd"]), box, nbxy + [also(e["mjd"])])
            if r is not None:
                rows.append((e["lam"], e["bw"], r[0], r[1], e["mjd"], e["det"]))
        return analysis._binned(np.sort(np.array(rows, dtype=[("lam", "f8"), ("bw", "f8"), ("flux", "f8"), ("err", "f8"),
                                                              ("mjd", "f8"), ("det", "i4")]), order="lam"))

    out = {p: {"bins": measure(track_of(), p), "mirrors": [], "random": []} for p in ("gauss", "epsf")}
    for a, b, mx, my in analysis.mirror_positions(near, nbxy, tx, ty):
        for p in out:
            out[p]["mirrors"].append({"about": [a, b], "pos": [mx, my], "bins": measure(track_of(mx - tx, my - ty), p),
                                      "bins_with_target": measure(track_of(mx - tx, my - ty), p, track_of())})
    for x, y in analysis.blank_positions(seed, tx, ty, nbxy):
        if len(out["gauss"]["random"]) >= n_random:
            break
        b = measure(track_of(x - tx, y - ty), "gauss")
        if b["4.4-5.0"] and b["2.4-3.8"]:
            out["gauss"]["random"].append({"pos": [x, y], "bins": b})
            out["epsf"]["random"].append({"pos": [x, y], "bins": measure(track_of(x - tx, y - ty), "epsf")})
    res["position"] = [tx, ty]
    for p in out:
        o = out[p]
        o["control"] = analysis.control_stats(o["bins"], o["random"])
        full = {"bins": o["bins"], "mirrors": o["mirrors"],
                "random": [r for r in o["random"] if r["bins"]["4.4-5.0"] and r["bins"]["2.4-3.8"]]}
        o["colour_excess"] = analysis.colour_excess(full, lambda *a, **k: None)
        say(f"  {p}: flux at the target track (uJy)")
        for name, _, _ in analysis.BINS:
            t = o["bins"][name]
            if t:
                c = o["control"].get(name)
                say(f"      {name:9s} um: {t['flux']:+8.1f} +- {t['err']:.1f} (n={t['n']})" + (
                    f"   blank controls: median {c['median']:+.1f}, robust sigma {c['sigma']:.1f}, n={c['n']}, "
                    f"{c['n_as_large']} as large" if c else ""))
        for m in o["mirrors"]:
            say(f"      mirror about ({m['about'][0]:+.1f},{m['about'][1]:+.1f}): " + ", ".join(
                f"{n} {m['bins'][n]['flux']:+.1f} +- {m['bins'][n]['err']:.1f}" for n, _, _ in analysis.BINS if m["bins"][n]))
            say("        the same with the target fitted too:  " + ", ".join(
                f"{n} {m['bins_with_target'][n]['flux']:+.1f} +- {m['bins_with_target'][n]['err']:.1f}"
                for n, _, _ in analysis.BINS if m["bins_with_target"][n]))
        mt = o["colour_excess"].get("matched")
        if mt:
            say(f"      matched filter: statistic {mt['stat']:+.2f}, {mt['n_as_large']} of {o['colour_excess']['n_controls']} "
                f"blank controls reach it -> chance probability {mt['p_empirical']:.3f}; amplitude "
                f"{mt['amplitude_4.4_5.0']:+.0f} +- {mt['amplitude_err']:.0f} uJy")
        o["random"] = [{"pos": r["pos"], "flux": [r["bins"][n]["flux"] if r["bins"][n] else None
                                                   for n in ("2.4-3.8", "3.8-4.4", "4.4-5.0")]} for r in o["random"]]
    res.update(out)
    res["seconds"] = round(time.time() - t0, 1)
    res["network_bytes"] = net.METER.snapshot()["bytes"]
    if write:
        (package.WEB / key).mkdir(parents=True, exist_ok=True)
        (package.WEB / key / "epsf_check.json").write_text(json.dumps(res, separators=(",", ":"), allow_nan=False),
                                                           encoding="utf-8")
    say(f"  {res['seconds']:.0f} s, {res['network_bytes']} network bytes")
    return res


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: python -m ektos.epsf wise0855 <cutout folder> [n_random]")
    candidate_check(sys.argv[1], sys.argv[2], n_random=int(sys.argv[3]) if len(sys.argv) > 3 else 60)
