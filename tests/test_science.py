from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import unittest

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ektos import analysis, frames, phot


def _gauss_image(grid, x0, y0, amp, sigma, sky, noise, seed=1):
    rng = np.random.default_rng(seed)
    img = amp * np.exp(-0.5 * ((grid.xi - x0) ** 2 + (grid.eta - y0) ** 2) / sigma ** 2) + sky
    return (img + rng.normal(0, noise, img.shape)).astype(np.float32), np.full(img.shape, noise, np.float32)


class NoiseScale(unittest.TestCase):
    def test_matches_injected_scatter(self):
        rng = np.random.default_rng(3)
        err = np.full((80, 80), 2.0)
        for k in (1.0, 3.0, 9.0):
            img = rng.normal(5.0, 2.0 * k, err.shape)
            self.assertAlmostEqual(frames.noise_scale(img, err), k, delta=0.06 * k)

    def test_too_few_pixels(self):
        self.assertEqual(frames.noise_scale(np.ones(10), np.ones(10)), 1.0)


class GaussianFit(unittest.TestCase):
    def test_recovers_position_and_error_scales_with_noise(self):
        grid = frames.Grid(99 * 3.075)
        img, err = _gauss_image(grid, 7.3, -4.1, 50.0, 4.2, 1.0, 1.0)
        f = phot.fit_centroid(img, err, grid, 6.0, -3.0)
        self.assertLess(np.hypot(f["xi"] - 7.3, f["eta"] + 4.1), 0.1)
        self.assertGreater(f["snr"], 20)
        g = phot.fit_centroid(img, err / 10, grid, 6.0, -3.0)
        h = phot.fit_centroid(img, err / 30, grid, 6.0, -3.0)
        self.assertGreater(g["chi2r"], 1)
        self.assertAlmostEqual(h["e_xi"], g["e_xi"], delta=1e-3 * g["e_xi"])
        self.assertAlmostEqual(h["xi"], g["xi"], delta=1e-6)

    def test_empty_box(self):
        grid = frames.Grid(99 * 3.075)
        img = np.full((grid.n, grid.n), np.nan, np.float32)
        self.assertIsNone(phot.fit_centroid(img, img, grid, 0.0, 0.0))


class ParallaxSystematic(unittest.TestCase):
    def test_half_split(self):
        fits = {"WISE first half": {"plx": 0.597, "e_plx": 0.062}, "WISE second half": {"plx": 0.406, "e_plx": 0.047}}
        s = analysis.half_split_systematic(fits)
        self.assertAlmostEqual(s["systematic"], np.sqrt(0.191 ** 2 - np.hypot(0.062, 0.047) ** 2) / 2, places=6)
        self.assertAlmostEqual(s["n_sigma"], 0.191 / np.hypot(0.062, 0.047), places=6)

    def test_no_excess_gives_zero(self):
        fits = {"WISE first half": {"plx": 0.50, "e_plx": 0.06}, "WISE second half": {"plx": 0.48, "e_plx": 0.06}}
        self.assertEqual(analysis.half_split_systematic(fits)["systematic"], 0.0)

    def test_stored_wise0855(self):
        res = json.loads((ROOT / "web/data/wise0855/analysis.json").read_text(encoding="utf-8"))
        self.assertAlmostEqual(analysis.half_split_systematic(res["fits"])["systematic"], 0.087, delta=0.001)


class ColourExcess(unittest.TestCase):
    def _res(self, rng, n=200):
        def bins(a, b, c):
            return {"2.4-3.8": {"flux": a}, "3.8-4.4": {"flux": b}, "4.4-5.0": {"flux": c}}
        x = rng.normal(0, 300, n)
        rand = [{"bins": bins(v, 0.6 * v + rng.normal(40, 60), 0.5 * v + rng.normal(-30, 70))} for v in x]
        return {"random": rand, "bins": bins(100, 200, 300),
                "mirrors": [{"bins": r["bins"]} for r in rand[:3]]}

    def test_mirror_at_a_control_position_gives_that_controls_statistic(self):
        rng = np.random.default_rng(5)
        res = self._res(rng)
        ce = analysis.colour_excess(res, lambda *a, **k: None)
        w = {n: analysis.Y_TEMPLATE[n] / ce["bands"][n]["sigma"] ** 2 for n in analysis.Y_TEMPLATE}
        norm = np.sqrt(sum(analysis.Y_TEMPLATE[n] ** 2 / ce["bands"][n]["sigma"] ** 2 for n in analysis.Y_TEMPLATE))
        for m, r in zip(ce["mirror_stats"], res["random"][:3]):
            e = {n: r["bins"][n]["flux"] - ce["bands"][n]["c"] * r["bins"]["2.4-3.8"]["flux"] - ce["bands"][n]["median"]
                 for n in analysis.Y_TEMPLATE}
            self.assertAlmostEqual(m, sum(w[n] * e[n] for n in w) / norm, places=9)

    def test_stored_candidates(self):
        for key, n in (("smdet1", 300), ("wise0855", 150)):
            res = json.loads((ROOT / f"web/data/{key}/candidate.json").read_text(encoding="utf-8"))
            self.assertEqual(len(res["random"]), n)
            ce = analysis.colour_excess(res, lambda *a, **k: None)
            self.assertEqual(ce["matched"], res["colour_excess"]["matched"])
            np.testing.assert_allclose(ce["mirror_stats"], res["colour_excess"]["mirror_stats"])


class CandidateGuard(unittest.TestCase):
    def test_weaker_run_refuses(self):
        path = ROOT / "web/data/smdet1/candidate.json"
        before = path.read_bytes()
        env = {**os.environ, "EKTOS_OFFLINE": "1", "PYTHONIOENCODING": "utf-8"}
        r = subprocess.run([sys.executable, "-m", "ektos.analysis", "smdet1", "candidate", "10"], cwd=ROOT,
                           capture_output=True, text=True, env=env, timeout=120)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("300 blank controls", r.stderr + r.stdout)
        self.assertEqual(path.read_bytes(), before)


class Frames(unittest.TestCase):
    def test_prepare_drops_half_empty_windows(self):
        d = np.ones((10, 10), np.float32)
        half = d.copy(); half[:5] = np.nan
        more = d.copy(); more[:4] = np.nan
        exps = [{"data": d, "bg": 0.0, "sig": 1.0}, {"data": half, "bg": 0.0, "sig": 1.0}, {"data": more, "bg": 0.0, "sig": 1.0}]
        self.assertEqual(len(frames.prepare(exps)), 2)


class BlindTestByType(unittest.TestCase):
    def test_summary_reproduces_stored_scan_and_splits_types(self):
        from ektos import benchmark
        s = benchmark.summary(verbose=False)
        self.assertEqual((s["all"]["n"], s["Y"]["n"], s["T"]["n"]), (42, 39, 3))
        self.assertEqual(s["all"]["scan"]["5.0"]["caught"], 37)
        self.assertEqual(s["Y"]["scan"]["5.0"]["caught"], 34)
        self.assertEqual(s["Y"]["by_w2"]["15.0"], [15, 15])


if __name__ == "__main__":
    unittest.main()
