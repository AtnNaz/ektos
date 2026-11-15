from __future__ import annotations

import datetime
import json
import math
import sys
import urllib.parse

from . import net
from .catalogs import CACHE
from .geom import MJD_J2000, propagate, tan_project, year_to_mjd
from .package import WEB
from .targets import TARGETS

SERVICE = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
MIRROR = "https://simbad.harvard.edu/simbad/sim-tap/sync"
OUT = WEB / "simbad_check.json"

REF_YEAR = 2026.0
CONE_ARCSEC = 30.0

SIMBAD_IDS = {
    "wise0855": {"WISE J085510.83-071442.5": ("WISE J085510.83-071442.5",)},
    "barnard": {"Barnard's Star": ("NAME Barnard's Star", "NAME Barnard's star", "GJ 699")},
    "epsindib": {"eps Ind B": ("* eps Ind B", "NAME eps Ind B"),
                 "eps Ind A": ("* eps Ind A", "* eps Ind", "HD 209100"),
                 "eps Ind Ba": ("* eps Ind Ba",),
                 "eps Ind Bb": ("* eps Ind Bb",)},
    "luhman16": {"Luhman 16": ("NAME Luhman 16", "WISE J104915.57-531906.1"),
                 "Luhman 16A": ("NAME Luhman 16A", "NAME Luhman 16 A"),
                 "Luhman 16B": ("NAME Luhman 16B", "NAME Luhman 16 B")},
    "smdet1": {"SMDET-1": ("SMDET-1", "NAME SMDET-1", "SMDET 1", "NAME SMDET 1")},
}

COLUMNS = ("main_id", "ra", "dec", "coo_bibcode", "pmra", "pmdec", "pm_bibcode",
           "plx_value", "plx_err", "plx_bibcode", "sp_type")


class Unreachable(RuntimeError):
    pass


_endpoints = [SERVICE, MIRROR]


def _fetch(adql: str) -> bytes:
    q = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql})
    while _endpoints:
        base = _endpoints[0]
        try:
            body = net.get_url(base + "?" + q, timeout=60, retries=1)
            doc = json.loads(body.decode("utf-8"))
            if isinstance(doc, dict) and "metadata" in doc and "data" in doc:
                return body
            raise ValueError("answer is not a TAP json table")
        except (RuntimeError, ValueError) as e:
            why = str(e).rsplit(" (", 1)[-1].rstrip(")")
            print(f"  ! {urllib.parse.urlsplit(base).netloc} failed: {why[:160]}")
            _endpoints.pop(0)
    raise Unreachable("SIMBAD and its mirror could not be reached")


def tap(adql: str, cache_name: str) -> tuple[list[dict], str]:
    from .catalogs import _cached
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / cache_name

    def read(path):
        d = json.loads(path.read_text(encoding="utf-8"))
        if not (isinstance(d, dict) and "metadata" in d and "data" in d):
            raise ValueError("not a TAP json table")
        return d
    doc = _cached(p, read, lambda: _fetch(adql), "SIMBAD TAP query")
    names = [m["name"] for m in doc["metadata"]]
    fetched = datetime.datetime.fromtimestamp(p.stat().st_mtime, datetime.timezone.utc).strftime("%Y-%m-%d")
    return [dict(zip(names, row)) for row in doc["data"]], fetched


def _quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def query_names(key: str) -> tuple[dict, str]:
    labels = SIMBAD_IDS[key]
    ids = [s for spell in labels.values() for s in spell]
    adql = ("SELECT b.oid, i.id AS matched_id, " + ", ".join("b." + c for c in COLUMNS) +
            " FROM basic AS b JOIN ident AS i ON i.oidref = b.oid"
            " WHERE i.id IN (" + ", ".join(_quote(s) for s in ids) + ")")
    rows, fetched = tap(adql, f"simbad_{key}.json")
    out = {}
    for label, spell in labels.items():
        hit = [r for r in rows if r["matched_id"] in spell]
        if hit:
            row = dict(hit[0])
            row["matched_id"] = sorted({r["matched_id"] for r in hit if r["oid"] == row["oid"]})
            out[label] = row
    return out, fetched


def query_cone(key: str, ra: float, dec: float) -> list[dict]:
    r = CONE_ARCSEC / 3600.0
    adql = ("SELECT TOP 30 b.main_id, b.otype, b.ra, b.dec, b.coo_bibcode, b.pmra, b.pmdec, b.plx_value, b.sp_type"
            " FROM basic AS b"
            f" WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {r:.6f})) = 1")
    rows, _ = tap(adql, f"simbad_{key}_cone.json")
    return rows


