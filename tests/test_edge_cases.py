from __future__ import annotations

import threading
import unittest
from unittest import mock

import numpy as np

import _support
from ektos import benchmark, inject, motion, package, variable

AST = {"ra": 10.0, "dec": 10.0, "epoch": 2026.0, "pmra": 0.0, "pmdec": 0.0, "plx": 0.0}


def manifest(visits):
    return {"visits": [{"mjd": 60000.0 + 180 * i, "n": n, "star_colour_w2w1": None} for i, n in enumerate(visits)],
            "grid": {"n": 51, "scale": 3.075}, "name": "synthetic", "astrometry": AST, "center": [10.0, 10.0]}


def visit_exposures(counts, lam=4.5):
    out = []
    for v, n in enumerate(counts):
        out += [_support.exposure(v=v, lam=lam, mjd=60000.0 + 180 * v + 0.01 * i, seed=100 * v + i) for i in range(n)]
    return out


class InjectRun(unittest.TestCase):
    def run_with(self, counts, **kw):
        man, exps = manifest(counts), visit_exposures(counts)
        with mock.patch.object(package, "load_package", return_value=(man, exps)):
            return inject.run("synthetic", reps=1, verbose=False, snrs=(10.0,), shifts=(6.0,), **kw)

    def test_no_exposures(self):
        with self.assertRaisesRegex(ValueError, "no visit has the 8 exposures"):
            self.run_with([0])

    def test_no_visit_with_enough_exposures(self):
        with self.assertRaisesRegex(ValueError, "no visit has the 8 exposures"):
            self.run_with([3, 5])

    def test_single_visit(self):
        with self.assertRaisesRegex(ValueError, "only visit 0"):
            self.run_with([12])

    def test_empty_explicit_visit(self):
        with self.assertRaisesRegex(ValueError, "visit 1 has no exposures"):
            self.run_with([12, 0, 12], va=0, vb=1)
        with self.assertRaisesRegex(ValueError, "visit 7 has no exposures"):
            self.run_with([12, 12], va=0, vb=7)

    def test_two_visits_still_run(self):
        r = self.run_with([10, 10])
        self.assertEqual((r["va"], r["vb"]), (0, 1))
        self.assertTrue(np.isfinite(r["strongest"]))
        self.assertEqual(len(r["trials"]), 1)

    def test_limit_with_one_visit(self):
        man, exps = manifest([12]), visit_exposures([12])
        with mock.patch.object(package, "load_package", return_value=(man, exps)):
            with self.assertRaises(ValueError):
                inject.limit("synthetic", verbose=False, reps=1, snrs=(10.0,))


class Fit5(unittest.TestCase):
    def epochs(self, n):
        return [{"mjd": 60000.0 + 120.0 * i, "xi": 0.1 * i, "eta": -0.05 * i, "e_xi": 0.1, "e_eta": 0.1} for i in range(n)]

    def test_too_few_epochs(self):
        for n, plx in ((0, True), (1, True), (2, True), (2, False)):
            with self.assertRaisesRegex(ValueError, "at least 3 epochs"):
                motion.fit5(self.epochs(n), 10.0, 10.0, (10.0, 10.0), fit_plx=plx)

    def test_all_at_one_date(self):
        eps = [dict(e, mjd=60000.0) for e in self.epochs(4)]
        with self.assertRaisesRegex(ValueError, "do not constrain"):
            motion.fit5(eps, 10.0, 10.0, (10.0, 10.0))

    def test_smallest_valid_fit(self):
        f = motion.fit5(self.epochs(3), 10.0, 10.0, (10.0, 10.0))
        self.assertEqual(f["dof"], 1)
        self.assertTrue(all(np.isfinite(f[k]) for k in ("xi0", "pm_xi", "plx", "e_plx", "chi2")))


