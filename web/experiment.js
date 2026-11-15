import * as E from './engine.js';

export const HIT_RADIUS = 12.0;
export const MARGIN = 30.0;
export const THRESHOLD = 5.0;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTrials(fieldArcsec, { seed = 1, snrs = [6, 10, 16], shifts = [3, 6, 12], reps = 1, catchN = 3, flip = 0 } = {}) {
  const rng = mulberry32(seed), lim = fieldArcsec / 2 - MARGIN, cells = [];
  for (const m of [0, 1]) {
    for (const s of snrs) for (const d of shifts) for (let r = 0; r < reps; r++) cells.push([m, s, d]);
    for (let r = 0; r < catchN; r++) cells.push([m, 0, 0]);
  }
  const trials = cells.map(([m, s, d], i) => {
    const u1 = rng(), u2 = rng(), u3 = rng(), u4 = rng();
    return { id: i, mode: (m + flip) % 2 ? 'stereo' : 'blink', snr: s, shift: d, angle: 2 * Math.PI * u1, xi: (2 * u2 - 1) * lim, eta: (2 * u3 - 1) * lim, key: u4 };
  });
  return trials.sort((p, q) => p.key - q.key);
}

export function trialPositions(tr) {
  return [[tr.xi, tr.eta], [tr.xi + tr.shift * Math.cos(tr.angle), tr.eta + tr.shift * Math.sin(tr.angle)]];
}

export function buildTrial(pkg, tr, va, vb, lam) {
  if (!tr.snr) return { pkg, flux: 0 };
  const [pa, pb] = trialPositions(tr);
  const sa = E.fluxSigma(pkg, E.select(pkg, { visit: va, lam }), pa[0], pa[1]);
  const sb = E.fluxSigma(pkg, E.select(pkg, { visit: vb, lam }), pb[0], pb[1]);
  if (!(sa === sa && sb === sb)) return { pkg, flux: NaN };
  const f = tr.snr * Math.max(sa, sb), inWin = e => e.lam >= lam[0] && e.lam <= lam[1];
  return { pkg: E.inject(pkg, e => (!inWin(e) ? null : e.v === va ? pa : e.v === vb ? pb : null), () => f), flux: f };
}

export function isHit(tr, xi, eta) {
  const [a, b] = trialPositions(tr);
  return Math.min(Math.hypot(xi - a[0], eta - a[1]), Math.hypot(xi - b[0], eta - b[1])) <= HIT_RADIUS;
}

const median = v => { const s = Float64Array.from(v).sort(), n = s.length; return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };

export function boxMean(img, n) {
  const out = new Float64Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const p = r * n + c;
    if (img[p] !== img[p]) { out[p] = NaN; continue; }
    let s = 0, k = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const v = img[rr * n + cc];
      if (v === v) { s += v; k++; }
    }
    out[p] = s / k;
  }
  return out;
}

export function zmap(imgA, imgB, n) {
  const d = new Float64Array(n * n);
  for (let p = 0; p < n * n; p++) d[p] = imgB[p] - imgA[p];
  const sm = boxMean(d, n), v = [];
  for (let p = 0; p < n * n; p++) if (sm[p] === sm[p]) v.push(sm[p]);
  const z = new Float64Array(n * n).fill(NaN);
  if (v.length < 50) return z;
  const med = median(v), sig = 1.4826 * median(v.map(x => Math.abs(x - med))) || 1e-30;
  for (let r = 3; r < n - 3; r++) for (let c = 3; c < n - 3; c++) { const p = r * n + c; z[p] = Math.abs(sm[p] - med) / sig; }
  return z;
}

export function peakNear(z, grid, positions, radius = HIT_RADIUS) {
  let best = 0;
  for (let r = 0; r < grid.n; r++) for (let c = 0; c < grid.n; c++) {
    const v = z[r * grid.n + c];
    if (!(v > best)) continue;
    for (const [x, y] of positions) if (Math.hypot(grid.xi(c) - x, grid.eta(r) - y) <= radius) { best = v; break; }
  }
  return best;
}

