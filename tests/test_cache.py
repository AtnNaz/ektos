from __future__ import annotations

import json
import os
import pathlib
import unittest
from unittest import mock

import numpy as np

import _support
from ektos import archive, catalogs, cube, net


class WriteAtomic(unittest.TestCase):
    def setUp(self):
        self.d = _support.temp_dir(self)

    def test_bytes_and_replace(self):
        p = self.d / "a.bin"
        net.write_atomic(p, b"one")
        net.write_atomic(p, b"two")
        self.assertEqual(p.read_bytes(), b"two")
        self.assertEqual([x.name for x in self.d.iterdir()], ["a.bin"])

    def test_str_matches_write_text(self):
        text = json.dumps([{"a": 1}, {"b": "x"}], indent=1)
        ref = self.d / "ref.json"
        ref.write_text(text, encoding="utf-8")
        p = self.d / "new.json"
        net.write_atomic(p, text)
        self.assertEqual(p.read_bytes(), ref.read_bytes())

    def test_interrupted_write_keeps_the_old_file(self):
        p = self.d / "x.npz"
        net.write_atomic(p, b"complete old content")

        def boom(f):
            f.write(b"half of the new con")
            raise KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt):
            net.write_atomic(p, writer=boom)
        self.assertEqual(p.read_bytes(), b"complete old content")
        self.assertEqual([x.name for x in self.d.iterdir()], ["x.npz"])

    def test_npz_round_trip(self):
        e = _support.exposure()
        p = self.d / "e.npz"
        cube._save(p, e)
        back = cube._load(p)
        np.testing.assert_array_equal(back["data"], e["data"])
        self.assertEqual(back["obs_id"], e["obs_id"])
        self.assertEqual(p.suffix, ".npz")
        self.assertEqual(sorted(x.name for x in self.d.iterdir()), ["e.npz"])


class CorruptCube(unittest.TestCase):
    def setUp(self):
        self.cache = _support.temp_dir(self)
        p = mock.patch.object(cube, "CACHE", self.cache)
        p.start()
        self.addCleanup(p.stop)
        self.ra, self.dec = 10.0, 20.0
        self.d = cube.field_dir(self.ra, self.dec, 24)
        self.images = [{"obs_id": f"o{i}", "det": 1 + i % 6, "mjd": 60000.0 + (i // 2), "key": f"k{i}",
                        "collection": "c", "doi": "", "exptime": 1.0} for i in range(6)]
        (self.d / "listing.json").write_text(json.dumps(self.images))
        for i, img in enumerate(self.images):
            e = _support.exposure(mjd=img["mjd"], seed=i)
            e["obs_id"], e["det"] = img["obs_id"], img["det"]
            cube._save(self.d / f"{img['obs_id']}_D{img['det']}.npz", e)
        self.victim = self.d / "o3_D4.npz"
        self.victim.write_bytes(self.victim.read_bytes()[:100])

    def fake_fetch(self, img, ra0, dec0, half):
        e = _support.exposure(mjd=img["mjd"], seed=99)
        e["obs_id"], e["det"] = img["obs_id"], img["det"]
        return e

    def test_offline_reports_the_broken_file(self):
        with mock.patch("sys.stderr"), mock.patch.object(cube, "fetch_exposure", side_effect=AssertionError("download")):
            with self.assertRaises(net.OfflineError) as cm:
                cube.fetch_field(self.ra, self.dec, 24)
        self.assertIn("1 of 6", str(cm.exception))
        self.assertFalse(self.victim.exists())

    def test_online_fetches_it_again(self):
        with mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), mock.patch("sys.stderr"), \
                mock.patch.object(cube, "fetch_exposure", side_effect=self.fake_fetch) as f:
            out = cube.fetch_field(self.ra, self.dec, 24, images=self.images)
        self.assertEqual(f.call_count, 1)
        self.assertEqual([e["obs_id"] for e in out], [i["obs_id"] for i in self.images])
        self.assertTrue(self.victim.exists())
        cube._load(self.victim)

    def test_intact_cache_is_read_without_network(self):
        self.victim.unlink()
        sub = [i for i in self.images if i["obs_id"] != "o3"]
        with mock.patch.object(cube, "fetch_exposure", side_effect=AssertionError("download")):
            out = cube.fetch_field(self.ra, self.dec, 24, images=sub)
        self.assertEqual(len(out), 5)
        self.assertEqual([e["mjd"] for e in out], sorted(e["mjd"] for e in out))

    def test_broken_listing_offline_is_missing(self):
        (self.d / "listing.json").write_text('[{"obs_id": "o0", "det": 1, "mj')
        with mock.patch("sys.stderr"):
            with self.assertRaises(net.OfflineError):
                cube.list_field(self.ra, self.dec, 24)
        self.assertFalse((self.d / "listing.json").exists())

    def test_broken_listing_online_is_asked_again(self):
        (self.d / "listing.json").write_bytes(b"")
        with mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), mock.patch("sys.stderr"), \
                mock.patch.object(archive, "find_images", return_value=self.images) as f:
            images, failed = cube.list_field(self.ra, self.dec, 24)
        f.assert_called_once()
        self.assertEqual((images, failed), (self.images, []))
        self.assertEqual(json.loads((self.d / "listing.json").read_text()), self.images)


