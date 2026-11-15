from __future__ import annotations

import csv
import io
import urllib.parse

from . import net

SIA = "https://irsa.ipac.caltech.edu/SIA"
COLLECTIONS = ("spherex_dr1", "spherex_qr3", "spherex_dr1_deep", "spherex_qr3_deep")
DOIS = {
    "spherex_dr1": "10.26131/IRSA678", "spherex_dr1_deep": "10.26131/IRSA678",
    "spherex_qr3": "10.26131/IRSA662", "spherex_qr3_deep": "10.26131/IRSA662",
}
S3_HOST = "nasa-irsa-spherex.s3.us-east-1.amazonaws.com"
_IBE_PREFIX = "/ibe/data/spherex/"


def find_images(ra: float, dec: float, radius_deg: float = 0.0005,
                collections=COLLECTIONS, failed: list | None = None) -> list[dict]:
    out, seen = [], set()
    for coll in collections:
        q = urllib.parse.urlencode({
            "COLLECTION": coll,
            "POS": f"circle {ra:.6f} {dec:.6f} {radius_deg}",
            "RESPONSEFORMAT": "CSV",
        })
        try:
            text = net.get_url(f"{SIA}?{q}").decode("utf-8", "replace")
        except net.OfflineError:
            raise
        except RuntimeError:
            if failed is not None:
                failed.append(coll)
            continue
        if text.lstrip()[:1] == "<":
            if failed is not None:
                failed.append(coll)
            continue
        for r in csv.DictReader(io.StringIO(text)):
            url = r.get("access_url") or ""
            if _IBE_PREFIX not in url:
                continue
            try:
                det = int(r["energy_bandpassname"].rsplit("D", 1)[1])
                row = {
                    "obs_id": r["obs_id"], "det": det, "collection": coll,
                    "doi": DOIS.get(coll, ""),
                    "key": url.split(_IBE_PREFIX, 1)[1],
                    "access_url": url,
                    "mjd": 0.5 * (float(r["t_min"]) + float(r["t_max"])),
                    "exptime": float(r["t_exptime"]),
                    "release": r.get("obs_release_date", ""),
                }
            except (KeyError, ValueError, IndexError, TypeError):
                continue
            uid = (row["obs_id"], det)
            if uid in seen:
                continue
            seen.add(uid)
            out.append(row)
    out.sort(key=lambda d: d["mjd"])
    return out
