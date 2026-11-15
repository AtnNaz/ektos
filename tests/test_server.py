from __future__ import annotations

import functools
import http.client
import http.server
import json
import threading
import time
import unittest
from unittest import mock

import _support
from ektos import cube, package, server


class Requests(unittest.TestCase):
    def test_parse_rejects_bad_coordinates(self):
        bad = [{}, {"ra": ["10"]}, {"dec": ["10"]}, {"ra": ["nan"], "dec": ["1"]}, {"ra": ["1"], "dec": ["nan"]},
               {"ra": ["inf"], "dec": ["1"]}, {"ra": ["1e400"], "dec": ["1"]}, {"ra": ["abc"], "dec": ["1"]},
               {"ra": ["1"], "dec": ["91"]}, {"ra": ["1"], "dec": ["-90.5"]}, {"ra": ["1"], "dec": ["1"], "half": ["x"]},
               {"ra": ["1"], "dec": ["1"], "max": ["2.5"]}]
        for q in bad:
            with self.assertRaises(server.BadRequest, msg=str(q)):
                server.parse_request(q)

    def test_parse_normal_requests(self):
        self.assertEqual(server.parse_request({"ra": ["-10"], "dec": ["5"]}), (350.0, 5.0, 24, 600, None))
        self.assertEqual(server.parse_request({"ra": ["1"], "dec": ["2"], "half": ["99"], "max": ["5"]}), (1.0, 2.0, 40, 20, None))
        ra, dec, half, mx, t = server.parse_request({"t": ["rdra"], "half": ["40"]})
        self.assertEqual((ra, dec, half, t), (248.1675, 66.755, 40, "rdra"))
        self.assertEqual(server.parse_request({"t": ["nosuch"], "ra": ["1"], "dec": ["2"]})[4], None)

    def test_slugs_follow_package_build(self):
        self.assertEqual(server.slug_for(248.1675, 66.755, 24, "rdra"), "rdra")
        self.assertEqual(server.slug_for(133.7776, -7.2437, 40, "wise0855"), "wise0855_h40")
        self.assertEqual(server.slug_for(10.0, -5.5, 24, None), package.default_slug(10.0, -5.5, 24))
        self.assertEqual(server.slug_for(10.0, -5.5, 40, None), package.default_slug(10.0, -5.5, 40))

    def test_every_packaged_curated_field_is_protected(self):
        names = sorted(p.name for p in package.WEB.iterdir() if (p / "manifest.json").exists())
        expected = [s for s in names if s in ("wise0855", "barnard", "epsindib", "rwaur", "rdra", "smdet1", "luhman16",
                                               "wise0855_h40") or s.startswith("y_")]
        self.assertTrue(expected)
        self.assertEqual([s for s in expected if not server.is_curated(s)], [])


class Api(unittest.TestCase):
    def setUp(self):
        self.web = _support.temp_dir(self)
        self.cache = _support.temp_dir(self)
        for p in (mock.patch.object(package, "WEB", self.web), mock.patch.object(cube, "CACHE", self.cache)):
            p.start()
            self.addCleanup(p.stop)
        server.JOBS.clear()
        for slug in ("rdra", "y_wise_x", "f_measured"):
            (self.web / slug).mkdir()
            (self.web / slug / "manifest.json").write_text("{}")
        (self.web / "f_measured" / "candidate.json").write_text("{}")
        self.before = {p: p.read_bytes() for p in self.web.rglob("*") if p.is_file()}
        handler = functools.partial(server.Handler, directory=str(self.web))
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)

    def get(self, path):
        c = http.client.HTTPConnection("127.0.0.1", self.srv.server_address[1], timeout=30)
        try:
            c.request("GET", path)
            r = c.getresponse()
            return r.status, json.loads(r.read())
        finally:
            c.close()

    def wait(self, job):
        for _ in range(300):
            code, st = self.get(f"/api/status?job={job}")
            if st["state"] in ("done", "error"):
                return st
            time.sleep(0.05)
        self.fail("job did not finish")

    def test_bad_input_is_400(self):
        for q in ("ra=nan&dec=1", "ra=1&dec=95", "ra=abc&dec=1", "dec=1", "ra=1&dec=inf", "ra=1&dec=1&half=x"):
            code, body = self.get("/api/build?" + q)
            self.assertEqual(code, 400, q)
            self.assertIn("error", body)
        self.assertEqual(server.JOBS, {})
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_curated_package_is_not_rebuilt(self):
        for q, slug in (("t=rdra", "rdra"), ("t=rdra&max=3000", "rdra")):
            code, body = self.get("/api/build?" + q)
            self.assertEqual(code, 200)
            st = self.wait(body["job"])
            self.assertEqual((st["state"], st["slug"], st.get("kept")), ("done", slug, True))
        code, body = self.get("/api/count?t=rdra")
        self.assertEqual(body, {"slug": "rdra", "kept": True})
        self.assertEqual({p: p.read_bytes() for p in self.web.rglob("*") if p.is_file()}, self.before)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_measured_package_is_protected_too(self):
        self.assertTrue(server.is_curated("f_measured"))
        self.assertTrue(server.is_curated("y_wise_x"))
        self.assertFalse(server.is_curated("f_unmeasured"))

    def test_new_position_offline_fails_cleanly(self):
        code, body = self.get("/api/build?ra=12.5&dec=-3.25")
        st = self.wait(body["job"])
        self.assertEqual((st["state"], st["code"]), ("error", "offline"))
        self.assertIn("EKTOS_OFFLINE", st["error"])
        code, body = self.get("/api/count?ra=12.5&dec=-3.25")
        self.assertEqual((code, body["code"]), (503, "offline"))
        self.assertEqual({p: p.read_bytes() for p in self.web.rglob("*") if p.is_file()}, self.before)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_count_from_a_cached_list(self):
        d = cube.field_dir(12.5, -3.25, 24)
        images = [{"obs_id": f"o{i}", "det": 1, "mjd": float(i)} for i in range(700)]
        (d / "listing.json").write_text(json.dumps(images))
        code, body = self.get("/api/count?ra=12.5&dec=-3.25")
        self.assertEqual(code, 200)
        self.assertEqual((body["listed"], body["total"], body["cached"], body["kept"]), (700, 600, 0, False))
        self.assertAlmostEqual(body["est_mb"], cube.estimate_bytes(600, 24) / 1e6, places=1)


if __name__ == "__main__":
    unittest.main()
