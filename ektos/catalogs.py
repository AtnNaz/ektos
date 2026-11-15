from __future__ import annotations

import csv
import io
import json
import pathlib
import urllib.parse
import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy import ndimage

from . import net
from .geom import tan_deproject

TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
SIA = "https://irsa.ipac.caltech.edu/SIA"
CACHE = pathlib.Path(__file__).resolve().parent.parent / "cache" / "catalog"


def _tag(ra, dec):
    return f"{ra:.4f}_{dec:+.4f}"


def _cached(p: pathlib.Path, read, fetch, what: str):
    if p.exists():
        try:
            return read(p)
        except PermissionError:
            raise
        except Exception as ex:
            why = net.describe(ex)
        net.drop_corrupt(p, why)
    net.require_online(f"{what} ({p.name} is not in the cache {p.parent})")
    net.write_atomic(p, fetch())
    try:
        return read(p)
    except Exception as ex:
        why = net.describe(ex)
    net.drop_corrupt(p, why)
    raise RuntimeError(f"unreadable answer for {what}: {why}")


def _read_csv(p: pathlib.Path) -> list[dict]:
    r = csv.DictReader(io.StringIO(p.read_text(encoding="utf-8")))
    if not r.fieldnames:
        raise ValueError("no header line")
    return list(r)


def tap(query: str, cache_name: str, timeout: float = 300) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)

    def fetch():
        body = net.get_url(TAP + "?" + urllib.parse.urlencode({"QUERY": query, "FORMAT": "CSV"}),
                           timeout=timeout, retries=2)
        if body.lstrip().lower().startswith((b"<", b"error")):
            raise RuntimeError("TAP error: " + body[:200].decode("utf-8", "replace"))
        return body
    return _cached(CACHE / cache_name, _read_csv, fetch, "IRSA TAP query")


def gaia(ra: float, dec: float, radius_deg: float = 0.065) -> list[dict]:
    name = f"gaia_{_tag(ra, dec)}.csv" if radius_deg == 0.065 else f"gaia_{_tag(ra, dec)}_r{radius_deg:.3f}.csv"
    rows = tap("SELECT source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag FROM gaia_dr3_source "
               f"WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius_deg}))=1", name)
    out = []
    for r in rows:
        f = lambda k: float(r[k]) if r.get(k) not in (None, "", "null") else None
        out.append({"id": r["source_id"], "ra": f("ra"), "dec": f("dec"), "pmra": f("pmra"),
                    "pmdec": f("pmdec"), "plx": f("parallax"), "g": f("phot_g_mean_mag")})
    return out


def wise_single_exposures(ra: float, dec: float, radius_deg: float = 0.03) -> list[dict]:
    cols = "ra,dec,sigra,sigdec,mjd,w1mpro,w2mpro,w2sigmpro,w2snr,cc_flags,qual_frame"
    cone = f"CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius_deg}))=1"
    out = []
    for tbl in ("allsky_4band_p1bs_psd", "allsky_3band_p1bs_psd", "allsky_2band_p1bs_psd", "neowiser_p1bs_psd"):
        try:
            rows = tap(f"SELECT {cols} FROM {tbl} WHERE {cone}", f"wise1b_{tbl}_{_tag(ra, dec)}.csv")
        except net.OfflineError:
            raise
        except RuntimeError:
            continue
        for r in rows:
            try:
                out.append({"ra": float(r["ra"]), "dec": float(r["dec"]), "sigra": float(r["sigra"]),
                            "sigdec": float(r["sigdec"]), "mjd": float(r["mjd"]),
                            "w2": float(r["w2mpro"]) if r["w2mpro"] else np.nan,
                            "w2snr": float(r["w2snr"]) if r["w2snr"] else np.nan,
                            "w1": float(r["w1mpro"]) if r["w1mpro"] else np.nan,
                            "qual": int(r["qual_frame"] or 0), "table": tbl})
            except (ValueError, KeyError):
                continue
    return out


def allwise_frames(ra: float, dec: float, grid, size_deg: float = 0.12) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)

    def fetch_meta():
        q = urllib.parse.urlencode({"COLLECTION": "wise_allwise", "POS": f"circle {ra} {dec} 0.001",
                                    "RESPONSEFORMAT": "CSV"})
        rows = list(csv.DictReader(io.StringIO(net.get_url(f"{SIA}?{q}").decode("utf-8", "replace"))))
        sel = {}
        for r in rows:
            b = r.get("energy_bandpassname")
            if r.get("dataproduct_subtype") == "science" and b in ("W1", "W2") and b not in sel:
                sel[b] = {"url": r["access_url"], "t_min": float(r["t_min"]), "t_max": float(r["t_max"])}
        return json.dumps(sel)

    def read_meta(p):
        sel = json.loads(p.read_text())
        if not isinstance(sel, dict) or not all({"url", "t_min", "t_max"} <= set(v) for v in sel.values()):
            raise ValueError("not an AllWISE image list")
        return sel

    sel = _cached(CACHE / f"allwise_{_tag(ra, dec)}.json", read_meta, fetch_meta, "the AllWISE image list")
    out = {"doi": "10.26131/IRSA153"}
    need = round(grid.n * grid.scale / 3600.0 * 1.06, 3)
    wide = need > size_deg
    size_deg = max(size_deg, need)

    def read_image(p):
        with fits.open(p) as h:
            data = h[0].data
            if data is None or data.ndim != 2:
                raise ValueError("no 2-D image in the primary HDU")
            data = data.astype(float)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                w = WCS(h[0].header)
            return data, w, float(h[0].header.get("MAGZP", np.nan))

    for b, info in sel.items():
        p = CACHE / (f"allwise_{b}_{_tag(ra, dec)}_s{size_deg:.3f}.fits" if wide else f"allwise_{b}_{_tag(ra, dec)}.fits")

        def fetch_image(info=info):
            body = net.get_url(f"{info['url']}?center={ra},{dec}&size={size_deg}&gzip=false", timeout=120)
            if not body.startswith(b"SIMPLE  ="):
                raise RuntimeError("AllWISE cutout service did not return a FITS file: "
                                   + body[:120].decode("utf-8", "replace"))
            return body
        data, w, magzp = _cached(p, read_image, fetch_image, f"the AllWISE {b} image")
        acc = np.zeros((grid.n, grid.n))
        for dx in (-1 / 3, 0, 1 / 3):
            for dy in (-1 / 3, 0, 1 / 3):
                rr, dd = tan_deproject(grid.xi + dx * grid.scale, grid.eta + dy * grid.scale, ra, dec)
                px, py = w.all_world2pix(rr, dd, 0)
                acc += ndimage.map_coordinates(data, [py, px], order=1, mode="constant", cval=np.nan)
        img = acc / 9.0
        img -= np.nanmedian(img)
        out[b] = img.astype(np.float32)
        out["mjd"] = (info["t_min"], info["t_max"])
        out["magzp_" + b] = magzp
        out["coadd"] = info["url"].rsplit("/", 2)[-2]
    return out
