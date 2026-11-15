from __future__ import annotations

import unittest

import numpy as np

import _support
from ektos import frames, inject, phot


class Engine(unittest.TestCase):
    def setUp(self):
        self.exps = frames.prepare([_support.exposure(mjd=60000.0 + 0.01 * i, seed=i) for i in range(5)])
        self.grid = frames.Grid(25 * _support.NATIVE)

    def test_prepare_measures_sky_and_noise(self):
        self.assertEqual(len(self.exps), 5)
        for e in self.exps:
            self.assertAlmostEqual(e["bg"], 10.0, delta=0.3)
            self.assertAlmostEqual(e["sig"], 1.0, delta=0.3)

    def test_combine_is_finite(self):
        img, err, n = frames.combine(self.exps, self.grid)
        self.assertEqual(img.shape, (self.grid.n, self.grid.n))
        c = self.grid.n // 2
        inner = (slice(c - 10, c + 11), slice(c - 10, c + 11))
        self.assertTrue(np.all(np.isfinite(img[inner])) and np.all(np.isfinite(err[inner])))
        self.assertTrue(np.all(n[inner] == 5))
        self.assertLess(abs(float(np.nanmean(img[inner]))), 0.3)
        self.assertTrue(np.all(err[inner] > 0))

    def test_combine_of_nothing_is_nan(self):
        img, err, n = frames.combine([], self.grid)
        self.assertTrue(np.all(np.isnan(img)) and np.all(n == 0))

    def test_forced_flux_is_finite(self):
        for e in self.exps:
            f, s, npix = phot.forced_flux(e, 0.0, 0.0)
            self.assertTrue(np.isfinite(f) and np.isfinite(s) and s > 0)
            self.assertEqual(npix, 49)
        self.assertIsNone(phot.forced_flux(self.exps[0], 500.0, 0.0))

    def test_injected_source_is_recovered_on_a_blank_sky(self):
        blank = [dict(_support.exposure(noise=0.0), bg=10.0, sig=1.0)]
        got = inject.inject(blank, lambda e: (3.0, -2.0), lambda e: 5000.0)
        f, s, _ = phot.forced_flux(got[0], 3.0, -2.0)
        self.assertAlmostEqual(f, 5000.0, delta=0.5)
        self.assertEqual(float(blank[0]["data"].max()), 10.0)

    def test_split_visits(self):
        exps = [_support.exposure(mjd=m) for m in (1.0, 2.0, 100.0, 101.0)]
        self.assertEqual([len(v) for v in frames.split_visits(exps)], [2, 2])
        self.assertEqual(frames.split_visits([]), [])


if __name__ == "__main__":
    unittest.main()
