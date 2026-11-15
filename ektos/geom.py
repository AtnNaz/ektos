from __future__ import annotations

import numpy as np

ARCSEC = 206264.80624709636
MJD_J2000 = 51544.5


def tan_project(ra, dec, ra0, dec0):
    ra, dec = np.radians(ra), np.radians(dec)
    a0, d0 = np.radians(ra0), np.radians(dec0)
    cosc = np.sin(d0) * np.sin(dec) + np.cos(d0) * np.cos(dec) * np.cos(ra - a0)
    xi = np.cos(dec) * np.sin(ra - a0) / cosc
    eta = (np.cos(d0) * np.sin(dec) - np.sin(d0) * np.cos(dec) * np.cos(ra - a0)) / cosc
    return xi * ARCSEC, eta * ARCSEC


def tan_deproject(xi, eta, ra0, dec0):
    x, y = np.asarray(xi) / ARCSEC, np.asarray(eta) / ARCSEC
    a0, d0 = np.radians(ra0), np.radians(dec0)
    den = np.cos(d0) - y * np.sin(d0)
    ra = a0 + np.arctan2(x, den)
    dec = np.arctan2((np.sin(d0) + y * np.cos(d0)) * np.cos(ra - a0), den)
    return np.degrees(ra) % 360.0, np.degrees(dec)


def mjd_to_year(mjd):
    return 2000.0 + (np.asarray(mjd, dtype=float) - MJD_J2000) / 365.25


def year_to_mjd(year):
    return MJD_J2000 + (np.asarray(year, dtype=float) - 2000.0) * 365.25


def earth_barycentric_au(mjd):
    from astropy.coordinates import get_body_barycentric
    from astropy.time import Time
    p = get_body_barycentric("earth", Time(np.atleast_1d(mjd), format="mjd", scale="utc"),
                             ephemeris="builtin")
    return np.stack([p.x.to_value("au"), p.y.to_value("au"), p.z.to_value("au")], axis=-1)


def parallax_factors(ra, dec, mjd):
    a, d = np.radians(ra), np.radians(dec)
    r = earth_barycentric_au(mjd)
    X, Y, Z = r[..., 0], r[..., 1], r[..., 2]
    pa = X * np.sin(a) - Y * np.cos(a)
    pd = X * np.cos(a) * np.sin(d) + Y * np.sin(a) * np.sin(d) - Z * np.cos(d)
    return pa, pd


def propagate(ra, dec, epoch_year, pmra, pmdec, mjd, plx=0.0):
    mjd = np.atleast_1d(np.asarray(mjd, dtype=float))
    dt = mjd_to_year(mjd) - epoch_year
    dxi, deta = pmra * dt, pmdec * dt
    if plx:
        pa, pd = parallax_factors(ra, dec, mjd)
        dxi, deta = dxi + plx * pa, deta + plx * pd
    return tan_deproject(dxi, deta, ra, dec)
