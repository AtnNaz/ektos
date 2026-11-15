import { earthBarycentric } from './physics.js';

export const ARCSEC2_PER_SR = 4.254517e10;
const FWHM2SIG = 1 / 2.354820045;

export async function loadPackage(slug, base = 'data/') {
  const man = await (await fetch(`${base}${slug}/manifest.json`)).json();
  const buf = await (await fetch(`${base}${slug}/cube.f32`)).arrayBuffer();
  const pkg = { man, cube: new Float32Array(buf), N: man.native.n, cache: new Map() };
  if (pkg.cube.length !== man.exposures.length * pkg.N * pkg.N) throw new Error('cube size does not match manifest');
  if (man.wise) {
    const wb = await (await fetch(`${base}${slug}/wise.f32`)).arrayBuffer();
    const all = new Float32Array(wb), n2 = man.grid.n * man.grid.n;
    pkg.wise = {};
    man.wise.bands.forEach((b, i) => { pkg.wise[b] = all.subarray(i * n2, (i + 1) * n2); });
  }
  const N2 = pkg.N * pkg.N;
  man.exposures.forEach((e, i) => {
    e.i = i;
    const [a, b, c, d] = e.M, det = a * d - b * c;
    e.Minv = [d / det, -b / det, -c / det, a / det];
    e.pix = Math.sqrt(Math.abs(det));
    let fin = 0;
    for (let p = i * N2, q = p + N2; p < q; p++) if (pkg.cube[p] === pkg.cube[p]) fin++;
    e.ok = Number.isFinite(e.bg) && e.sig > 0 && fin / N2 > 0.5;
  });
  return pkg;
}

export function makeGrid(n, scale) {
  const c = (n - 1) / 2;
  return {
    n, scale, c,
    xi: col => (c - col) * scale,
    eta: row => (c - row) * scale,
    col: xi => c - xi / scale,
    row: eta => c - eta / scale,
  };
}

export function gridForFov(fovArcsec, scale, maxN = Infinity) {
  let n = Math.round(fovArcsec / scale);
  if (n % 2 === 0) n += 1;
  return makeGrid(Math.min(n, maxN), scale);
}

export function cropCentered(img, nFull, n) {
  if (n === nFull) return img;
  const off = (nFull - n) / 2, out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) out.set(img.subarray((r + off) * nFull + off, (r + off) * nFull + off + n), r * n);
  return out;
}

export function reproject(pkg, e, grid, shift = [0, 0]) {
  const { N, cube } = pkg, off = e.i * N * N, n = grid.n, out = new Float32Array(n * n);
  const [m0, m1, m2, m3] = e.Minv;
  for (let r = 0; r < n; r++) {
    const dy = grid.eta(r) + shift[1] - e.c[1];
    for (let c = 0; c < n; c++) {
      const dx = grid.xi(c) + shift[0] - e.c[0];
      const x = m0 * dx + m1 * dy, y = m2 * dx + m3 * dy;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= N - 1 || y0 >= N - 1) { out[r * n + c] = NaN; continue; }
      const fx = x - x0, fy = y - y0, p = off + y0 * N + x0;
      out[r * n + c] = (1 - fx) * (1 - fy) * cube[p] + fx * (1 - fy) * cube[p + 1]
        + (1 - fx) * fy * cube[p + N] + fx * fy * cube[p + N + 1] - e.bg;
    }
  }
  return out;
}

export function combine(pkg, exps, grid, shifts = null) {
  const n2 = grid.n * grid.n, k = exps.length;
  const img = new Float32Array(n2).fill(NaN), err = new Float32Array(n2).fill(NaN), cnt = new Uint16Array(n2);
  if (!k) return { img, err, cnt, used: 0 };
  const layers = exps.map((e, i) => reproject(pkg, e, grid, shifts ? shifts[i] : [0, 0]));
  const w = exps.map(e => 1 / (e.sig * e.sig)), tmp = new Float32Array(k);
  for (let p = 0; p < n2; p++) {
    let m = 0;
    for (let i = 0; i < k; i++) { const v = layers[i][p]; if (v === v) tmp[m++] = v; }
    if (!m) continue;
    const clip = k >= 3;
    let med = 0;
    if (clip) {
      const s = tmp.subarray(0, m).slice().sort();
      med = m % 2 ? s[(m - 1) / 2] : 0.5 * (s[m / 2 - 1] + s[m / 2]);
    }
    let sw = 0, swx = 0, c = 0;
    for (let i = 0; i < k; i++) {
      const v = layers[i][p];
      if (v !== v) continue;
      if (clip && Math.abs(v - med) > Math.max(8 * exps[i].sig, 2 * Math.abs(med))) continue;
      sw += w[i]; swx += w[i] * v; c++;
    }
    if (sw > 0) { img[p] = swx / sw; err[p] = 1 / Math.sqrt(sw); cnt[p] = c; }
  }
  return { img, err, cnt, used: k };
}

