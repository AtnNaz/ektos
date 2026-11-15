from __future__ import annotations

import concurrent.futures as cf
import json
import pathlib
import threading
import time

import numpy as np

from . import archive, net, remote
from .geom import tan_project

CACHE = pathlib.Path(__file__).resolve().parent.parent / "cache"
LISTING_MAX_AGE = 6 * 3600.0
_wavetab_lock = threading.Lock()
_wavetabs: dict[tuple, tuple] = {}


def field_dir(ra0: float, dec0: float, half: int, create: bool = True) -> pathlib.Path:
    d = CACHE / f"f_{ra0:.5f}_{dec0:+.5f}_h{half}"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def _wavetab(key: str, det: int, pipever: str):
    k = (det, pipever)
    with _wavetab_lock:
        if k in _wavetabs:
            return _wavetabs[k]
    tab = remote.read_wavetab(key)
    with _wavetab_lock:
        _wavetabs[k] = tab
    return tab


def fetch_exposure(img: dict, ra0: float, dec0: float, half: int) -> dict:
    ihdr, data_off, total = remote.read_image_header(img["key"])
    wcs = remote.celestial_wcs(ihdr)
    px, py = (float(v) for v in wcs.all_world2pix(ra0, dec0, 0))
    n = 2 * half + 1
    x0, y0 = int(round(px)) - half, int(round(py)) - half
    data = remote.read_window(img["key"], data_off, x0, y0, n, n)

    g = np.linspace(0, n - 1, 5)
    cc, rr = np.meshgrid(g, g)
    ra, dec = wcs.all_pix2world(cc.ravel() + x0, rr.ravel() + y0, 0)
    xi, eta = tan_project(ra, dec, ra0, dec0)
    A = np.column_stack([cc.ravel(), rr.ravel(), np.ones(cc.size)])
    sol_x, *_ = np.linalg.lstsq(A, xi, rcond=None)
    sol_y, *_ = np.linalg.lstsq(A, eta, rcond=None)
    aff_err = float(max(np.abs(A @ sol_x - xi).max(), np.abs(A @ sol_y - eta).max()))

    pipever = ihdr.get("PIPEVER", "")
    tab = _wavetab(img["key"], img["det"], pipever)
    lam, bw = remote.wave_at(tab, px, py)
    lam_x, _ = remote.wave_at(tab, px + 1, py)
    lam_y, _ = remote.wave_at(tab, px, py + 1)

    return {
        "data": data, "x0": x0, "y0": y0, "px": px, "py": py,
        "M": np.array([[sol_x[0], sol_x[1]], [sol_y[0], sol_y[1]]]),
        "c": np.array([sol_x[2], sol_y[2]]), "aff_err": aff_err,
        "mjd": float(ihdr.get("MJD-AVG", img["mjd"])), "exptime": float(ihdr.get("XPOSURE", img["exptime"])),
        "det": img["det"], "lam": lam, "bw": bw, "dlam": np.array([lam_x - lam, lam_y - lam]),
        "psf_fwhm": float(ihdr.get("PSF_FWHM", np.nan)), "omega": float(ihdr.get("OMEGA_MEDIAN", 37.93)),
        "sc_km": np.array([ihdr.get("X_SC", np.nan), ihdr.get("Y_SC", np.nan), ihdr.get("Z_SC", np.nan)], float),
        "obs_id": img["obs_id"], "key": img["key"], "pipever": pipever,
        "collection": img["collection"], "doi": img["doi"],
        "survey": str(ihdr.get("SPS_FLAGS", "")), "dqa": str(ihdr.get("L2DQAFLG", "")),
    }


_ARR = ("data", "M", "c", "dlam", "sc_km")


def _save(path: pathlib.Path, e: dict):
    meta = {k: v for k, v in e.items() if k not in _ARR}
    net.write_atomic(path, writer=lambda f: np.savez_compressed(f, meta=json.dumps(meta), **{k: e[k] for k in _ARR}))


def _load(path: pathlib.Path) -> dict:
    with np.load(path, allow_pickle=False) as z:
        e = json.loads(str(z["meta"]))
        for k in _ARR:
            e[k] = z[k]
    return e


