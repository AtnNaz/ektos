from __future__ import annotations

import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

from . import net
from .archive import S3_HOST

NX = NY = 2040
BLOCK = 2880
_HEAD_BYTES = BLOCK * 11


def _split_headers(buf: bytes):
    out, off = [], 0
    while off + BLOCK <= len(buf):
        end = None
        pos = off
        while pos + BLOCK <= len(buf):
            blk = buf[pos:pos + BLOCK]
            pos += BLOCK
            if any(blk[i:i + 8] == b"END     " for i in range(0, BLOCK, 80)):
                end = pos
                break
        if end is None:
            break
        hdr = fits.Header.fromstring(buf[off:end].decode("ascii", "replace"))
        out.append((hdr, end))
        naxis = hdr.get("NAXIS", 0)
        size = 0
        if naxis:
            size = abs(hdr["BITPIX"]) // 8
            for i in range(1, naxis + 1):
                size *= hdr[f"NAXIS{i}"]
            size = (size + hdr.get("PCOUNT", 0)) * hdr.get("GCOUNT", 1)
        off = end + (size + BLOCK - 1) // BLOCK * BLOCK
        if size:
            break
    return out


def read_image_header(key: str):
    path = "/" + key
    buf, total = net.get_range(S3_HOST, path, 0, _HEAD_BYTES - 1)
    hdrs = _split_headers(buf)
    if len(hdrs) < 2:
        more, total = net.get_range(S3_HOST, path, 0, _HEAD_BYTES * 3 - 1)
        hdrs = _split_headers(more)
    if len(hdrs) < 2 or hdrs[1][0].get("EXTNAME") != "IMAGE":
        raise RuntimeError(f"unexpected FITS layout in {key}")
    primary, (ihdr, data_off) = hdrs[0][0], hdrs[1]
    if ihdr["BITPIX"] != -32 or ihdr["NAXIS1"] != NX or ihdr["NAXIS2"] != NY or "ZCMPTYPE" in ihdr:
        raise RuntimeError(f"IMAGE is not plain float32 {NX}x{NY} in {key}")
    ihdr["PIPEVER"] = str(primary.get("VERSION", ""))
    return ihdr, data_off, total


def read_wavetab(key: str):
    buf, _ = net.get_range(S3_HOST, "/" + key, suffix=BLOCK * 4)
    start = -1
    for off in range(0, len(buf), BLOCK):
        blk = buf[off:off + BLOCK]
        if blk.startswith(b"XTENSION= 'BINTABLE'") and b"'WCS-WAVE'" in blk:
            start = off
    if start < 0:
        raise RuntimeError(f"WCS-WAVE header not found in the tail of {key}")
    hdr = fits.Header.fromstring(buf[start:start + BLOCK].decode("ascii", "replace"))
    nx = int(str(hdr["TFORM1"]).strip().rstrip("J"))
    ny = int(str(hdr["TFORM2"]).strip().rstrip("J"))
    if (str(hdr["TFORM3"]).strip() != f"{2 * nx * ny}E" or hdr["NAXIS1"] != 4 * (nx + ny) + 8 * nx * ny
            or str(hdr.get("TDIM3", "")).replace(" ", "") != f"(2,{nx},{ny})"):
        raise RuntimeError(f"unexpected WCS-WAVE layout in {key}: {hdr['TFORM1']}, {hdr['TFORM2']}, {hdr['TFORM3']}")
    d = buf[start + BLOCK:]
    x = np.frombuffer(d, ">i4", nx, 0).astype(float)
    y = np.frombuffer(d, ">i4", ny, 4 * nx).astype(float)
    v = np.frombuffer(d, ">f4", 2 * nx * ny, 4 * (nx + ny)).reshape(ny, nx, 2).astype(float)
    if not (x[0] == 1 and x[-1] == NX and y[0] == 1 and y[-1] == NY
            and np.all(np.diff(x) > 0) and np.all(np.diff(y) > 0) and 0.6 < v[..., 0].min() and v[..., 0].max() < 5.5):
        raise RuntimeError(f"WCS-WAVE table failed sanity checks in {key}")
    return x, y, v[..., 0], v[..., 1]


def wave_at(tab, px: float, py: float):
    x, y, wave, bw = tab
    fx, fy = px + 1.0, py + 1.0
    i = int(np.clip(np.searchsorted(x, fx) - 1, 0, len(x) - 2))
    j = int(np.clip(np.searchsorted(y, fy) - 1, 0, len(y) - 2))
    tx = (fx - x[i]) / (x[i + 1] - x[i])
    ty = (fy - y[j]) / (y[j + 1] - y[j])

    def interp(g):
        return ((1 - tx) * (1 - ty) * g[j, i] + tx * (1 - ty) * g[j, i + 1]
                + (1 - tx) * ty * g[j + 1, i] + tx * ty * g[j + 1, i + 1])
    return float(interp(wave)), float(interp(bw))


def celestial_wcs(ihdr) -> WCS:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        return WCS(ihdr)


def read_window(key: str, data_off: int, x0: int, y0: int, w: int, h: int) -> np.ndarray:
    out = np.full((h, w), np.nan, dtype=np.float32)
    xa, xb = max(x0, 0), min(x0 + w, NX)
    if xb <= xa:
        return out
    path = "/" + key
    for row in range(max(y0, 0), min(y0 + h, NY)):
        a = data_off + (row * NX + xa) * 4
        buf, _ = net.get_range(S3_HOST, path, a, a + (xb - xa) * 4 - 1)
        out[row - y0, xa - x0:xb - x0] = np.frombuffer(buf, ">f4")
    return out