def _sep(ra, dec, ra0, dec0) -> tuple[float, float, float]:
    xi, eta = tan_project(ra, dec, ra0, dec0)
    return float(xi), float(eta), float(math.hypot(xi, eta))


def _at(ra, dec, epoch, pmra, pmdec, year) -> tuple[float, float]:
    a, d = propagate(ra, dec, epoch, pmra, pmdec, year_to_mjd(year), 0.0)
    return float(a[0]), float(d[0])


def compare(ast: dict, row: dict) -> dict:
    ours = {"pmra": ast["pmra"] * 1000.0, "pmdec": ast["pmdec"] * 1000.0, "plx": ast["plx"] * 1000.0}
    sim = {"pmra": row["pmra"], "pmdec": row["pmdec"], "plx": row["plx_value"]}
    diff = {k: (sim[k] - ours[k] if sim[k] is not None else None) for k in ours}
    res = {"pm_diff": None, "pm_drift_ref": None, "pos_ref": None}
    if diff["pmra"] is not None and diff["pmdec"] is not None:
        res["pm_diff"] = math.hypot(diff["pmra"], diff["pmdec"])
        res["pm_drift_ref"] = res["pm_diff"] / 1000.0 * abs(REF_YEAR - ast["epoch"])

    ra0, dec0 = _at(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], 2000.0)
    pos = dict(zip(("dra", "ddec", "sep"), _sep(row["ra"], row["dec"], ra0, dec0)))
    raw = dict(zip(("dra", "ddec", "sep"), _sep(row["ra"], row["dec"], ast["ra"], ast["dec"])))
    if sim["pmra"] is not None and sim["pmdec"] is not None:
        a1, d1 = _at(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], REF_YEAR)
        a2, d2 = _at(row["ra"], row["dec"], 2000.0, sim["pmra"] / 1000.0, sim["pmdec"] / 1000.0, REF_YEAR)
        res["pos_ref"] = dict(zip(("dra", "ddec", "sep"), _sep(a2, d2, a1, d1)))
    return {"main_id": row["main_id"], "matched_id": row["matched_id"], "sp_type": row["sp_type"] or None,
            "simbad": {"ra": row["ra"], "dec": row["dec"], "pmra_mas": sim["pmra"], "pmdec_mas": sim["pmdec"],
                       "plx_mas": sim["plx"], "plx_err_mas": row["plx_err"]},
            "bibcode": {"coo": row["coo_bibcode"] or None, "pm": row["pm_bibcode"] or None,
                        "plx": row["plx_bibcode"] or None},
            "diff": {"pmra_mas": diff["pmra"], "pmdec_mas": diff["pmdec"], "pm_mas": res["pm_diff"],
                     "plx_mas": diff["plx"]},
            "ours_at_j2000": {"ra": ra0, "dec": dec0},
            "pos_j2000_arcsec": pos, "pos_as_entered_arcsec": raw,
            "pm_drift_ref_arcsec": res["pm_drift_ref"], "pos_ref_arcsec": res["pos_ref"]}


def _round(v, nd=4):
    if isinstance(v, dict):
        return {k: _round(x, 7 if k in ("ra", "dec") else nd) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_round(x, nd) for x in v]
    if isinstance(v, float):
        return round(v, nd) if math.isfinite(v) else None
    return v


def _f(v, fmt="10.2f") -> str:
    return format(v, fmt) if v is not None else format("-", ">" + fmt.split(".")[0])


