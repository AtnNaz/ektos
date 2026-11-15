from __future__ import annotations

import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.environ["EKTOS_OFFLINE"] = "1"

import numpy as np

NATIVE = 6.15


def exposure(v=0, lam=4.5, mjd=60000.0, n=25, det=6, noise=1.0, level=10.0, seed=0):
    rng = np.random.default_rng(seed)
    h = n // 2
    data = (level + noise * rng.standard_normal((n, n))) if noise else np.full((n, n), level)
    return {"data": data.astype(np.float32), "M": np.array([[-NATIVE, 0.0], [0.0, NATIVE]]),
            "c": np.array([NATIVE * h, -NATIVE * h]), "psf_fwhm": 8.0, "omega": 37.93, "mjd": float(mjd),
            "det": det, "lam": float(lam), "bw": 0.05, "dlam": np.array([0.001, 0.0]), "v": v,
            "obs_id": f"syn_{mjd:.4f}", "key": "synthetic", "collection": "synthetic", "doi": "",
            "sc_km": np.array([np.nan, np.nan, np.nan]), "pipever": "x", "exptime": 100.0}


def temp_dir(case) -> pathlib.Path:
    t = tempfile.TemporaryDirectory(prefix="ektos_test_")
    case.addCleanup(t.cleanup)
    return pathlib.Path(t.name)
