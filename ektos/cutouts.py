from __future__ import annotations

import concurrent.futures as cf
import csv
import json
import pathlib
import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

from . import _console, archive, cube, net, remote
from .geom import tan_project


def _manifest(folder: pathlib.Path) -> dict[str, dict]:
    out = {}
    p = folder / "manifest.csv"
    if not p.exists():
        return out
    with open(p, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["file"]] = r
    return out


def collection_of(did: str, file_name: str = "") -> str:
    if "?" in did:
        return did.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    for c in sorted(archive.COLLECTIONS, key=len, reverse=True):
        if f"_{c}_" in file_name:
            return c
    return ""


def read_exposure(path: pathlib.Path, ra0: float, dec0: float, half: int = 24, row: dict | None = None) -> dict | None:
    with fits.open(path, memmap=False) as h:
        ihdr = h["IMAGE"].header
        img = np.asarray(h["IMAGE"].data, dtype=np.float32)
        pipever = str(h[0].header.get("VERSION", ""))
        w = h["WCS-WAVE"].data[0]
        tab = (np.asarray(w["X"], float), np.asarray(w["Y"], float),
               np.asarray(w["VALUES"], float)[..., 0], np.asarray(w["VALUES"], float)[..., 1])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        wcs = WCS(ihdr)
    px, py = (float(v) for v in wcs.all_world2pix(ra0, dec0, 0))
    ny, nx = img.shape
    if not (-0.5 <= px <= nx - 0.5 and -0.5 <= py <= ny - 0.5):
        return None
    n = 2 * half + 1
    x0, y0 = int(round(px)) - half, int(round(py)) - half
    data = np.full((n, n), np.nan, dtype=np.float32)
    xa, xb, ya, yb = max(x0, 0), min(x0 + n, nx), max(y0, 0), min(y0 + n, ny)
    if xb > xa and yb > ya:
        data[ya - y0:yb - y0, xa - x0:xb - x0] = img[ya:yb, xa:xb]

    g = np.linspace(0, n - 1, 5)
    cc, rr = np.meshgrid(g, g)
    ra, dec = wcs.all_pix2world(cc.ravel() + x0, rr.ravel() + y0, 0)
    xi, eta = tan_project(ra, dec, ra0, dec0)
    A = np.column_stack([cc.ravel(), rr.ravel(), np.ones(cc.size)])
    sol_x, *_ = np.linalg.lstsq(A, xi, rcond=None)
    sol_y, *_ = np.linalg.lstsq(A, eta, rcond=None)
    aff_err = float(max(np.abs(A @ sol_x - xi).max(), np.abs(A @ sol_y - eta).max()))

    dx, dy = px + 1.0 - float(ihdr["CRPIX1A"]), py + 1.0 - float(ihdr["CRPIX2A"])
    lam, bw = remote.wave_at(tab, dx, dy)
    lam_x, _ = remote.wave_at(tab, dx + 1, dy)
    lam_y, _ = remote.wave_at(tab, dx, dy + 1)

    row = row or {}
    coll = collection_of(row.get("obs_publisher_did", ""), path.name)
    uri = row.get("uri", "")
    key = uri.split("ibe/data/spherex/", 1)[1] if "ibe/data/spherex/" in uri else path.name
    return {
        "data": data, "x0": x0, "y0": y0, "px": px, "py": py,
        "M": np.array([[sol_x[0], sol_x[1]], [sol_y[0], sol_y[1]]]),
        "c": np.array([sol_x[2], sol_y[2]]), "aff_err": aff_err,
        "mjd": float(ihdr["MJD-AVG"]), "exptime": float(ihdr.get("XPOSURE", 0.0)),
        "det": int(ihdr["DETECTOR"]), "lam": lam, "bw": bw, "dlam": np.array([lam_x - lam, lam_y - lam]),
        "psf_fwhm": float(ihdr.get("PSF_FWHM", np.nan)), "omega": float(ihdr.get("OMEGA_MEDIAN", 37.93)),
        "sc_km": np.array([ihdr.get("X_SC", np.nan), ihdr.get("Y_SC", np.nan), ihdr.get("Z_SC", np.nan)], float),
        "obs_id": str(ihdr["OBSID"]), "key": key, "pipever": pipever,
        "collection": coll, "doi": row.get("doi", archive.DOIS.get(coll, "")),
        "survey": str(ihdr.get("SPS_FLAGS", "")), "dqa": str(ihdr.get("L2DQAFLG", "")),
    }


def import_field(folder, ra0: float, dec0: float, half: int = 24, workers: int = 8, progress=None,
                 max_n: int | None = None) -> list[dict]:
    folder = pathlib.Path(folder)
    man = _manifest(folder)
    files = sorted((folder / "cutouts").glob("*.fits"))
    if max_n and len(files) > max_n:
        files = [files[i] for i in np.unique(np.round(np.linspace(0, len(files) - 1, max_n)).astype(int))]
    d = cube.field_dir(ra0, dec0, half)
    listing, skipped, done = [], [], 0

    def work(p):
        try:
            row = man.get(p.name)
            e = read_exposure(p, ra0, dec0, half, row)
            if e is None:
                return p.name, None, "position outside the cutout"
            out = d / f"{e['obs_id']}_D{e['det']}.npz"
            if not out.exists():
                cube._save(out, e)
            return p.name, {
                "obs_id": e["obs_id"], "det": e["det"], "collection": e["collection"], "doi": e["doi"], "key": e["key"],
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/" + e["key"], "mjd": e["mjd"],
                "exptime": e["exptime"], "release": (row or {}).get("datarelease", ""),
            }, None
        except Exception as ex:
            return p.name, None, str(ex)[:120]

    with cf.ThreadPoolExecutor(workers) as ex:
        for name, rec, err in ex.map(work, files):
            done += 1
            if rec:
                listing.append(rec)
            else:
                skipped.append((name, err))
            if progress and (done % 50 == 0 or done == len(files)):
                progress(done, len(files))
    seen, uniq = set(), []
    for r in sorted(listing, key=lambda r: r["mjd"]):
        k = (r["obs_id"], r["det"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    if uniq:
        net.write_atomic(d / "listing.json", json.dumps(uniq))
    if skipped:
        net.write_atomic(d / "skipped.json", json.dumps(skipped, indent=1))
    return uniq


if __name__ == "__main__":
    import argparse
    import time
    _console.utf8_stdout()
    ap = argparse.ArgumentParser(prog="ektos.cutouts")
    ap.add_argument("folder")
    ap.add_argument("--ra", type=float, required=True)
    ap.add_argument("--dec", type=float, required=True)
    ap.add_argument("--half", type=int, default=24)
    ap.add_argument("--max", type=int, default=0)
    a = ap.parse_args()
    t0 = time.time()
    lst = import_field(a.folder, a.ra, a.dec, a.half, max_n=a.max or None,
                       progress=lambda i, n: print(f"  {i}/{n} files", flush=True))
    print(f"{len(lst)} exposures in the cache for ({a.ra}, {a.dec}), {time.time() - t0:.0f}s, no network used")
