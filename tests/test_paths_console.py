from __future__ import annotations

import io
import os
import pathlib
import subprocess
import sys
import types
import unittest
from unittest import mock

import _support
from ektos import _console, benchmark, cutouts, ydwarfs

TEXT = "µ″−≥ ϖ σ"


class DataRoot(unittest.TestCase):
    def test_default_is_the_project_folder(self):
        self.assertEqual(ydwarfs.DATA_ROOT, _support.ROOT / "datasets")
        self.assertTrue(ydwarfs.DATA_ROOT.is_absolute())

    def test_no_drive_letter_left(self):
        for mod in (benchmark, ydwarfs):
            self.assertNotIn("G:/datasets", pathlib.Path(mod.__file__).read_text(encoding="utf-8"))

    def test_targets_read_from_a_given_root(self):
        root = _support.temp_dir(self)
        cat = root / "05_y_dwarfs" / "catalogs"
        cat.mkdir(parents=True)
        (cat / "targets_B_offplane_Y.csv").write_text(
            "name,source_name,ra,dec,spt,teff,glat,pmra,pmdec,plx,W2\n"
            "wise_x,WISE X,10.0,20.0,Y1,400,30.0,100,-200,50,15.2\n", encoding="utf-8")
        t = ydwarfs.targets(root)
        self.assertEqual(len(t), 1)
        self.assertEqual((t[0]["name"], t[0]["w2"], t[0]["plane"]), ("WISE X", 15.2, False))
        self.assertEqual(t[0]["folder"], root / "05_y_dwarfs" / "spherex_cutouts" / "wise_x")

    @unittest.skipUnless((ydwarfs.DATA_ROOT / "05_y_dwarfs" / "catalogs").is_dir(), "no datasets/ on this machine")
    def test_project_folder_has_the_target_lists(self):
        self.assertGreater(len(ydwarfs.targets(ydwarfs.DATA_ROOT)), 0)


class CutoutCollection(unittest.TestCase):
    def test_from_publisher_did(self):
        self.assertEqual(cutouts.collection_of("ivo://irsa.ipac/spherex_dr1?2025W29_1A_0425_1/D4"), "spherex_dr1")
        self.assertEqual(cutouts.collection_of("ivo://irsa.ipac/spherex_qr3_deep?2025W40_2B_0001_3/D6"), "spherex_qr3_deep")

    def test_from_file_name(self):
        self.assertEqual(cutouts.collection_of("", "60906.989236_D1_spherex_dr1_2025W34_1B_0379_1_D1.fits"), "spherex_dr1")
        self.assertEqual(cutouts.collection_of("", "60906.98_D5_spherex_dr1_deep_2025W34_1B_0379_1_D5.fits"),
                         "spherex_dr1_deep")
        self.assertEqual(cutouts.collection_of("", "unknown.fits"), "")


class Console(unittest.TestCase):
    def test_cp1254_stream_does_not_crash(self):
        raw = io.BytesIO()
        s = io.TextIOWrapper(raw, encoding="cp1254", errors="strict")
        with self.assertRaises(UnicodeEncodeError):
            s.write("″")
            s.flush()
        _console.utf8_stdout(s)
        print(TEXT, file=s)
        s.flush()
        self.assertEqual(raw.getvalue().decode("utf-8").strip(), TEXT)

    def test_stream_without_reconfigure_is_left_alone(self):
        s = io.StringIO()
        self.assertIs(_console.utf8_stdout(s), s)

    def test_entry_point_detection(self):
        fake = types.ModuleType("__main__")
        fake.__spec__ = types.SimpleNamespace(name="ektos.analysis")
        with mock.patch.dict(sys.modules, {"__main__": fake}):
            self.assertTrue(_console.entry_is_ektos())
        fake.__spec__ = None
        with mock.patch.dict(sys.modules, {"__main__": fake}):
            self.assertFalse(_console.entry_is_ektos())

    def _pipe(self, code):
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
        env.update(EKTOS_OFFLINE="1", PYTHONUTF8="0")
        return subprocess.run([sys.executable, "-c", code], cwd=_support.ROOT, env=env, capture_output=True, timeout=300)

    def test_pipe_without_the_fix_is_what_crashed(self):
        r = self._pipe("import sys; print(sys.stdout.encoding)")
        enc = r.stdout.decode("ascii", "replace").strip().lower().replace("-", "")
        if enc in ("utf8", "utf_8"):
            self.skipTest(f"this machine's locale is {enc}; the cp1254 crash cannot happen here")
        r = self._pipe("print(" + repr(TEXT) + ")")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"UnicodeEncodeError", r.stderr)

    def test_helper_prints_through_a_pipe(self):
        r = self._pipe("import ektos._console as c; c.utf8_stdout(); print(" + repr(TEXT) + ")")
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        self.assertEqual(r.stdout.decode("utf-8").strip(), TEXT)

    def test_any_ektos_entry_point_is_covered_by_importing_net(self):
        r = self._pipe("import sys, types; sys.modules['__main__'].__spec__ = types.SimpleNamespace(name='ektos.analysis'); "
                       "import ektos.net; print(" + repr(TEXT) + ")")
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        self.assertEqual(r.stdout.decode("utf-8").strip(), TEXT)

    def test_cli_help_through_a_pipe(self):
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING",)}
        env.update(EKTOS_OFFLINE="1", PYTHONUTF8="0")
        r = subprocess.run([sys.executable, "-m", "ektos.cli", "--help"], cwd=_support.ROOT, env=env,
                           capture_output=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        self.assertIn(b"--offline", r.stdout)


if __name__ == "__main__":
    unittest.main()