export function select(pkg, { visit = null, lam = null, det = null } = {}) {
  return pkg.man.exposures.filter(e => e.ok !== false &&
    (visit === null || e.v === visit) && (det === null || e.det === det)
    && (lam === null || (e.lam >= lam[0] && e.lam <= lam[1])));
}

export function frame(pkg, grid, visit, lam) {
  const key = `${visit}|${lam[0].toFixed(3)}|${lam[1].toFixed(3)}|${grid.n}`;
  if (!pkg.cache.has(key)) pkg.cache.set(key, combine(pkg, select(pkg, { visit, lam }), grid));
  return pkg.cache.get(key);
}

export function coldFilter(pkg, grid, visit, num = [4.0, 5.03], den = [3.0, 3.8]) {
  const a = frame(pkg, grid, visit, num), b = frame(pkg, grid, visit, den);
  const col = pkg.man.visits[visit].star_colour_w2w1;
  const k = col ? col.k : 0.6, n2 = grid.n * grid.n;
  const img = new Float32Array(n2), err = new Float32Array(n2);
  for (let p = 0; p < n2; p++) {
    img[p] = a.img[p] - k * b.img[p];
    err[p] = Math.hypot(a.err[p], k * b.err[p]);
  }
  return { img, err, cnt: a.cnt, used: a.used + b.used, k, kn: col ? col.n : 0, kDefault: !col };
}

export function robustStats(img) {
  const v = [];
  for (let i = 0; i < img.length; i += 1) if (img[i] === img[i]) v.push(img[i]);
  if (v.length < 10) return { med: 0, sig: 1, hi: 1 };
  const f = Float32Array.from(v).sort();
  const med = f[f.length >> 1];
  const dev = f.map(x => Math.abs(x - med)).sort();
  const sig = 1.4826 * dev[dev.length >> 1] || 1e-9;
  return { med, sig, hi: f[Math.min(f.length - 1, Math.floor(f.length * 0.997))] };
}

