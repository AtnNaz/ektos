from __future__ import annotations

import csv
import pathlib
import sys
import time

from . import _console, cutouts, package

DATA_ROOT = pathlib.Path(__file__).resolve().parent.parent / "datasets"
SKIP = {"smdet_1"}


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def targets(root) -> list[dict]:
    root = pathlib.Path(root) / "05_y_dwarfs"
    out, seen = [], set()
    for name in ("targets_A_training_and_plane.csv", "targets_B_offplane_Y.csv"):
        p = root / "catalogs" / name
        if not p.exists():
            continue
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["name"] in seen or r["name"] in SKIP:
                    continue
                seen.add(r["name"])
                out.append({"dir": r["name"], "folder": root / "spherex_cutouts" / r["name"], "name": r["source_name"],
                            "ra": float(r["ra"]), "dec": float(r["dec"]), "spt": r.get("spt", ""), "teff": _f(r.get("teff")),
                            "glat": _f(r.get("glat")), "pmra": _f(r.get("pmra")), "pmdec": _f(r.get("pmdec")),
                            "plx": _f(r.get("plx")), "w2": _f(r.get("W2")),
                            "plane": "_and_plane" in name})
    return out


def build_all(root, half: int = 24, pack_half: int = 16, max_n: int = 600, only=None, verbose=True) -> list[dict]:
    say = print if verbose else (lambda *a, **k: None)
    rows = []
    for t in targets(root):
        if only and t["dir"] not in only:
            continue
        slug = "y_" + t["dir"]
        if not (t["folder"] / "cutouts").exists():
            rows.append({"slug": slug, "name": t["name"], "status": "no cutouts on disk"})
            say(f"{t['name']:34s} no cutouts on disk")
            continue
        t0 = time.time()
        n_files = sum(1 for _ in (t["folder"] / "cutouts").glob("*.fits"))
        listing = cutouts.import_field(t["folder"], t["ra"], t["dec"], half, max_n=max_n)
        if len(listing) < 12:
            rows.append({"slug": slug, "name": t["name"], "status": f"only {len(listing)} usable exposures"})
            say(f"{t['name']:34s} only {len(listing)} usable exposures of {n_files} files")
            continue
        parts = [t["spt"] or "Y", f"{t['teff']:.0f} K" if t["teff"] else None, f"{1000.0 / t['plx']:.1f} pc" if t["plx"] else None]
        info = {
            "name": t["name"], "kind": ", ".join(p for p in parts if p), "center": (t["ra"], t["dec"]),
            "astrometry": {"ra": t["ra"], "dec": t["dec"], "epoch": 2026.0, "pmra": (t["pmra"] or 0.0) / 1e3,
                           "pmdec": (t["pmdec"] or 0.0) / 1e3, "plx": (t["plx"] or 0.0) / 1e3},
            "default_band": "W2s", "group": "ydwarf", "w2": t["w2"], "glat": t["glat"], "plane": t["plane"],
        }
        try:
            package.build(None, t["ra"], t["dec"], half, slug=slug, with_catalogs=False, pack_half=pack_half,
                          images=listing, listed=n_files, info=info)
            rows.append({"slug": slug, "name": t["name"], "status": "built", "files": n_files, "exposures": len(listing)})
            say(f"{t['name']:34s} {len(listing):4d} exposures of {n_files:5d} files  {time.time() - t0:4.0f}s")
        except SystemExit as ex:
            rows.append({"slug": slug, "name": t["name"], "status": str(ex)})
            say(f"{t['name']:34s} {ex}")
    return rows


if __name__ == "__main__":
    from . import net
    _console.utf8_stdout()
    rows = build_all(sys.argv[1] if len(sys.argv) > 1 else DATA_ROOT, only=set(sys.argv[2:]) or None)
    built = [r for r in rows if r["status"] == "built"]
    print(f"{len(built)} packages built of {len(rows)} targets; network: {net.METER.snapshot()}")