export function countPeaks(z, n, threshold) {
  const at = (r, c) => { if (r < 0 || c < 0 || r >= n || c >= n) return -1; const v = z[r * n + c]; return v === v ? v : -1; };
  let count = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = at(r, c);
    if (!(v > threshold)) continue;
    let top = true;
    for (let dr = -2; dr <= 2 && top; dr++) for (let dc = -2; dc <= 2; dc++) if ((dr || dc) && at(r + dr, c + dc) >= v) { top = false; break; }
    if (top) count++;
  }
  return count;
}

export function machine(pkg, grid, va, vb, lam, { seed = 1, reps = 10, threshold = THRESHOLD, snrs = [6, 10, 16], shifts = [3, 6, 12] } = {}) {
  const n = grid.n, fr = (p, v) => E.combine(p, E.select(p, { visit: v, lam }), grid).img;
  const z0 = zmap(fr(pkg, va), fr(pkg, vb), n);
  let strongest = 0; for (const v of z0) if (v > strongest) strongest = v;
  const trials = makeTrials(n * grid.scale, { seed, reps, snrs, shifts, catchN: 0 }).filter(t => t.mode === 'blink');
  const rows = [], cells = new Map();
  for (const tr of trials) {
    const b = buildTrial(pkg, tr, va, vb, lam);
    if (!(b.flux === b.flux)) continue;
    const pos = trialPositions(tr), z1 = peakNear(zmap(fr(b.pkg, va), fr(b.pkg, vb), n), grid, pos), zc = peakNear(z0, grid, pos);
    const already = zc > threshold, found = z1 > threshold && !already;
    rows.push({ id: tr.id, snr: tr.snr, shift: tr.shift, flux: b.flux, z: z1, z_control: zc, found, already });
    const k = `${tr.snr}|${tr.shift}`, c = cells.get(k) || { snr: tr.snr, shift: tr.shift, n: 0, found: 0, already: 0, flux: 0 };
    c.n++; c.found += found; c.already += already; c.flux += b.flux; cells.set(k, c);
  }
  const out = [...cells.values()].sort((p, q) => p.snr - q.snr || p.shift - q.shift);
  out.forEach(c => { c.flux /= c.n; });
  return { threshold, false_peaks: countPeaks(z0, n, threshold), strongest, trials: rows, cells: out };
}

export const LIMIT_SNRS = [4, 6, 8, 12, 16, 24];
export function limit(pkg, grid, va, vb, lam, { seed = 1, reps = 12, shift = 12, snrs = LIMIT_SNRS, need = 0.9 } = {}) {
  const m = machine(pkg, grid, va, vb, lam, { seed, reps, snrs, shifts: [shift] });
  let level = null;
  for (let i = m.cells.length - 1; i >= 0; i--) {
    const c = m.cells[i];
    if (c.n && c.found / c.n >= need) level = c; else break;
  }
  return { shift, need, threshold: m.threshold, false_peaks: m.false_peaks, strongest: m.strongest, cells: m.cells, level };
}

export function summarise(rows) {
  const out = {};
  for (const mode of ['blink', 'stereo']) {
    const inj = rows.filter(r => r.mode === mode && r.snr > 0), empty = rows.filter(r => r.mode === mode && !r.snr);
    const hits = inj.filter(r => r.hit), rts = hits.map(r => r.rt).sort((p, q) => p - q);
    out[mode] = {
      n: inj.length, hit: hits.length, wrong: inj.filter(r => r.answer === 'click' && !r.hit).length,
      missed: inj.filter(r => r.answer !== 'click').length,
      empty: empty.length, false_alarm: empty.filter(r => r.answer === 'click').length,
      rt: rts.length ? rts[rts.length >> 1] : null,
      byShift: [...new Set(inj.map(r => r.shift))].sort((p, q) => p - q).map(d => ({ shift: d, n: inj.filter(r => r.shift === d).length, hit: hits.filter(r => r.shift === d).length })),
      bySnr: [...new Set(inj.map(r => r.snr))].sort((p, q) => p - q).map(s => ({ snr: s, n: inj.filter(r => r.snr === s).length, hit: hits.filter(r => r.snr === s).length })),
    };
  }
  return out;
}
export function wilson(k, n) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + 1 / n, c = p + 1 / (2 * n), h = Math.sqrt(p * (1 - p) / n + 1 / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
