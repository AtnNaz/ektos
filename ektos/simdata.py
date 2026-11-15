from __future__ import annotations

import json
import math
import pathlib
import warnings

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
GM = 398600.4418
RE = 6378.137
J2 = 1.08262668e-3


def orbit(step: int = 4) -> dict:
    rows = {}
    for f in (ROOT / "cache").glob("f_*/*.npz"):
        z = np.load(f, allow_pickle=True)
        if "sc_km" not in z.files:
            continue
        m = json.loads(str(z["meta"]))
        rows[m["obs_id"]] = (m["mjd"], np.array(z["sc_km"], float))
    if not rows:
        raise SystemExit("no cached exposures with a spacecraft position")
    mjd = np.array([v[0] for v in rows.values()])
    P = np.array([v[1] for v in rows.values()])
    o = np.argsort(mjd)
    mjd, P = mjd[o], P[o]
    r = np.linalg.norm(P, axis=1)
    a = float(np.median(r))
    rate, normals, tn = [], [], []
    for i in range(len(mjd) - 1):
        dt = (mjd[i + 1] - mjd[i]) * 86400
        if 60 < dt < 1200:
            p, q = P[i], P[i + 1]
            rate.append(math.acos(np.clip(p @ q / np.linalg.norm(p) / np.linalg.norm(q), -1, 1)) / dt)
            n = np.cross(p, q)
            normals.append(n / np.linalg.norm(n))
            tn.append(mjd[i])
    rate, normals, tn = np.array(rate), np.array(normals), np.array(tn)
    period = 2 * math.pi / np.median(rate) / 60
    inc = np.degrees(np.arccos(normals[:, 2]))
    node = np.cross([0, 0, 1], normals)
    node /= np.linalg.norm(node, axis=1)[:, None]
    mean_sun = (280.460 + 0.9856474 * (tn - 51544.5)) % 360
    dnode = (np.degrees(np.arctan2(node[:, 1], node[:, 0])) - mean_sun) % 360
    i0, off = float(np.median(inc)), float(np.median(dnode))
    n = math.sqrt(GM / a ** 3)
    i_ss = math.degrees(math.acos(-(2 * math.pi / (365.2422 * 86400)) / (1.5 * n * J2 * (RE / a) ** 2)))

    def out_of_plane(shift):
        L = np.radians(280.460 + 0.9856474 * (mjd - 51544.5) + off + shift)
        nm = np.stack([np.sin(np.radians(i0)) * np.sin(L), -np.sin(np.radians(i0)) * np.cos(L), np.full_like(L, math.cos(math.radians(i0)))], 1)
        return np.degrees(np.arcsin(np.abs(np.sum(nm * P, 1)) / r))

    oop, ctl = out_of_plane(0), out_of_plane(90)
    print(f"SPHEREx positions: {len(r)} exposures, {_iso(mjd.min())} to {_iso(mjd.max())}")
    print(f"  radius median {a:.1f} km (height {a - RE:.1f}, range {r.min() - RE:.1f}-{r.max() - RE:.1f} km)")
    print(f"  period from angular rate {period:.2f} min; Kepler III at that radius {2 * math.pi * math.sqrt(a ** 3 / GM) / 60:.2f} min")
    print(f"  inclination {i0:.2f} deg; J2 sun-synchronous at that radius {i_ss:.2f} deg")
    print(f"  node minus mean Sun {off:.2f} deg, spread {np.std(dnode):.2f} deg over {tn.max() - tn.min():.0f} days")
    print(f"  model plane vs all positions: median {np.median(oop):.3f} deg, 95% {np.percentile(oop, 95):.3f}; control (node +90 deg) {np.median(ctl):.1f} deg")
    sel = np.arange(0, len(mjd), step)
    out = {"about": f"SPHEREx positions [mjd, x, y, z km, geocentric] from the cached Level-2 exposures (every {step}th)",
           "a_km": round(a, 1), "inc_deg": round(i0, 2), "node_minus_mean_sun_deg": round(off, 2),
           "period_min": round(float(period), 2), "n_all": int(len(r)),
           "pos": [[round(float(mjd[i]), 5)] + [round(float(v), 1) for v in P[i]] for i in sel]}
    (ROOT / "web/data/spherex_orbit.json").write_text(json.dumps(out, separators=(",", ":")))
    return out