def _show(label: str, ast: dict, c: dict):
    s, d, b = c["simbad"], c["diff"], c["bibcode"]
    print(f"  SIMBAD '{label}' -> {c['main_id']}   sp_type {c['sp_type'] or '-'}")
    print(f"    {'':15s}{'ours':>10s} {'SIMBAD':>10s} {'S - ours':>10s}   bibcode")
    print(f"    {'pmRA  [mas/yr]':15s}{ast['pmra'] * 1000:10.2f} {_f(s['pmra_mas'])} {_f(d['pmra_mas'])}   {b['pm'] or '-'}")
    print(f"    {'pmDec [mas/yr]':15s}{ast['pmdec'] * 1000:10.2f} {_f(s['pmdec_mas'])} {_f(d['pmdec_mas'])}")
    err = f" (+-{s['plx_err_mas']:.2f})" if s["plx_err_mas"] is not None else ""
    print(f"    {'plx   [mas]':15s}{ast['plx'] * 1000:10.2f} {_f(s['plx_mas'])} {_f(d['plx_mas'])}   {b['plx'] or '-'}{err}")
    if d["pm_mas"] is not None:
        print(f"    |pm difference| {d['pm_mas']:.2f} mas/yr = {c['pm_drift_ref_arcsec']:.3f}\" from our epoch "
              f"{ast['epoch']} to {REF_YEAR}")
    p, r = c["pos_j2000_arcsec"], c["pos_as_entered_arcsec"]
    print(f"    position at J2000.0 (ours carried from {ast['epoch']} with our pm), SIMBAD - ours: "
          f"dRA*cos {p['dra']:+.3f}\"  dDec {p['ddec']:+.3f}\"  sep {p['sep']:.3f}\"   {b['coo'] or '-'}")
    print(f"    position as entered (no epoch change): sep {r['sep']:.3f}\"")
    if c["pos_ref_arcsec"]:
        q = c["pos_ref_arcsec"]
        print(f"    predicted position at {REF_YEAR}, SIMBAD - ours: dRA*cos {q['dra']:+.3f}\"  dDec {q['ddec']:+.3f}\"  "
              f"sep {q['sep']:.3f}\"")


def check() -> dict:
    res = {"service": SERVICE, "mirror": MIRROR, "ref_year": REF_YEAR,
           "units": "proper motion mas/yr (pmra = mu_alpha*cos(dec)), parallax mas, position differences arcsec, "
                    "all as SIMBAD minus ours",
           "targets": {}}
    for key, t in TARGETS.items():
        ast = t.get("astrometry")
        if not ast:
            continue
        print(f"\n== {key}: {t['name']}  (our position epoch {ast['epoch']})")
        found, fetched = query_names(key)
        labels = list(SIMBAD_IDS[key])
        entry = {"name": t["name"], "fetched": fetched,
                 "ours": {"ra": ast["ra"], "dec": ast["dec"], "epoch": ast["epoch"], "pmra_mas": ast["pmra"] * 1000.0,
                          "pmdec_mas": ast["pmdec"] * 1000.0, "plx_mas": ast["plx"] * 1000.0},
                 "found": labels[0] in found, "not_found": [la for la in labels if la not in found], "objects": {}}
        for label in labels:
            if label not in found:
                print(f"  SIMBAD '{label}': not found (tried {', '.join(SIMBAD_IDS[key][label])})")
                continue
            c = compare(ast, found[label])
            entry["objects"][label] = c
            _show(label, ast, c)
        if not entry["found"]:
            a0, d0 = _at(ast["ra"], ast["dec"], ast["epoch"], ast["pmra"], ast["pmdec"], 2000.0)
            cone = []
            for r in query_cone(key, ast["ra"], ast["dec"]):
                pm = math.hypot(r["pmra"], r["pmdec"]) if r["pmra"] is not None and r["pmdec"] is not None else None
                cone.append({"main_id": r["main_id"], "otype": r["otype"], "sp_type": r["sp_type"] or None,
                             "pm_mas": pm, "plx_mas": r["plx_value"],
                             "sep_as_entered_arcsec": _sep(r["ra"], r["dec"], ast["ra"], ast["dec"])[2],
                             "sep_j2000_arcsec": _sep(r["ra"], r["dec"], a0, d0)[2]})
            cone.sort(key=lambda x: x["sep_j2000_arcsec"])
            entry["cone_arcsec"], entry["cone"] = CONE_ARCSEC, cone
            print(f"  cone of {CONE_ARCSEC:.0f}\" around our position: {len(cone)} SIMBAD object(s)")
            for x in cone:
                print(f"    {x['main_id']:32s} {x['otype'] or '-':5s} pm {_f(x['pm_mas'], '8.1f')} mas/yr  "
                      f"{x['sep_j2000_arcsec']:6.2f}\" from ours at J2000.0, {x['sep_as_entered_arcsec']:6.2f}\" as entered")
        res["targets"][key] = entry
    return _round(res)


if __name__ == "__main__":
    try:
        result = check()
    except Unreachable as e:
        print(f"\nstopped: {e}")
        print("network:", net.METER.snapshot())
        sys.exit(1)
    result["network"] = net.METER.snapshot()
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1, allow_nan=False), encoding="utf-8")
    print(f"\nwrote {OUT}")
    print("network:", result["network"])
