from __future__ import annotations

import http.client
import io
import json
import os
import socket
import time
import unittest
import urllib.error
from unittest import mock

import _support
from ektos import archive, catalogs, cube, net


class OfflineGuard(unittest.TestCase):
    def test_flag_values(self):
        for v, want in (("1", True), ("true", True), ("YES", True), (" on ", True), ("0", False), ("", False), ("no", False)):
            with mock.patch.dict(os.environ, {net.OFFLINE_ENV: v}):
                self.assertEqual(net.offline(), want, v)

    def test_get_url_raises_before_any_socket(self):
        with mock.patch.object(net.urllib.request, "urlopen", side_effect=AssertionError("network used")) as u:
            with self.assertRaises(net.OfflineError) as cm:
                net.get_url("https://irsa.ipac.caltech.edu/TAP/sync?QUERY=x")
        self.assertIn(net.OFFLINE_ENV, str(cm.exception))
        u.assert_not_called()

    def test_get_range_raises_before_any_socket(self):
        with mock.patch.object(net, "_conn", side_effect=AssertionError("network used")) as c:
            with self.assertRaises(net.OfflineError):
                net.get_range(archive.S3_HOST, "/x.fits", 0, 10)
        c.assert_not_called()

    def test_offline_error_is_a_runtime_error(self):
        self.assertTrue(issubclass(net.OfflineError, RuntimeError))

    def test_any_outgoing_socket_is_refused(self):
        with self.assertRaises(net.OfflineError):
            socket.create_connection(("irsa.ipac.caltech.edu", 443), timeout=1)
        with self.assertRaises(net.OfflineError):
            http.client.HTTPSConnection("example.org", timeout=1).connect()

    def test_loopback_is_allowed(self):
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        self.addCleanup(srv.close)
        c = socket.create_connection(("127.0.0.1", srv.getsockname()[1]), timeout=2)
        c.close()

    def test_archive_does_not_swallow_offline(self):
        with self.assertRaises(net.OfflineError):
            archive.find_images(133.0, -7.0, failed=[])

    def test_wise_tables_do_not_pass_for_empty_offline(self):
        with mock.patch.object(catalogs, "CACHE", _support.temp_dir(self)):
            with self.assertRaises(net.OfflineError):
                catalogs.wise_single_exposures(133.0, -7.0)


class _Online(unittest.TestCase):
    def setUp(self):
        for p in (mock.patch.object(net, "_create_connection", side_effect=AssertionError("real network")),
                  mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), mock.patch.object(net.time, "sleep")):
            started = p.start()
            self.addCleanup(p.stop)
        self.sleep = started
        net._down.clear()
        self.addCleanup(net._down.clear)


def _http_error(code):
    return urllib.error.HTTPError("https://h/x", code, "msg", {}, io.BytesIO(b""))


class GetUrlRetries(_Online):
    def test_client_error_is_not_retried(self):
        for code in (400, 401, 403, 404, 410):
            with mock.patch.object(net.urllib.request, "urlopen", side_effect=_http_error(code)) as u:
                with self.assertRaises(RuntimeError) as cm:
                    net.get_url("https://irsa.example/x", retries=4)
            self.assertEqual(u.call_count, 1, code)
            self.assertIn(f"HTTP {code}", str(cm.exception))
        self.sleep.assert_not_called()

    def test_server_error_and_429_are_retried(self):
        for code in (429, 500, 503):
            with mock.patch.object(net.urllib.request, "urlopen", side_effect=_http_error(code)) as u:
                with self.assertRaises(RuntimeError):
                    net.get_url("https://irsa.example/x", retries=3)
            self.assertEqual(u.call_count, 3, code)

    def test_no_sleep_after_the_last_attempt(self):
        with mock.patch.object(net.urllib.request, "urlopen", side_effect=_http_error(503)):
            with self.assertRaises(RuntimeError):
                net.get_url("https://irsa.example/x", retries=3)
        self.assertEqual(self.sleep.call_count, 2)

    def test_success_after_a_retry(self):
        ok = mock.MagicMock()
        ok.__enter__.return_value.read.return_value = b"a,b\n1,2\n"
        with mock.patch.object(net.urllib.request, "urlopen", side_effect=[_http_error(503), ok]):
            self.assertEqual(net.get_url("https://irsa.example/x"), b"a,b\n1,2\n")

    def test_dead_host_costs_one_bounded_wait(self):
        clock = [1000.0]

        def slow_fail(*a, **k):
            clock[0] += 50.0
            raise urllib.error.URLError(TimeoutError("timed out"))
        with mock.patch.object(net.time, "monotonic", side_effect=lambda: clock[0]), \
                mock.patch.object(net.urllib.request, "urlopen", side_effect=slow_fail) as u:
            with self.assertRaises(RuntimeError):
                net.get_url("https://dead.example/a", retries=4)
            self.assertEqual(u.call_count, 2)
            t_first = clock[0]
            for coll in range(3):
                with self.assertRaises(net.HostDown):
                    net.get_url(f"https://dead.example/b{coll}")
            self.assertEqual(u.call_count, 2)
            self.assertEqual(clock[0], t_first)
            clock[0] += net.DOWN_FOR + 1
            with self.assertRaises(RuntimeError):
                net.get_url("https://dead.example/c", retries=1)
            self.assertEqual(u.call_count, 3)


