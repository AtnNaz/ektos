from __future__ import annotations

import argparse
import math
import os
import sys
import time

from . import _console, cube, net


def _progress(done, total, meter):
    if done == total or done % 10 == 0:
        print(f"  {done}/{total} exposures   {meter['mb']:.1f} MB   {meter['requests']} requests   "
              f"{meter['retries']} retries", flush=True)


def main(argv=None):
    _console.utf8_stdout()
    ap = argparse.ArgumentParser(prog="ektos")
    ap.add_argument("--offline", action="store_true",
                    help=f"never use the network; cached lists are used whatever their age (same as {net.OFFLINE_ENV}=1)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--ra", type=float, required=True)
    f.add_argument("--dec", type=float, required=True)
    f.add_argument("--half", type=int, default=24)
    f.add_argument("--dets", default="")
    f.add_argument("--workers", type=int, default=24)
    f.add_argument("--limit", type=int, default=0)
    c = sub.add_parser("count")
    c.add_argument("--ra", type=float, required=True)
    c.add_argument("--dec", type=float, required=True)
    c.add_argument("--half", type=int, default=24)
    b = sub.add_parser("build")
    b.add_argument("target", nargs="?")
    b.add_argument("--ra", type=float)
    b.add_argument("--dec", type=float)
    b.add_argument("--half", type=int, default=24)
    b.add_argument("--dets", default="")
    b.add_argument("--workers", type=int, default=24)
    b.add_argument("--max", type=int, default=0, help="fetch at most this many exposures, evenly spread in time")
    a = ap.parse_args(argv)
    if a.offline:
        os.environ[net.OFFLINE_ENV] = "1"
    if (a.ra is not None and not math.isfinite(a.ra)) or (a.dec is not None and not -90.0 <= a.dec <= 90.0):
        ap.error(f"--ra and --dec must be finite degrees with -90 <= dec <= 90 (got {a.ra}, {a.dec})")
    try:
        _command(a)
    except net.OfflineError as ex:
        sys.exit(f"ektos: {ex}")


def _command(a):
    t0 = time.time()
    if a.cmd == "count":
        images, failed = cube.list_field(a.ra, a.dec, a.half)
        d = cube.field_dir(a.ra, a.dec, a.half)
        have = sum(1 for i in images if (d / f"{i['obs_id']}_D{i['det']}.npz").exists())
        by = {}
        for i in images:
            by[i["collection"]] = by.get(i["collection"], 0) + 1
        print(f"{len(images)} exposures listed ({', '.join(f'{k}: {v}' for k, v in sorted(by.items())) or 'none'}); "
              f"{have} already in cache; the rest would cost about "
              f"{cube.estimate_bytes(len(images) - have, a.half) / 1e6:.1f} MB at half={a.half}")
        if failed:
            print(f"warning: no answer from {', '.join(failed)}; the list may be incomplete")
        print(f"listing cost: {net.METER.snapshot()}")
    elif a.cmd == "fetch":
        dets = [int(x) for x in a.dets.split(",") if x] or None
        exps = cube.fetch_field(a.ra, a.dec, a.half, dets, a.workers, _progress, a.limit or None)
        print(f"{len(exps)} exposures in cache, {time.time() - t0:.0f}s, network: {net.METER.snapshot()}")
    elif a.cmd == "build":
        from . import package
        dets = [int(x) for x in a.dets.split(",") if x] or None
        images = listed = None
        if a.max:
            from .targets import TARGETS
            ra, dec = TARGETS[a.target]["center"] if a.target in TARGETS else (a.ra, a.dec)
            full, _ = cube.list_field(ra, dec, a.half)
            images, listed = cube.thin(full, a.max), len(full)
            print(f"  {listed} exposures listed, fetching {len(images)}", flush=True)
        out = package.build(a.target, a.ra, a.dec, a.half, dets, a.workers, _progress, images=images, listed=listed)
        print(f"wrote {out}  ({time.time() - t0:.0f}s, network: {net.METER.snapshot()})")


if __name__ == "__main__":
    sys.exit(main())
