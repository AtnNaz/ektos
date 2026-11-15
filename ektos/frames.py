from __future__ import annotations

import numpy as np
from scipy import ndimage

VISIT_GAP_DAYS = 60.0

BANDS = {
    "D1": (0.73, 1.13), "D2": (1.08, 1.67), "D3": (1.61, 2.44),
    "D4": (2.39, 3.87), "D5": (3.79, 4.45), "D6": (4.40, 5.03),
    "W1s": (3.0, 3.8), "W2s": (4.0, 5.03),
}
_DET_OF = {"D1": 1, "D2": 2, "D3": 3, "D4": 4, "D5": 5, "D6": 6}


class Grid:
    def __init__(self, fov_arcsec: float, scale: float = 3.075):
        n = int(round(fov_arcsec / scale))
        self.n = n + 1 if n % 2 == 0 else n
        self.scale = scale
        c = (self.n - 1) / 2.0
        r, col = np.mgrid[0:self.n, 0:self.n]
        self.xi = (c - col) * scale
        self.eta = (c - r) * scale

    def rc(self, xi, eta):
        c = (self.n - 1) / 2.0
        return c - np.asarray(eta) / self.scale, c - np.asarray(xi) / self.scale


def background(data: np.ndarray):
    v = data[np.isfinite(data)]
    if v.size < 30:
        return np.nan, np.nan
    med = np.median(v)
    sig = 1.4826 * np.median(np.abs(v - med))
    for _ in range(5):
        keep = np.abs(v - med) < 3.0 * sig
        if keep.sum() < 30:
            break
        med = np.median(v[keep])
        sig = 1.4826 * np.median(np.abs(v[keep] - med))
    return float(med), float(sig)


def prepare(exps: list[dict]) -> list[dict]:
    out = []
    for e in exps:
        if "bg" not in e:
            e["bg"], e["sig"] = background(e["data"])
        if np.isfinite(e["bg"]) and e["sig"] > 0 and np.isfinite(e["data"]).mean() > 0.5:
            out.append(e)
    return out


def reproject(e: dict, grid: Grid, shift=(0.0, 0.0)) -> np.ndarray:
    minv = np.linalg.inv(e["M"])
    dx = grid.xi + shift[0] - e["c"][0]
    dy = grid.eta + shift[1] - e["c"][1]
    col = minv[0, 0] * dx + minv[0, 1] * dy
    row = minv[1, 0] * dx + minv[1, 1] * dy
    return ndimage.map_coordinates(e["data"] - e["bg"], [row, col], order=1,
                                   mode="constant", cval=np.nan, prefilter=False)


def combine(exps: list[dict], grid: Grid, shifts=None, clip: bool = True):
    if not exps:
        nan = np.full((grid.n, grid.n), np.nan, np.float32)
        return nan, nan.copy(), np.zeros((grid.n, grid.n), np.int16)
    cube = np.stack([reproject(e, grid, (0.0, 0.0) if shifts is None else shifts[i])
                     for i, e in enumerate(exps)])
    sig = np.array([e["sig"] for e in exps])[:, None, None]
    w = np.where(np.isfinite(cube), 1.0 / sig ** 2, 0.0)
    if clip and len(exps) >= 3:
        med = np.nanmedian(cube, axis=0)
        bad = np.abs(cube - med) > np.maximum(8.0 * sig, 2.0 * np.abs(med))
        w[bad] = 0.0
    wsum = w.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        img = np.nansum(np.where(w > 0, cube, 0.0) * w, axis=0) / wsum
        err = 1.0 / np.sqrt(wsum)
    img[wsum == 0] = np.nan
    err[wsum == 0] = np.nan
    return img.astype(np.float32), err.astype(np.float32), (w > 0).sum(axis=0).astype(np.int16)


def noise_scale(img: np.ndarray, err: np.ndarray) -> float:
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (np.asarray(img, float) / np.asarray(err, float)).ravel()
    z = z[np.isfinite(z)]
    if z.size < 50:
        return 1.0
    med = np.median(z)
    return float(1.4826 * np.median(np.abs(z - med)))


def split_visits(exps: list[dict], gap: float = VISIT_GAP_DAYS, max_span: float = 60.0,
                 slice_days: float = 30.0) -> list[list[dict]]:
    exps = sorted(exps, key=lambda e: e["mjd"])
    passes, cur = [], []
    for e in exps:
        if cur and e["mjd"] - cur[-1]["mjd"] > gap:
            passes.append(cur)
            cur = []
        cur.append(e)
    if cur:
        passes.append(cur)
    visits = []
    for p in passes:
        span = p[-1]["mjd"] - p[0]["mjd"]
        if span <= max_span:
            visits.append(p)
            continue
        nseg = int(np.ceil(span / slice_days))
        width = span / nseg
        segs = [[] for _ in range(nseg)]
        for e in p:
            segs[min(nseg - 1, int((e["mjd"] - p[0]["mjd"]) / width))].append(e)
        visits.extend(s for s in segs if s)
    return visits


def in_band(e: dict, band: str) -> bool:
    if band == "ALL":
        return True
    if band in _DET_OF:
        return e["det"] == _DET_OF[band]
    lo, hi = BANDS[band]
    return lo <= e["lam"] <= hi


def select(exps: list[dict], band: str) -> list[dict]:
    return [e for e in exps if in_band(e, band)]
