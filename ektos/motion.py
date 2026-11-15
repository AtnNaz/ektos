from __future__ import annotations

import numpy as np

from .geom import mjd_to_year, parallax_factors, propagate, tan_project


def _xieta(ra, dec, center):
    x, y = tan_project(np.asarray(ra, float), np.asarray(dec, float), center[0], center[1])
    return np.asarray(x, float), np.asarray(y, float)


def gaia_at(gaia, mjd, center, gmax=18.0):
    keep = [g for g in gaia if g["g"] is not None and g["g"] < gmax and g["pmra"] is not None]
    xs, ys = [], []
    for g in keep:
        ra, dec = propagate(g["ra"], g["dec"], 2016.0, g["pmra"] / 1e3, g["pmdec"] / 1e3, mjd,
                            max(0.0, (g["plx"] or 0.0)) / 1e3)
        x, y = _xieta(ra[0], dec[0], center)
        xs.append(float(x)); ys.append(float(y))
    return np.array(xs), np.array(ys), keep


def split_epochs(mjd, gap=30.0):
    order = np.argsort(mjd)
    if len(order) == 0:
        return []
    groups, cur = [], [order[0]]
    for i in order[1:]:
        if mjd[i] - mjd[cur[-1]] > gap:
            groups.append(np.array(cur)); cur = []
        cur.append(i)
    groups.append(np.array(cur))
    return groups


def _robust_mean(v, e):
    v, e = np.asarray(v, float), np.asarray(e, float)
    med = np.median(v)
    mad = 1.4826 * np.median(np.abs(v - med)) or np.median(e)
    k = np.abs(v - med) <= 3.0 * max(mad, 1e-3)
    v, e = v[k], e[k]
    w = 1.0 / e ** 2
    m = np.sum(w * v) / np.sum(w)
    err = 1.0 / np.sqrt(np.sum(w))
    if len(v) > 2:
        chi2r = np.sum(w * (v - m) ** 2) / (len(v) - 1)
        err *= max(1.0, np.sqrt(chi2r))
    return float(m), float(err), int(k.sum())


def wise_epochs(dets, ast, center, gaia, tol=5.0, star_tol=2.5, min_snr=3.0, min_det=4):
    d = [x for x in dets if np.isfinite(x["w2snr"]) and x["w2snr"] >= min_snr and x["qual"] > 0
         and np.isfinite(x["sigra"]) and x["sigra"] < 2.5]
    if not d:
        return []
    mjd = np.array([x["mjd"] for x in d])
    xi, eta = _xieta([x["ra"] for x in d], [x["dec"] for x in d], center)
    sx = np.array([x["sigra"] for x in d]); sy = np.array([x["sigdec"] for x in d])
    out = []
    for g in split_epochs(mjd):
        t = float(np.mean(mjd[g]))
        gx, gy, _ = gaia_at(gaia, t, center)
        offs_x, offs_y = [], []
        for j in range(len(gx)):
            near = g[np.hypot(xi[g] - gx[j], eta[g] - gy[j]) < star_tol]
            if len(near) >= 4:
                offs_x.append(np.median(xi[near]) - gx[j]); offs_y.append(np.median(eta[near]) - gy[j])
        if len(offs_x) >= 3:
            ox, oy = float(np.median(offs_x)), float(np.median(offs_y))
            eox = float(1.4826 * np.median(np.abs(np.array(offs_x) - ox)) / np.sqrt(len(offs_x)))
            eoy = float(1.4826 * np.median(np.abs(np.array(offs_y) - oy)) / np.sqrt(len(offs_y)))
        else:
            ox = oy = 0.0; eox = eoy = 0.15
        ra, dec = propagate(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], t, 0.0)
        px, py = _xieta(ra[0], dec[0], center)
        near = g[np.hypot(xi[g] - px, eta[g] - py) < tol]
        if len(gx):
            clean = [i for i in near if np.min(np.hypot(gx - xi[i], gy - eta[i])) > star_tol]
            near = np.array(clean, dtype=int)
        if len(near) < min_det:
            continue
        mx, ex, n1 = _robust_mean(xi[near], sx[near])
        my, ey, n2 = _robust_mean(eta[near], sy[near])
        out.append({"mjd": t, "xi": mx - ox, "eta": my - oy, "e_xi": float(np.hypot(ex, eox)),
                    "e_eta": float(np.hypot(ey, eoy)), "n": min(n1, n2), "n_ref": len(offs_x),
                    "off_xi": ox, "off_eta": oy, "src": "WISE"})
    return out


def fit5(epochs, ref_ra, ref_dec, center, t_ref=None, fit_plx=True):
    n = len(epochs)
    cols = 5 if fit_plx else 4
    if 2 * n - cols < 1:
        raise ValueError(f"fit5: {n} epoch(s) give {2 * n} coordinates for {cols} parameters; "
                         f"at least {cols // 2 + 1} epochs are needed")
    mjd = np.array([e["mjd"] for e in epochs]); yr = mjd_to_year(mjd)
    t_ref = float(np.mean(yr)) if t_ref is None else t_ref
    pa, pd = parallax_factors(ref_ra, ref_dec, mjd)
    A = np.zeros((2 * n, cols)); y = np.zeros(2 * n); s = np.zeros(2 * n)
    for i, e in enumerate(epochs):
        A[2 * i, 0] = 1; A[2 * i, 2] = yr[i] - t_ref
        A[2 * i + 1, 1] = 1; A[2 * i + 1, 3] = yr[i] - t_ref
        if fit_plx:
            A[2 * i, 4] = pa[i]; A[2 * i + 1, 4] = pd[i]
        y[2 * i], y[2 * i + 1] = e["xi"], e["eta"]
        s[2 * i], s[2 * i + 1] = e["e_xi"], e["e_eta"]
    Aw, yw = A / s[:, None], y / s
    try:
        cov = np.linalg.inv(Aw.T @ Aw)
    except np.linalg.LinAlgError as ex:
        raise ValueError(f"fit5: the {n} epochs do not constrain all {cols} parameters ({ex})") from ex
    p = cov @ (Aw.T @ yw)
    res = y - A @ p
    chi2 = float(np.sum((res / s) ** 2)); dof = 2 * n - cols
    scale = max(1.0, chi2 / dof)
    err = np.sqrt(np.diag(cov) * scale)
    names = ["xi0", "eta0", "pm_xi", "pm_eta"] + (["plx"] if fit_plx else [])
    return {"t_ref": t_ref, **{k: float(v) for k, v in zip(names, p)},
            **{"e_" + k: float(v) for k, v in zip(names, err)},
            "chi2": chi2, "dof": dof, "res_xi": res[0::2].tolist(), "res_eta": res[1::2].tolist(),
            "pa": pa.tolist(), "pd": pd.tolist()}