export function median(a) {
  const v = [];
  for (let i = 0; i < a.length; i++) if (a[i] === a[i]) v.push(a[i]);
  if (!v.length) return NaN;
  v.sort((p, q) => p - q);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

export function noiseScale(img, err) {
  const z = [];
  for (let p = 0; p < img.length; p++) { const v = img[p] / err[p]; if (v === v && Math.abs(v) !== Infinity) z.push(v); }
  if (z.length < 50) return 1;
  const med = median(z);
  return 1.4826 * median(z.map(v => Math.abs(v - med)));
}

export function fitCentroid(img, err, grid, xi0, eta0, boxArcsec = 22, fwhm0 = 9) {
  const half = boxArcsec / 2, X = [], Y = [], Z = [], S = [];
  const over = Math.max(1, 6.15 / grid.scale);
  let errMed = null;
  for (let r = 0; r < grid.n; r++) {
    const y = grid.eta(r);
    if (Math.abs(y - eta0) > half) continue;
    for (let c = 0; c < grid.n; c++) {
      const x = grid.xi(c), p = r * grid.n + c, v = img[p];
      if (Math.abs(x - xi0) > half || v !== v) continue;
      let s = err[p];
      if (!(s > 0) || s === Infinity) { if (errMed === null) errMed = median(err); s = errMed; }
      X.push(x); Y.push(y); Z.push(v); S.push(s * over);
    }
  }
  const m = Z.length;
  if (m < 25) return null;
  const zmed = median(Z);
  let zmax = -Infinity; for (const v of Z) if (v > zmax) zmax = v;
  let p = [Math.max(zmax - zmed, 1e-6), xi0, eta0, fwhm0 * FWHM2SIG, zmed];
  const lo = [0, xi0 - half, eta0 - half, 2.0, -Infinity], hi = [Infinity, xi0 + half, eta0 + half, 8.0, Infinity];
  const clamp = (q0, d) => {
    let a = 1;
    for (let k = 0; k < 5; k++) {
      if (d[k] > 0 && q0[k] + d[k] > hi[k]) a = Math.min(a, 0.995 * (hi[k] - q0[k]) / d[k]);
      if (d[k] < 0 && q0[k] + d[k] < lo[k]) a = Math.min(a, 0.995 * (lo[k] - q0[k]) / d[k]);
    }
    return q0.map((v, k) => v + a * d[k]);
  };
  const resid = q => {
    const r = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const d2 = (X[i] - q[1]) ** 2 + (Y[i] - q[2]) ** 2;
      r[i] = (q[0] * Math.exp(-0.5 * d2 / (q[3] * q[3])) + q[4] - Z[i]) / S[i];
    }
    return r;
  };
  const jac = q => {
    const J = [];
    for (let i = 0; i < m; i++) {
      const dx = X[i] - q[1], dy = Y[i] - q[2], d2 = dx * dx + dy * dy, s2 = q[3] * q[3];
      const g = Math.exp(-0.5 * d2 / s2), w = 1 / S[i];
      J.push([g * w, q[0] * g * dx / s2 * w, q[0] * g * dy / s2 * w, q[0] * g * d2 / (s2 * q[3]) * w, w]);
    }
    return J;
  };
  const cost = r => { let s = 0; for (const v of r) s += v * v; return s; };
  const normal = (J, r) => {
    const A = Array.from({ length: 5 }, () => new Float64Array(5)), g = new Float64Array(5);
    for (let i = 0; i < m; i++) {
      const Ji = J[i];
      for (let a = 0; a < 5; a++) { g[a] += Ji[a] * r[i]; for (let b = 0; b < 5; b++) A[a][b] += Ji[a] * Ji[b]; }
    }
    return [A, g];
  };
  let r = resid(p), c0 = cost(r), lam = 1e-3;
  for (let it = 0; it < 500; it++) {
    const [A, g] = normal(jac(p), r);
    let accepted = false;
    for (let t = 0; t < 30 && !accepted; t++) {
      const M = A.map((row, a) => Array.from(row, (v, b) => v + (a === b ? lam * Math.max(v, 1e-30) : 0)));
      const d = solve5(M, Array.from(g, v => -v));
      if (!d) { lam *= 10; continue; }
      const q = clamp(p, d), rq = resid(q), cq = cost(rq);
      if (cq <= c0) {
        const small = d.every((v, k) => Math.abs(q[k] - p[k]) <= 1e-12 * (Math.abs(p[k]) + 1e-12));
        const flat = c0 - cq <= 1e-15 * c0;
        p = q; r = rq; lam = Math.max(lam / 3, 1e-12); accepted = true;
        if (small || flat) { it = 1e9; }
        c0 = cq;
      } else lam *= 4;
    }
    if (!accepted) break;
  }
  const dof = Math.max(1, m - 5), chi2r = c0 / dof;
  const [A] = normal(jac(p), r), cov = inv5(A);
  if (!cov) return null;
  const k = Math.max(1, chi2r), ea = Math.sqrt(cov[0][0] * k);
  return {
    xi: p[1], eta: p[2], e_xi: Math.sqrt(cov[1][1] * k), e_eta: Math.sqrt(cov[2][2] * k),
    amp: p[0], fwhm: p[3] / FWHM2SIG, snr: ea > 0 ? p[0] / ea : 0, chi2r,
  };
}
function solve5(A, b) {
  const n = 5, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 0)) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function inv5(A) {
  const cols = [];
  for (let j = 0; j < 5; j++) { const x = solve5(A.map(r => Array.from(r)), [0, 1, 2, 3, 4].map(i => (i === j ? 1 : 0))); if (!x) return null; cols.push(x); }
  return [0, 1, 2, 3, 4].map(i => cols.map(c => c[i]));
}

export function centroid(fr, grid, xi0, eta0, fwhm = 10, box = 22) {
  const seed = windowedCentroid(fr, grid, xi0, eta0, fwhm, box);
  if (!seed) return null;
  const f = fitCentroid(fr.img, fr.err, grid, seed.xi, seed.eta, box);
  if (!f || fitAtBound(f, seed.xi, seed.eta, box)) return null;
  return { ...f, e: Math.sqrt(0.5 * (f.e_xi * f.e_xi + f.e_eta * f.e_eta)) };
}
export function fitAtBound(f, x0, y0, box = 22) {
  const s = f.fwhm * FWHM2SIG;
  return Math.abs(f.xi - x0) >= box / 2 - 0.05 || Math.abs(f.eta - y0) >= box / 2 - 0.05 || s <= 2.01 || s >= 7.99 || !(f.amp > 0);
}