class CorruptCatalogue(unittest.TestCase):
    def setUp(self):
        self.cache = _support.temp_dir(self)
        p = mock.patch.object(catalogs, "CACHE", self.cache)
        p.start()
        self.addCleanup(p.stop)
        self.csv = b"source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag\n1,10.0,20.0,1.0,2.0,3.0,15.0\n"

    def test_valid_cache_is_used_offline(self):
        (self.cache / "gaia_10.0000_+20.0000.csv").write_bytes(self.csv)
        rows = catalogs.gaia(10.0, 20.0)
        self.assertEqual(rows[0]["id"], "1")
        self.assertEqual(rows[0]["plx"], 3.0)

    def test_empty_file_offline_raises(self):
        p = self.cache / "gaia_10.0000_+20.0000.csv"
        p.write_bytes(b"")
        with mock.patch("sys.stderr"):
            with self.assertRaises(net.OfflineError):
                catalogs.gaia(10.0, 20.0)
        self.assertFalse(p.exists())

    def test_empty_file_online_is_fetched_again(self):
        p = self.cache / "gaia_10.0000_+20.0000.csv"
        p.write_bytes(b"")
        with mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), mock.patch("sys.stderr"), \
                mock.patch.object(net, "get_url", return_value=self.csv) as g:
            rows = catalogs.gaia(10.0, 20.0)
        g.assert_called_once()
        self.assertEqual(len(rows), 1)
        self.assertEqual(p.read_bytes(), self.csv)

    def test_tap_error_page_is_not_cached(self):
        with mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), \
                mock.patch.object(net, "get_url", return_value=b"<?xml version='1.0'?><VOTABLE>error</VOTABLE>"):
            with self.assertRaises(RuntimeError):
                catalogs.gaia(10.0, 20.0)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_broken_allwise_list_is_fetched_again(self):
        meta = self.cache / "allwise_10.0000_+20.0000.json"
        meta.write_text('{"W1": {"url": "https://x/a/b/c.fits", "t_mi')
        grid = mock.Mock(n=11, scale=3.075)
        with mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), mock.patch("sys.stderr"), \
                mock.patch.object(net, "get_url", return_value=b"access_url,energy_bandpassname\n") as g:
            out = catalogs.allwise_frames(10.0, 20.0, grid)
        g.assert_called_once()
        self.assertEqual(json.loads(meta.read_text()), {})
        self.assertEqual(out, {"doi": "10.26131/IRSA153"})


if __name__ == "__main__":
    unittest.main()
