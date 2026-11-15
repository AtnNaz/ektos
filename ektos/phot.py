from __future__ import annotations

import numpy as np
from scipy import optimize

ARCSEC2_PER_SR = 4.254517e10
FWHM2SIG = 1.0 / 2.354820045


def fit_centroid(img, err, grid, xi0, eta0, box_arcsec: float = 22.0, fwhm0: float = 9.0):
    m = (np.abs(grid.xi - xi0) <= box_arcsec / 2) & (np.abs(grid.eta - eta0) <= box_arcsec / 2) & np.isfinite(img)
    if m.sum() < 25:
        return None
    x, y, z = grid.xi[m], grid.eta[m], img[m].astype(float)
    over = max(1.0, 6.15 / grid.scale)
    s = np.where(np.isfinite(err[m]) & (err[m] > 0), err[m], np.nanmedian(err)).astype(float) * over

    def model(p):
        a, cx, cy, sg, b = p
        return a * np.exp(-0.5 * ((x - cx) ** 2 + (y - cy) ** 2) / sg ** 2) + b

    p0 = [max(z.max() - np.median(z), 1e-6), xi0, eta0, fwhm0 * FWHM2SIG, np.median(z)]
    lo = [0, xi0 - box_arcsec / 2, eta0 - box_arcsec / 2, 2.0, -np.inf]
    hi = [np.inf, xi0 + box_arcsec / 2, eta0 + box_arcsec / 2, 8.0, np.inf]
    try:
        r = optimize.least_squares(lambda p: (model(p) - z) / s, p0, bounds=(lo, hi))
    except Exception:
        return None
    dof = max(1, m.sum() - 5)
    chi2r = float((r.fun ** 2).sum() / dof)
    try:
        cov = np.linalg.inv(r.jac.T @ r.jac) * max(1.0, chi2r)
    except np.linalg.LinAlgError:
        return None
    a, cx, cy, sg, b = r.x
    ea = np.sqrt(cov[0, 0])
    return {"xi": float(cx), "eta": float(cy), "e_xi": float(np.sqrt(cov[1, 1])),
            "e_eta": float(np.sqrt(cov[2, 2])), "amp": float(a), "fwhm": float(sg / FWHM2SIG),
            "snr": float(a / ea) if ea > 0 else 0.0, "chi2r": chi2r}


def _pixel_of(e, xi, eta):
    d = np.linalg.solve(e["M"], np.array([xi - e["c"][0], eta - e["c"][1]]))
    return float(d[0]), float(d[1])


def forced_flux(e, xi, eta, box: int = 7, neighbours=()):
    col, row = _pixel_of(e, xi, eta)
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
    scale = np.sqrt(abs(np.linalg.det(e["M"])))
    fwhm = e["psf_fwhm"] if np.isfinite(e["psf_fwhm"]) else 8.0
    sg = fwhm * FWHM2SIG / scale

    def psf(c, r):
        p = np.exp(-0.5 * ((cc - c) ** 2 + (rr - r) ** 2) / sg ** 2)
        return p / (2 * np.pi * sg ** 2)

    cols = [psf(col, row)[good]]
    for nxi, neta in neighbours:
        nc, nr = _pixel_of(e, nxi, neta)
        if abs(nc - col) < box and abs(nr - row) < box:
            cols.append(psf(nc, nr)[good])
    cols.append(np.ones(good.sum()))
    A = np.column_stack(cols)
    try:
        ata_inv = np.linalg.inv(A.T @ A)
    except np.linalg.LinAlgError:
        return None
    sol = ata_inv @ (A.T @ sub[good])
    to_ujy = e["omega"] / ARCSEC2_PER_SR * 1e12
    return float(sol[0] * to_ujy), float(np.sqrt(ata_inv[0, 0]) * e["sig"] * to_ujy), int(good.sum())


def spectrum(exps, track, neighbours=(), box: int = 7):
    rows = []
    for e in exps:
        xi, eta = track(e["mjd"])
        r = forced_flux(e, xi, eta, box, neighbours)
        if r is not None:
            rows.append((e["lam"], e["bw"], r[0], r[1], e["mjd"], e["det"]))
    out = np.array(rows, dtype=[("lam", "f8"), ("bw", "f8"), ("flux", "f8"), ("err", "f8"),
                                ("mjd", "f8"), ("det", "i4")])
    return np.sort(out, order="lam")


def weighted_mean(v, e):
    w = 1.0 / np.asarray(e) ** 2
    return float(np.sum(w * v) / np.sum(w)), float(1.0 / np.sqrt(np.sum(w)))