export function windowedCentroid(fr, grid, xi0, eta0, fwhm = 10, box = 22) {
  const sg = fwhm * FWHM2SIG, half = box / 2;
  let cx = xi0, cy = eta0, bg = 0;
  const vals = [];
  for (let r = 0; r < grid.n; r++) for (let c = 0; c < grid.n; c++) {
    const d = Math.hypot(grid.xi(c) - xi0, grid.eta(r) - eta0), v = fr.img[r * grid.n + c];
    if (v === v && d > 16 && d < 24) vals.push(v);
  }
  if (vals.length > 20) { vals.sort((a, b) => a - b); bg = vals[vals.length >> 1]; }
  let flux = 0, noise2 = 0;
  for (let it = 0; it < 12; it++) {
    let sw = 0, sx = 0, sy = 0; flux = 0; noise2 = 0;
    for (let r = 0; r < grid.n; r++) {
      const y = grid.eta(r); if (Math.abs(y - cy) > half) continue;
      for (let c = 0; c < grid.n; c++) {
        const x = grid.xi(c); if (Math.abs(x - cx) > half) continue;
        const p = r * grid.n + c, v = fr.img[p] - bg; if (v !== v) continue;
        const g = Math.exp(-0.5 * ((x - cx) ** 2 + (y - cy) ** 2) / (sg * sg));
        sw += g * v; sx += g * v * (x - cx); sy += g * v * (y - cy);
        flux += g * v; noise2 += (g * (fr.err[p] || 0)) ** 2;
      }
    }
    if (!(sw > 0)) return null;
    const dx = 2 * sx / sw, dy = 2 * sy / sw;
    cx += dx; cy += dy;
    if (Math.hypot(dx, dy) < 0.01) break;
    if (Math.hypot(cx - xi0, cy - eta0) > half) return null;
  }
  const over = Math.max(1, 6.15 / grid.scale);
  const snr = flux / (Math.sqrt(noise2) * over || Infinity);
  return { xi: cx, eta: cy, snr, e: snr > 0 ? (fwhm * FWHM2SIG * 1.4142) / snr : NaN };
}

export function forcedFlux(pkg, e, xi, eta, box = 7) {
  const { N, cube } = pkg, off = e.i * N * N, half = box >> 1;
  const dx = xi - e.c[0], dy = eta - e.c[1];
  const col = e.Minv[0] * dx + e.Minv[1] * dy, row = e.Minv[2] * dx + e.Minv[3] * dy;
  const c0 = Math.round(col), r0 = Math.round(row);
  if (c0 < half || r0 < half || c0 >= N - half || r0 >= N - half) return null;
  const sg = (e.fwhm || 8) * FWHM2SIG / e.pix, norm = 1 / (2 * Math.PI * sg * sg);
  let n = 0, sp = 0, spp = 0, sd = 0, spd = 0;
  for (let r = r0 - half; r <= r0 + half; r++) for (let c = c0 - half; c <= c0 + half; c++) {
    const d = cube[off + r * N + c]; if (d !== d) continue;
    const p = norm * Math.exp(-0.5 * ((c - col) ** 2 + (r - row) ** 2) / (sg * sg));
    n++; sp += p; spp += p * p; sd += d; spd += p * d;
  }
  if (n < 0.8 * box * box) return null;
  const den = n * spp - sp * sp; if (!(den > 0)) return null;
  const toUJy = e.omega / ARCSEC2_PER_SR * 1e12;
  return { flux: (n * spd - sp * sd) / den * toUJy, err: Math.sqrt(n / den) * e.sig * toUJy };
}

export function spectrum(pkg, track) {
  const out = [];
  for (const e of pkg.man.exposures) {
    if (e.ok === false) continue;
    const [xi, eta] = track(e.mjd), f = forcedFlux(pkg, e, xi, eta);
    if (f) out.push({ lam: e.lam, bw: e.bw, flux: f.flux, err: f.err, mjd: e.mjd, v: e.v, det: e.det });
  }
  return out.sort((a, b) => a.lam - b.lam);
}