class _Resp:
    def __init__(self, status, body=b"", cr=None):
        self.status, self._body, self._cr = status, body, cr

    def read(self):
        return self._body

    def getheader(self, k):
        return self._cr if k == "Content-Range" else None


class _Conn:
    def __init__(self, responses=(), connect_error=None):
        self.sock = None
        self.responses = list(responses)
        self.connect_error = connect_error
        self.requests = 0

    def connect(self):
        if self.connect_error:
            raise self.connect_error
        self.sock = object()

    def request(self, *a, **k):
        self.requests += 1

    def getresponse(self):
        return self.responses.pop(0)

    def close(self):
        self.sock = None


class GetRangeRetries(_Online):
    def test_client_error_is_not_retried(self):
        for code in (400, 403, 404, 416):
            c = _Conn([_Resp(code)] * 6)
            with mock.patch.object(net, "_conn", return_value=c):
                with self.assertRaises(RuntimeError) as cm:
                    net.get_range("s3.example", "/k", 0, 9)
            self.assertEqual(c.requests, 1, code)
            self.assertIn(f"HTTP {code}", str(cm.exception))

    def test_429_and_5xx_are_retried(self):
        c = _Conn([_Resp(429), _Resp(503), _Resp(206, b"0123456789", "bytes 0-9/100")])
        with mock.patch.object(net, "_conn", return_value=c):
            body, total = net.get_range("s3.example", "/k", 0, 9)
        self.assertEqual((body, total, c.requests), (b"0123456789", 100, 3))

    def test_cannot_connect_marks_the_host_down(self):
        c = _Conn(connect_error=ConnectionRefusedError("refused"))
        with mock.patch.object(net, "_conn", return_value=c), mock.patch.object(net, "_drop"):
            with self.assertRaises(RuntimeError):
                net.get_range("s3.example", "/k", 0, 9, retries=3)
            with self.assertRaises(net.HostDown):
                net.get_range("s3.example", "/k2", 0, 9)
        self.assertEqual(c.requests, 0)


class ListingAge(unittest.TestCase):
    def setUp(self):
        self.cache = _support.temp_dir(self)
        p = mock.patch.object(cube, "CACHE", self.cache)
        p.start()
        self.addCleanup(p.stop)
        self.listing = cube.field_dir(10.0, 20.0, 24) / "listing.json"
        self.saved = [{"obs_id": "a", "det": 1, "mjd": 1.0}]
        self.listing.write_text(json.dumps(self.saved))
        old = time.time() - 10 * 3600
        os.utime(self.listing, (old, old))
        self.fresh = [{"obs_id": "a", "det": 1, "mjd": 1.0}, {"obs_id": "b", "det": 2, "mjd": 2.0}]

    def test_offline_uses_the_saved_list_whatever_its_age(self):
        with mock.patch.object(archive, "find_images", side_effect=AssertionError("archive asked")):
            self.assertEqual(cube.list_field(10.0, 20.0, 24), (self.saved, []))

    def test_max_age_none_keeps_the_saved_list(self):
        with mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), \
                mock.patch.object(archive, "find_images", side_effect=AssertionError("archive asked")):
            self.assertEqual(cube.list_field(10.0, 20.0, 24, max_age=None), (self.saved, []))

    def test_online_refreshes_a_stale_list(self):
        with mock.patch.dict(os.environ, {net.OFFLINE_ENV: "0"}), \
                mock.patch.object(archive, "find_images", return_value=self.fresh) as f:
            self.assertEqual(cube.list_field(10.0, 20.0, 24), (self.fresh, []))
        f.assert_called_once()
        self.assertEqual(json.loads(self.listing.read_text()), self.fresh)

    def test_offline_without_a_saved_list_raises(self):
        with self.assertRaises(net.OfflineError):
            cube.list_field(11.0, 21.0, 24)
        with self.assertRaises(net.OfflineError):
            cube.fetch_field(11.0, 21.0, 24)
        self.assertFalse(cube.field_dir(11.0, 21.0, 24, create=False).exists())

    def test_offline_fetch_with_missing_exposures_raises_and_writes_nothing(self):
        d = cube.field_dir(10.0, 20.0, 24)
        before = sorted(p.name for p in d.iterdir())
        with mock.patch.object(cube, "fetch_exposure", side_effect=AssertionError("download attempted")):
            with self.assertRaises(net.OfflineError) as cm:
                cube.fetch_field(10.0, 20.0, 24)
        self.assertIn("1 of 1 exposures", str(cm.exception))
        self.assertEqual(sorted(p.name for p in d.iterdir()), before)


if __name__ == "__main__":
    unittest.main()
