from __future__ import annotations

import json
import pathlib
import threading

import numpy as np
from scipy import ndimage

from . import catalogs, cube, frames, net, phot
from .geom import mjd_to_year, tan_project
from .targets import TARGETS

WEB = pathlib.Path(__file__).resolve().parent.parent / "web" / "data"
NATIVE = 6.15
_INDEX_LOCK = threading.Lock()


def default_slug(ra: float, dec: float, half: int = 24) -> str:
    s = f"f_{ra:.4f}_{dec:+.4f}".replace(".", "p").replace("+", "n").replace("-", "s")
    return s if half == 24 else f"{s}_h{half}"


def _num(x, nd: int):
    x = float(x)
    return round(x, nd) if np.isfinite(x) else None


def _date(mjd: float) -> str:
    from astropy.time import Time
    return Time(mjd, format="mjd").strftime("%Y-%m-%d")


def reference_stars(exps, grid, band_order=("D3", "D2", "D4", "D1", "W2s"), min_snr=40.0, edge=14):
    for band in band_order:
        sel = frames.select(exps, band)
        if len(sel) < 6:
            continue
        ref, err, _ = frames.combine(sel, grid)
        z = np.nan_to_num(ref)
        with np.errstate(invalid="ignore", divide="ignore"):
            snr = ref / err
        mx = (ndimage.maximum_filter(z, 9) == z) & (snr > min_snr)
        stars = []
        for r, c in zip(*np.nonzero(mx)):
            if edge < r < grid.n - edge and edge < c < grid.n - edge:
                f = phot.fit_centroid(ref, err, grid, grid.xi[r, c], grid.eta[r, c])
                if f and f["snr"] > 0.6 * min_snr and 6 < f["fwhm"] < 16:
                    stars.append(f)
        if len(stars) >= 3:
            return band, stars
    return None, []


def _apflux(img, grid, xi, eta, rad=9.0, r1=14.0, r2=20.0):
    d = np.hypot(grid.xi - xi, grid.eta - eta)
    a = (d <= rad) & np.isfinite(img)
    s = (d > r1) & (d <= r2) & np.isfinite(img)
    if a.sum() < 10 or s.sum() < 20:
        return np.nan
    return float((img[a] - np.median(img[s])).sum())


def star_colour(visit, grid, stars, num="W2s", den="W1s", exclude=None, excl_radius=12.0):
    a_img, a_err, _ = frames.combine(frames.select(visit, den), grid)
    b_img, _, _ = frames.combine(frames.select(visit, num), grid)
    if not np.isfinite(a_img).any() or not np.isfinite(b_img).any():
        return None
    noise = np.nanmedian(a_err) * np.sqrt(30)
    ratios = []
    for s in stars:
        if exclude is not None and np.hypot(s["xi"] - exclude[0], s["eta"] - exclude[1]) < excl_radius:
            continue
        a, b = _apflux(a_img, grid, s["xi"], s["eta"]), _apflux(b_img, grid, s["xi"], s["eta"])
        if np.isfinite(a) and np.isfinite(b) and a > 20 * noise:
            ratios.append(b / a)
    if len(ratios) < 3:
        return None
    k = float(np.median(ratios))
    return k, float(1.4826 * np.median(np.abs(np.array(ratios) - k))), len(ratios)