def _load_or_drop(path: pathlib.Path) -> dict | None:
    try:
        return _load(path)
    except PermissionError:
        raise
    except Exception as ex:
        why = net.describe(ex)
    net.drop_corrupt(path, why)
    return None


def _read_listing(path: pathlib.Path) -> list[dict] | None:
    if not path.exists():
        return None
    try:
        images = json.loads(path.read_text())
        if not isinstance(images, list) or not all(isinstance(i, dict) and "obs_id" in i and "det" in i for i in images):
            raise ValueError("not a list of exposures")
        return images
    except PermissionError:
        raise
    except (OSError, ValueError) as ex:
        why = net.describe(ex)
    net.drop_corrupt(path, why)
    return None


def list_field(ra0: float, dec0: float, half: int = 24, max_age: float | None = LISTING_MAX_AGE,
               offline: bool | None = None):
    offline = net.offline() if offline is None else offline
    listing = field_dir(ra0, dec0, half, create=not offline) / "listing.json"
    saved = _read_listing(listing)
    if saved is not None and (offline or max_age is None or time.time() - listing.stat().st_mtime < max_age):
        return saved, []
    if offline:
        raise net.OfflineError(f"{net.OFFLINE_ENV}=1: no saved exposure list for ({ra0:.5f}, {dec0:+.5f}, half {half}) "
                               f"in {listing.parent}")
    failed: list[str] = []
    images = archive.find_images(ra0, dec0, failed=failed)
    if images and not failed:
        net.write_atomic(listing, json.dumps(images))
    elif failed and saved is not None:
        if len(saved) >= len(images):
            images = saved
    return images, failed


def thin(images: list[dict], max_n: int | None) -> list[dict]:
    if not max_n or len(images) <= max_n:
        return images
    idx = np.unique(np.round(np.linspace(0, len(images) - 1, max_n)).astype(int))
    return [images[i] for i in idx]


def estimate_bytes(n_exposures: int, half: int) -> int:
    n = 2 * half + 1
    return n_exposures * (remote._HEAD_BYTES + net.OVERHEAD + n * (4 * n + net.OVERHEAD))


def fetch_field(ra0: float, dec0: float, half: int = 24, dets=None, workers: int = 24,
                progress=None, limit: int | None = None, images: list[dict] | None = None,
                offline: bool | None = None) -> list[dict]:
    offline = net.offline() if offline is None else offline
    d = field_dir(ra0, dec0, half, create=not offline)
    if images is None:
        images, _ = list_field(ra0, dec0, half, offline=offline)
    if dets:
        images = [i for i in images if i["det"] in dets]
    if limit:
        images = images[:limit]

    def path_of(i):
        return d / f"{i['obs_id']}_D{i['det']}.npz"

    def missing_error(n):
        return net.OfflineError(f"{net.OFFLINE_ENV}=1: {n} of {len(images)} exposures of ({ra0:.5f}, {dec0:+.5f}, "
                                f"half {half}) are not in the cache {d}")

    todo = [i for i in images if not path_of(i).exists()]
    if todo and offline:
        raise missing_error(len(todo))
    done, failed = len(images) - len(todo), []
    lock = threading.Lock()

    def work(img):
        nonlocal done
        try:
            e = fetch_exposure(img, ra0, dec0, half)
            _save(path_of(img), e)
        except Exception as ex:
            with lock:
                failed.append((img["obs_id"], img["det"], str(ex)[:120]))
        with lock:
            done += 1
            if progress:
                progress(done, len(images), net.METER.snapshot())

    def download(batch):
        if batch:
            with cf.ThreadPoolExecutor(workers) as ex:
                list(ex.map(work, batch))

    download(todo)
    loaded, redo = {}, []
    for k, i in enumerate(images):
        if path_of(i).exists():
            e = _load_or_drop(path_of(i))
            if e is None:
                redo.append((k, i))
            else:
                loaded[k] = e
    if redo:
        if offline:
            raise missing_error(len(redo))
        done -= len(redo)
        download([i for _, i in redo])
        for k, i in redo:
            if path_of(i).exists():
                e = _load_or_drop(path_of(i))
                if e is not None:
                    loaded[k] = e
    out = [loaded[k] for k in sorted(loaded)]
    out.sort(key=lambda e: e["mjd"])
    if failed:
        net.write_atomic(d / "failed.json", json.dumps(failed, indent=1))
    return out