def window() -> None:
    from astropy.coordinates import SkyCoord, get_sun
    from astropy.time import Time
    paths = sorted((ROOT / "web/data").glob("*/manifest.json"))
    mans = [json.loads(m.read_text(encoding="utf-8")) for m in paths]

    def elong(man, mjd):
        return get_sun(Time(mjd, format="mjd")).separation(SkyCoord(*man["center"], unit="deg")).deg

    E = [elong(m, np.array([e["mjd"] for e in m["exposures"]])) for m in mans]
    lo, hi = np.percentile(np.concatenate(E[0::2]), [1, 99])
    inside = np.concatenate([(e >= lo) & (e <= hi) for e in E[1::2]])
    moved = np.concatenate([(lambda e: (e >= lo) & (e <= hi))(elong(m, np.array([x["mjd"] for x in m["exposures"]]) + 91)) for m in mans[1::2]])
    allE = np.concatenate(E)
    p1, p99 = np.percentile(allE, [1, 99])
    rule = (allE >= 80) & (allE <= 120)
    days = np.arange(61041.0, 61041.0 + 365.25)
    share = [float(np.mean((lambda e: (e >= 80) & (e <= 120))(elong(m, days)))) for m in mans]
    print(f"Sun-angle window from {len(E[0::2])} fields: {lo:.1f}-{hi:.1f} deg")
    print(f"  held-out {len(E[1::2])} fields: {100 * inside.mean():.1f}% of {inside.size} exposures inside; control (dates +91 d) {100 * moved.mean():.1f}%")
    print(f"  all {allE.size} exposures: {allE.min():.1f}-{allE.max():.1f} deg, 1-99 % {p1:.1f}-{p99:.1f}, median {np.median(allE):.1f};"
          f" {100 * rule.mean():.1f}% inside 80-120 deg; a field is inside 80-120 deg on a median {100 * np.median(share):.0f}% of the days of 2026")
    out = {"about": "Packaged fields (sorted by folder name) with the dates of their exposures, for the Sun-angle check in sim.html",
           "fields": [{"slug": p.parent.name, "center": m["center"], "mjd": [round(e["mjd"], 4) for e in m["exposures"]]}
                      for p, m in zip(paths, mans)],
           "python": {"window": [round(float(lo), 2), round(float(hi), 2)], "held_out_inside": round(float(inside.mean()), 4),
                      "held_out_n": int(inside.size), "control_inside": round(float(moved.mean()), 4),
                      "all_inside_80_120": round(float(rule.mean()), 4), "n": int(allE.size)}}
    (ROOT / "web/data/spherex_pointing.json").write_text(json.dumps(out, separators=(",", ":")))


def reference() -> None:
    from astropy.coordinates import get_body_barycentric, solar_system_ephemeris
    from astropy.time import Time
    import astropy
    import astropy.units as u
    solar_system_ephemeris.set("builtin")
    names = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]
    rows = []
    for d in ["1900-01-01", "1950-06-15", "2000-01-01T12:00:00", "2025-05-05", "2026-11-14", "2049-12-31"]:
        t = Time(d, scale="tdb")
        sun = get_body_barycentric("sun", t).xyz.to(u.au).value
        rows.append({"date": d, "mjd": t.mjd, "helio": {n: list(get_body_barycentric(n, t).xyz.to(u.au).value - sun) for n in names}})
    (ROOT / "web/data/sim_ref.json").write_text(json.dumps({"about": f"Heliocentric positions [au, ICRS] from astropy {astropy.__version__} built-in ephemeris (ERFA), for checking web/physics.js", "rows": rows}, separators=(",", ":")))
    print(f"reference positions: {len(rows)} dates written")


def _iso(mjd):
    from astropy.time import Time
    return Time(mjd, format="mjd").iso[:10]


def main() -> None:
    warnings.filterwarnings("ignore")
    orbit()
    window()
    reference()


if __name__ == "__main__":
    main()