def build(target: str | None = None, ra: float | None = None, dec: float | None = None, half: int = 24,
          dets=None, workers: int = 24, progress=None, slug: str | None = None,
          with_catalogs: bool = True, pack_half: int | None = None,
          images: list[dict] | None = None, listed: int | None = None, info: dict | None = None) -> pathlib.Path:
    info = info or (TARGETS.get(target, {}) if target else {})
    if info:
        ra, dec = info["center"]
    if ra is None or dec is None:
        raise SystemExit("give a known target or --ra/--dec")
    slug = slug or (target if target and half == 24 else None) or (f"{target}_h{half}" if target else default_slug(ra, dec, half))

    fetched = cube.fetch_field(ra, dec, half, dets, workers, progress, images=images)
    exps = frames.prepare(fetched)
    if not exps:
        raise SystemExit("no usable SPHEREx exposures at this position")
    asked = len(images) if images is not None else len(fetched)
    out = WEB / slug
    out.mkdir(parents=True, exist_ok=True)
    if pack_half is None and len(exps) > 900:
        pack_half = 12
    if pack_half and pack_half < half:
        d = half - pack_half
        cropped = []
        for e in exps:
            e = dict(e)
            e["data"] = e["data"][d:-d, d:-d]
            e["c"] = e["M"] @ np.array([d, d], float) + e["c"]
            cropped.append(e)
        exps, half = cropped, pack_half
    n = 2 * half + 1
    grid = frames.Grid(n * NATIVE)
    visits = frames.split_visits(exps)
    vis_of = {id(e): i for i, v in enumerate(visits) for e in v}

    cube_bytes = np.stack([e["data"] for e in exps]).astype("<f4").tobytes()
    net.write_atomic(out / "cube.f32", cube_bytes)

    band, stars = reference_stars(exps, grid)
    colours = []
    for v in visits:
        c = star_colour(v, grid, stars) if stars else None
        colours.append(None if c is None else {"k": round(c[0], 4), "scatter": round(c[1], 4), "n": c[2]})

    man = {
        "format": 1, "slug": slug, "name": info.get("name", f"{ra:.4f}, {dec:+.4f}"),
        "kind": info.get("kind", ""), "center": [ra, dec],
        "native": {"n": n, "scale": NATIVE}, "grid": {"n": grid.n, "scale": grid.scale},
        "default_band": info.get("default_band", "D2"), "group": info.get("group"),
        "astrometry": info.get("astrometry"), "challenge_coord": info.get("challenge_coord"),
        "bands": {k: list(v) for k, v in frames.BANDS.items()},
        "visits": [{"mjd": float(np.mean([e["mjd"] for e in v])), "year": float(mjd_to_year(np.mean([e["mjd"] for e in v]))),
                    "from": _date(v[0]["mjd"]), "to": _date(v[-1]["mjd"]), "n": len(v),
                    "star_colour_w2w1": colours[i]} for i, v in enumerate(visits)],
        "ref_band": band,
        "ref_stars": [{"xi": round(s["xi"], 2), "eta": round(s["eta"], 2), "snr": round(s["snr"], 1)} for s in stars],
        "exposures": [{
            "v": vis_of[id(e)], "mjd": round(e["mjd"], 6), "det": e["det"], "lam": round(e["lam"], 5),
            "bw": round(e["bw"], 5), "dlam": [round(float(x), 7) for x in e["dlam"]],
            "M": [round(float(x), 6) for x in e["M"].ravel()], "c": [round(float(x), 4) for x in e["c"]],
            "bg": round(e["bg"], 6), "sig": round(e["sig"], 6), "fwhm": _num(e["psf_fwhm"], 2),
            "omega": _num(e["omega"], 3) or 37.93, "id": e["obs_id"], "key": e["key"], "coll": e["collection"],
        } for e in exps],
        "provenance": {
            "source": "NASA SPHEREx Level-2 spectral images, NASA/IPAC Infrared Science Archive",
            "access": "s3://nasa-irsa-spherex (anonymous byte-range reads of the IMAGE extension)",
            "dois": sorted({e["doi"] for e in exps if e["doi"]}),
            "pipeline": sorted({e["pipever"] for e in exps}),
            "collections": sorted({e["collection"] for e in exps}),
        },
        "fetch": {"listed": listed if listed is not None else asked, "asked": asked, "used": len(exps), "half": half},
    }

    if with_catalogs:
        try:
            g = catalogs.gaia(ra, dec, max(0.065, round(grid.n * grid.scale / 3600.0 * 0.72, 3)))
            man["gaia"] = [{"ra": s["ra"], "dec": s["dec"], "pmra": s["pmra"], "pmdec": s["pmdec"],
                            "plx": s["plx"], "g": s["g"]} for s in g if s["g"] is not None and s["g"] < 19.5]
        except net.OfflineError:
            raise
        except Exception as ex:
            man["gaia_error"] = str(ex)[:160]
        try:
            w = catalogs.allwise_frames(ra, dec, grid)
            bands = [b for b in ("W1", "W2") if b in w]
            if bands:
                net.write_atomic(out / "wise.f32", np.stack([w[b] for b in bands]).astype("<f4").tobytes())
                man["wise"] = {"bands": bands, "mjd": list(w["mjd"]), "year": float(mjd_to_year(np.mean(w["mjd"]))),
                               "from": _date(w["mjd"][0]), "to": _date(w["mjd"][1]), "coadd": w["coadd"],
                               "doi": w["doi"], "source": "AllWISE Atlas image (WISE 2010), NASA/IPAC IRSA"}
        except net.OfflineError:
            raise
        except Exception as ex:
            man["wise_error"] = str(ex)[:160]

    net.write_atomic(out / "manifest.json", json.dumps(man, separators=(",", ":"), allow_nan=False))
    idx = WEB / "index.json"
    with _INDEX_LOCK:
        known = json.loads(idx.read_text(encoding="utf-8")) if idx.exists() else {}
        known[slug] = {"name": man["name"], "kind": man["kind"], "center": man["center"],
                       "n_exp": len(exps), "n_visits": len(visits), "fov": round(n * NATIVE / 60.0, 2),
                       **({"group": info["group"]} if info.get("group") else {}),
                       "extras": [n for n in ("analysis", "candidate", "variable") if (out / f"{n}.json").exists()]}
        net.write_atomic(idx, json.dumps(known, ensure_ascii=False, indent=1))
    return out


def load_package(slug: str):
    man = json.loads((WEB / slug / "manifest.json").read_text(encoding="utf-8"))
    n = man["native"]["n"]
    data = np.fromfile(WEB / slug / "cube.f32", "<f4").reshape(len(man["exposures"]), n, n)
    exps = []
    for i, m in enumerate(man["exposures"]):
        exps.append({
            "data": data[i], "M": np.array(m["M"], float).reshape(2, 2), "c": np.array(m["c"], float),
            "bg": m["bg"], "sig": m["sig"], "mjd": m["mjd"], "det": m["det"], "lam": m["lam"], "bw": m["bw"],
            "dlam": np.array(m["dlam"], float), "psf_fwhm": m["fwhm"] if m.get("fwhm") else np.nan,
            "omega": m["omega"], "obs_id": m["id"], "key": m["key"], "collection": m["coll"], "v": m["v"],
        })
    return man, exps