class SplitEpochs(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(motion.split_epochs(np.array([])), [])
        self.assertEqual(motion.split_epochs([]), [])

    def test_unchanged_for_data(self):
        g = motion.split_epochs(np.array([5.0, 1.0, 100.0, 2.0, 101.0]))
        self.assertEqual([list(x) for x in g], [[1, 3, 0], [2, 4]])

    def test_wise_epochs_empty(self):
        self.assertEqual(motion.wise_epochs([], AST, (10.0, 10.0), []), [])


class Decompose(unittest.TestCase):
    def data(self, n=60, days=400.0, dets=(3,), seed=1):
        rng = np.random.default_rng(seed)
        lam = rng.uniform(1.6, 2.4, n)
        mjd = 60000.0 + rng.uniform(0.0, days, n)
        flux = 1000.0 * (1 + 0.1 * np.sin(mjd / 40.0)) * np.exp(rng.normal(0, 0.01, n))
        return lam, mjd, flux, np.full(n, 5.0), np.array([dets[i % len(dets)] for i in range(n)])

    def test_no_point_passes_the_cut(self):
        lam, mjd, flux, err, det = self.data()
        with self.assertRaisesRegex(ValueError, "0 measurement"):
            variable.decompose(lam, mjd, flux * 1e-3, err, det)
        with self.assertRaisesRegex(ValueError, "0 measurement"):
            variable.decompose(lam[:0], mjd[:0], flux[:0], err[:0], det[:0])

    def test_one_point(self):
        lam, mjd, flux, err, det = self.data(n=1)
        with self.assertRaisesRegex(ValueError, "1 measurement"):
            variable.decompose(lam, mjd, flux, err, det)

    def test_more_parameters_than_points(self):
        lam, mjd, flux, err, det = self.data(n=8, days=400.0)
        with self.assertRaisesRegex(ValueError, "too few"):
            variable.decompose(lam, mjd, flux, err, det)

    def test_single_visit(self):
        lam, mjd, flux, err, det = self.data(n=40, days=3.0)
        r = variable.decompose(lam, mjd, flux, err, det)
        self.assertEqual(len(r["dmag"]), 1)
        self.assertTrue(np.all(np.isfinite(r["dmag"])))

    def test_detector_with_a_single_wavelength(self):
        lam, mjd, flux, err, det = self.data(n=60)
        det[0] = 5
        r = variable.decompose(lam, mjd, flux, err, det)
        self.assertTrue(np.all(np.isfinite(r["dmag"])) and np.all(np.isfinite(r["s"])))

    def test_normal_input_unchanged_shape(self):
        lam, mjd, flux, err, det = self.data(n=300, dets=(3, 4))
        r = variable.decompose(lam, mjd, flux, err, det)
        self.assertEqual(r["n_all"], 300)
        self.assertEqual(len(r["knots"]), 20)
        self.assertGreater(np.ptp(r["dmag"]), 0.1)


class BenchmarkField(unittest.TestCase):
    def load(self, man, exps):
        return mock.patch.object(package, "load_package", return_value=(man, exps))

    def exps(self):
        return visit_exposures([4], lam=4.5) + visit_exposures([4], lam=3.4)

    def test_no_valid_control_position_ends(self):
        out = {}
        with self.load(manifest([8]), self.exps()), \
                mock.patch.object(benchmark, "snr_map", side_effect=lambda img: np.full(img.shape, np.nan)):
            t = threading.Thread(target=lambda: out.setdefault("r", benchmark.field("synthetic")), daemon=True)
            t.start()
            t.join(60)
        self.assertFalse(t.is_alive(), "benchmark.field still looping after 60 s")
        self.assertEqual(out["r"]["n_random"], 0)

    def test_no_visit_with_six_exposures(self):
        with self.load(manifest([3]), self.exps()):
            self.assertEqual(benchmark.field("synthetic")["status"], "no visit with 6 exposures")

    def test_no_catalogue_position(self):
        man = dict(manifest([8]), astrometry=None)
        with self.load(man, self.exps()):
            self.assertEqual(benchmark.field("synthetic")["status"], "no catalogue position")

    def test_normal_field_draws_all_controls(self):
        with self.load(manifest([8]), self.exps()):
            r = benchmark.field("synthetic")
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["n_random"], benchmark.N_RANDOM)

    def test_run_with_nothing_to_score_writes_nothing(self):
        web = _support.temp_dir(self)
        (web / "index.json").write_text("{}")
        with mock.patch.object(package, "WEB", web):
            with self.assertRaisesRegex(ValueError, "none of the 0"):
                benchmark.run(None, verbose=False)
        self.assertFalse((web / "benchmark.json").exists())


if __name__ == "__main__":
    unittest.main()
