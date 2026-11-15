import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../web/engine.js';
import * as P from '../web/physics.js';

const DATA = new URL('../web/data/', import.meta.url);
const json = f => JSON.parse(fs.readFileSync(new URL(f, DATA), 'utf8'));

function fakePkg(windows, extra = {}) {
  const N = Math.round(Math.sqrt(windows[0].length));
  const cube = new Float32Array(windows.length * N * N);
  windows.forEach((w, i) => cube.set(w, i * N * N));
  const exposures = windows.map((w, i) => ({ i, v: 0, lam: 4.5, det: 6, mjd: 61000 + i, bg: 0, sig: 1, fwhm: 8, omega: 37.9,
    M: [6.15, 0, 0, 6.15], c: [0, 0], ...extra }));
  for (const e of exposures) { const [a, b, c, d] = e.M, det = a * d - b * c; e.Minv = [d / det, -b / det, -c / det, a / det]; e.pix = 6.15; }
  return { man: { exposures }, cube, N, cache: new Map() };
}

test('median follows numpy (mean of the two middle values)', () => {
  assert.equal(E.median([3, 1, NaN, 2]), 2);
  assert.equal(E.median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(E.median([NaN])));
});

test('noiseScale finds an injected scatter', () => {
  let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (const k of [1, 4]) {
    const img = Float32Array.from({ length: 6400 }, () => 3 + 2 * k * gauss()), err = new Float32Array(6400).fill(2);
    assert.ok(Math.abs(E.noiseScale(img, err) - k) < 0.08 * k, `scale ${k}`);
  }
});

test('combine clips with the per-pixel median even when only two exposures cover a pixel', () => {
  const N = 9, base = () => new Float32Array(N * N).fill(1);
  const a = base(), b = base(), c = base();
  const p = 4 * N + 4;
  a[p] = -100; b[p] = 100; c[p] = NaN;
  const pkg = fakePkg([a, b, c], { c: [-4 * 6.15, -4 * 6.15] });
  const grid = E.makeGrid(5, 6.15);
  const f = E.combine(pkg, pkg.man.exposures, grid);
  const q = 2 * 5 + 2;
  assert.ok(Number.isNaN(f.img[q]), `got ${f.img[q]}`);
  assert.equal(f.cnt[q], 0);
  assert.ok(Math.abs(f.img[q - 1] - 1) < 1e-6 && f.cnt[q - 1] === 3);
});

test('loadPackage-style check: a window less than half finite is not used', () => {
  const N = 6, good = new Float32Array(N * N).fill(1), bad = new Float32Array(N * N).fill(NaN);
  bad.fill(1, 0, 17);
  const pkg = fakePkg([good, bad]);
  for (const e of pkg.man.exposures) {
    let fin = 0; for (let k = e.i * N * N; k < (e.i + 1) * N * N; k++) if (pkg.cube[k] === pkg.cube[k]) fin++;
    e.ok = fin / (N * N) > 0.5;
  }
  assert.deepEqual(E.select(pkg).map(e => e.i), [0]);
});

test('fitCentroid recovers a Gaussian and flags a fit on the box edge', () => {
  const grid = E.makeGrid(99, 3.075), n = grid.n, img = new Float32Array(n * n), err = new Float32Array(n * n).fill(1);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = grid.xi(c), y = grid.eta(r);
    img[r * n + c] = 50 * Math.exp(-0.5 * ((x - 7.3) ** 2 + (y + 4.1) ** 2) / 4.2 ** 2) + 1 + (rnd() - 0.5) * 2;
  }
  const f = E.fitCentroid(img, err, grid, 6, -3);
  assert.ok(Math.hypot(f.xi - 7.3, f.eta + 4.1) < 0.1);
  assert.ok(f.snr > 20 && !E.fitAtBound(f, 6, -3));
  const flat = new Float32Array(n * n).fill(1);
  const g = E.fitCentroid(flat, err, grid, 0, 0);
  assert.ok(g === null || E.fitAtBound(g, 0, 0) || g.snr < 1, 'no source: null, on a bound or S/N < 1');
});

test('parallax factors agree with astropy (parity.json)', () => {
  const P0 = json('parity.json').parallax;
  P0.mjd.forEach((m, i) => {
    const [pa, pd] = E.parallaxFactors(P0.ra, P0.dec, m);
    assert.ok(Math.abs(pa - P0.pa[i]) < 2e-4 && Math.abs(pd - P0.pd[i]) < 2e-4, `mjd ${m}`);
  });
});

test('simulation and engine use the same Earth for a star track', () => {
  const ast = { ra: 133.7952, dec: -7.2449, epoch: 2016.0, pmra: -8.118, pmdec: 0.680, plx: 0.439 };
  for (const m of [60790, 61000, 61160]) {
    const a = P.starOffset(ast, m), b = E.motionOffset(ast, m);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9);
  }
});

test('Kepler solver, 20000 random orbits', () => {
  let worst = 0;
  for (let k = 0; k < 20000; k++) {
    const e = Math.random() * 0.995, M = (Math.random() * 2 - 1) * Math.PI, Ec = P.solveKepler(M, e);
    worst = Math.max(worst, Math.abs(Ec - e * Math.sin(Ec) - M));
  }
  assert.ok(worst < 1e-12);
});

test('pointing rule hold-out with the page Sun matches Python', () => {
  const PNT = json('spherex_pointing.json');
  const el = f => f.mjd.map(m => P.elongation(P.unit(f.center[0], f.center[1]), m));
  const pct = (v, q) => { const s = [...v].sort((a, b) => a - b); const i = q * (s.length - 1), k = Math.floor(i); return s[k] + (s[Math.min(k + 1, s.length - 1)] - s[k]) * (i - k); };
  const train = PNT.fields.filter((f, i) => i % 2 === 0).flatMap(el), lo = pct(train, 0.01), hi = pct(train, 0.99);
  const test_ = PNT.fields.filter((f, i) => i % 2 === 1).flatMap(el);
  const held = test_.filter(e => e >= lo && e <= hi).length / test_.length;
  assert.ok(Math.abs(lo - PNT.python.window[0]) < 0.2 && Math.abs(hi - PNT.python.window[1]) < 0.2);
  assert.ok(Math.abs(held - PNT.python.held_out_inside) < 0.005);
});