export const INJECT_BOX = 7;
export function inject(pkg, pos, flux) {
  const { N } = pkg, cube = new Float32Array(pkg.cube), B = INJECT_BOX;
  for (const e of pkg.man.exposures) {
    const p = pos(e); if (!p) continue;
    const dx = p[0] - e.c[0], dy = p[1] - e.c[1];
    const col = e.Minv[0] * dx + e.Minv[1] * dy, row = e.Minv[2] * dx + e.Minv[3] * dy;
    const c0 = Math.floor(col + 0.5), r0 = Math.floor(row + 0.5);
    const ca = Math.max(0, c0 - B), cb = Math.min(N, c0 + B + 1), ra = Math.max(0, r0 - B), rb = Math.min(N, r0 + B + 1);
    if (cb <= ca || rb <= ra) continue;
    const sg = (e.fwhm || 8) * FWHM2SIG / e.pix, norm = 1 / (2 * Math.PI * sg * sg);
    const amp = flux(e) / (e.omega / ARCSEC2_PER_SR * 1e12), off = e.i * N * N;
    for (let r = ra; r < rb; r++) for (let c = ca; c < cb; c++) {
      cube[off + r * N + c] += amp * norm * Math.exp(-0.5 * ((c - col) ** 2 + (r - row) ** 2) / (sg * sg));
    }
  }
  return { ...pkg, cube, cache: new Map() };
}

export function fluxSigma(pkg, exps, xi, eta) {
  let w = 0;
  for (const e of exps) { const f = forcedFlux(pkg, e, xi, eta); if (f && f.err > 0) w += 1 / (f.err * f.err); }
  return w > 0 ? 1 / Math.sqrt(w) : NaN;
}

const AS = 206264.80624709636, D2R = Math.PI / 180;
export function tanProject(ra, dec, ra0, dec0) {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  return [Math.cos(d) * Math.sin(a - a0) / cosc * AS,
    (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc * AS];
}
export function tanDeproject(xi, eta, ra0, dec0) {
  const x = xi / AS, y = eta / AS, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const den = Math.cos(d0) - y * Math.sin(d0);
  const ra = a0 + Math.atan2(x, den);
  const dec = Math.atan2((Math.sin(d0) + y * Math.cos(d0)) * Math.cos(ra - a0), den);
  return [((ra / D2R) % 360 + 360) % 360, dec / D2R];
}
export const mjdToYear = mjd => 2000 + (mjd - 51544.5) / 365.25;

export const earthXYZ = mjd => earthBarycentric(mjd);
export function parallaxFactors(ra, dec, mjd) {
  const a = ra * D2R, d = dec * D2R, [X, Y, Z] = earthXYZ(mjd);
  return [X * Math.sin(a) - Y * Math.cos(a),
    X * Math.cos(a) * Math.sin(d) + Y * Math.sin(a) * Math.sin(d) - Z * Math.cos(d)];
}
export function motionOffset(ast, mjd, withParallax = true) {
  const dt = mjdToYear(mjd) - ast.epoch;
  let dx = ast.pmra * dt, dy = ast.pmdec * dt;
  if (withParallax && ast.plx) {
    const [pa, pd] = parallaxFactors(ast.ra, ast.dec, mjd);
    dx += ast.plx * pa; dy += ast.plx * pd;
  }
  return [dx, dy];
}
export function apparentXiEta(ast, mjd, center, withParallax = true) {
  const [dx, dy] = motionOffset(ast, mjd, withParallax);
  const [ra, dec] = tanDeproject(dx, dy, ast.ra, ast.dec);
  return tanProject(ra, dec, center[0], center[1]);
}

export function parseCoords(text) {
  const t = text.trim().replace(/[,;]/g, ' ');
  const sex = t.match(/^(\d{1,2})[h:\s]\s*(\d{1,2})[m:\s]\s*([\d.]+)s?\s+([+\-−]?\d{1,2})[d°:\s]\s*(\d{1,2})[m':\s]\s*([\d.]+)[s"]?$/i);
  if (sex) {
    const ra = (+sex[1] + +sex[2] / 60 + +sex[3] / 3600) * 15;
    const sign = /^[\-−]/.test(sex[4]) ? -1 : 1;
    const dec = sign * (Math.abs(parseFloat(sex[4].replace('−', '-'))) + +sex[5] / 60 + +sex[6] / 3600);
    return { ra, dec };
  }
  const dec2 = t.match(/^([\d.]+)\s+([+\-−]?[\d.]+)$/);
  if (dec2) return { ra: +dec2[1], dec: parseFloat(dec2[2].replace('−', '-')) };
  return null;
}
export function fmtRA(ra) {
  const h = ra / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${s.toFixed(2).padStart(5, '0')}s`;
}
export function fmtDec(dec) {
  const sg = dec < 0 ? '−' : '+', a = Math.abs(dec), dd = Math.floor(a), m = (a - dd) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${sg}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″`;
}
