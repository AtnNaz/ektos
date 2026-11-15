import * as E from './engine.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, f) => a + (b - a) * f;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = f => { f = clamp(f); return f * f * (3 - 2 * f); };
const hair = v => Math.round(v) + 0.5;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
function shuffled(n, r) { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const K = { deep: '#0A0E18', ink: '#E8ECF4', soft: '#9BA5B8', faint: '#626C82', signal: '#E9B44C', a: '#FF6F5E', b: '#5BB5FF', rule: 'rgba(232,236,244,0.13)', ruleStrong: 'rgba(232,236,244,0.34)' };
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const names = { deep: '--deep', ink: '--ink', soft: '--ink-soft', faint: '--ink-faint', signal: '--signal', a: '--epoch-a', b: '--epoch-b' };
  for (const [k, name] of Object.entries(names)) { const v = cs.getPropertyValue(name).trim(); if (/^#[0-9a-f]{6}$/i.test(v)) K[k] = v; }
  K.rule = rgba(K.ink, 0.13); K.ruleStrong = rgba(K.ink, 0.34);
}
const parsed = new Map();
function rgb(hex) { let c = parsed.get(hex); if (!c) { c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); parsed.set(hex, c); } return c; }
function rgba(hex, a) { const c = rgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${clamp(a).toFixed(3)})`; }

let LANG = 'en';
const caps = s => s.toLocaleUpperCase(LANG);

function surface(canvas) {
  const ctx = canvas.getContext('2d'), s = { canvas, ctx, w: 0, h: 0, u: 1 };
  s.fit = () => {
    const w = Math.max(40, canvas.clientWidth), h = Math.max(40, canvas.clientHeight), dpr = Math.min(3, window.devicePixelRatio || 1);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
    s.w = w; s.h = h; s.u = clamp(w / 470, 0.85, 1.3);
    return s;
  };
  return s;
}
function text(ctx, str, x, y, o = {}) {
  const px = o.px || 11;
  ctx.font = `${o.wt || 400} ${px.toFixed(2)}px "IBM Plex Sans", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${((o.track || 0) * px).toFixed(2)}px`;
  ctx.fillStyle = o.col || K.soft; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
  ctx.fillText(str, x, y);
  return ctx.measureText(str).width;
}
const label = (ctx, str, x, y, o = {}) => text(ctx, caps(str), x, y, { px: 9.5, track: 0.14, col: K.faint, ...o });
function line(ctx, x1, y1, x2, y2, col, lw = 1, dash = null) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function dot(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function ring(ctx, x, y, r, col, lw = 1) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
function blob(ctx, x, y, r, hex, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(hex, a)); g.addColorStop(0.35, rgba(hex, a * 0.55)); g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function box(ctx, x, y, w, h, col) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(hair(x), hair(y), Math.round(w), Math.round(h)); }
function corners(ctx, x, y, w, h, len, col, lw = 1) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.moveTo(cx + sx * len, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * len);
  }
  ctx.stroke(); ctx.restore();
}
function dimension(ctx, x1, y1, x2, y2, col, tick = 4) {
  line(ctx, x1, y1, x2, y2, col);
  const d = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / d * tick, ny = (x2 - x1) / d * tick;
  line(ctx, x1 - nx, y1 - ny, x1 + nx, y1 + ny, col); line(ctx, x2 - nx, y2 - ny, x2 + nx, y2 + ny, col);
}
function notice(ctx, w, h, u, msg) {
  const px = 12.5 * u; ctx.font = `400 ${px.toFixed(2)}px "IBM Plex Sans", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const lines = []; let cur = '';
  for (const word of msg.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > w * 0.8) { lines.push(cur); cur = word; } else cur = next;
  }
  lines.push(cur);
  lines.forEach((ln, i) => text(ctx, ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * px * 1.5, { px, col: K.soft, align: 'center', base: 'middle' }));
}

function heroScene() {
  let S, stars;
  return {
    still: 0,
    init(canvas) {
      S = surface(canvas);
      const r = rng(11);
      stars = Array.from({ length: 170 }, () => ({ x: r(), y: r(), m: Math.pow(r(), 3), ph: r() * TAU, sp: 0.3 + 0.7 * r() }));
    },
    draw(t) {
      const { ctx, w, h } = S.fit();
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) dot(ctx, s.x * w, s.y * h, 0.55 + 1.5 * s.m, rgba(K.ink, (0.14 + 0.7 * s.m) * (0.86 + 0.14 * Math.sin(s.ph + t * s.sp))));
      const cx = w * 0.66, cy = h * 0.5, d = clamp(w * 0.028, 13, 26), k = 0.5 - 0.5 * Math.cos(t * TAU / 6);
      const ax = cx - d / 2, ay = cy + d * 0.12, bx = cx + d / 2, by = cy - d * 0.12;
      blob(ctx, ax, ay, 12, K.a, 0.5 * lerp(1, 0.3, k)); dot(ctx, ax, ay, 3.2, rgba(K.a, lerp(1, 0.4, k)));
      blob(ctx, bx, by, 12, K.b, 0.5 * lerp(0.3, 1, k)); dot(ctx, bx, by, 3.2, rgba(K.b, lerp(0.4, 1, k)));
      corners(ctx, hair(cx - d * 1.5), hair(cy - d * 1.1), Math.round(d * 3), Math.round(d * 2.2), 6, K.signal);
      text(ctx, 'A', cx - d * 1.5, cy + d * 1.1 + 15, { px: 11, wt: 500, col: K.a });
      text(ctx, 'B', cx + d * 1.5, cy + d * 1.1 + 15, { px: 11, wt: 500, col: K.b, align: 'right' });
    },
  };
}

function lvfScene() {
  let S;
  const N = 12, STEP = 1.0, HOLD = 3;
  const frac = k => 0.05 + 0.9 * k / (N - 1), lamOf = f => 0.75 + 4.25 * f;
  return {
    still: STEP * N + 1,
    init(canvas) { S = surface(canvas); },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, tt = t % (STEP * N + HOLD), done = tt >= STEP * N, k = done ? N - 1 : Math.floor(tt / STEP);
      const f = done ? frac(k) : lerp(frac(Math.max(0, k - 1)), frac(k), ease(seg(tt - k * STEP, 0, 0.38)));
      const sx = w * 0.5, sy = h * 0.37, sw = w * 0.5, sh = h * 0.23, x0 = sx - f * sw, y0 = sy - sh / 2;
      label(ctx, 'linear variable filter', m, m + 8 * u, { px: 9.5 * u });
      label(ctx, `${'exposure'} ${String(k + 1).padStart(2, '0')} / ${N}`, w - m, m + 8 * u, { px: 9.5 * u, align: 'right', col: K.soft });
      const gap = 3 * u, cw = (sw - 5 * gap) / 102;
      for (let i = 0; i < 102; i++) {
        ctx.fillStyle = rgba(K.ink, 0.05 + 0.36 * i / 101);
        ctx.fillRect(x0 + i * cw + Math.floor(i / 17) * gap, y0, Math.max(0.6, cw - 0.7), sh);
      }
      box(ctx, x0 - 4, y0 - 4, sw + 8, sh + 8, K.ruleStrong);
      text(ctx, '0.75 µm', x0 - 4, y0 - 11 * u, { px: 10.5 * u, col: K.faint });
      text(ctx, '5.0 µm', x0 + sw + 4, y0 - 11 * u, { px: 10.5 * u, col: K.faint, align: 'right' });
      const ax0 = m + 6 * u, ax1 = w - m - 16 * u, ay = h * 0.8, X = lam => ax0 + (lam - 0.75) / 4.25 * (ax1 - ax0);
      line(ctx, ax0, hair(ay), ax1, hair(ay), K.ruleStrong);
      for (const v of [1, 2, 3, 4, 5]) {
        line(ctx, hair(X(v)), ay, hair(X(v)), ay + 4 * u, K.ruleStrong);
        text(ctx, v === 5 ? '5 µm' : String(v), X(v), ay + 16 * u, { px: 10 * u, col: K.faint, align: 'center' });
      }
      for (let j = 0; j < k; j++) line(ctx, hair(X(lamOf(frac(j)))), ay - 9 * u, hair(X(lamOf(frac(j)))), ay, rgba(K.ink, 0.8));
      const lam = lamOf(f), lx = X(lam);
      line(ctx, sx, y0 + sh + 10 * u, lx, ay - 33 * u, rgba(K.signal, 0.4));
      line(ctx, hair(lx), ay - 13 * u, hair(lx), ay, K.signal, 1.5);
      text(ctx, `λ = ${lam.toFixed(2)} µm`, clamp(lx, ax0 + 36 * u, ax1 - 30 * u), ay - 19 * u, { px: 11.5 * u, col: K.signal, align: 'center' });
      label(ctx, 'wavelengths where this point was seen', ax0, h - m * 0.55, { px: 9 * u });
      line(ctx, hair(sx), y0 - 4, hair(sx), y0 + sh + 10 * u, rgba(K.signal, 0.6));
      blob(ctx, sx, sy, 11 * u, K.ink, 0.55); dot(ctx, sx, sy, 2.6 * u, K.ink);
    },
  };
}

function bytesScene() {
  let S;
  const PER = 12, NEXP = 358, KB = 0.080, CUT = 3.95;
  const rows = Array.from({ length: 11 }, (_, i) => 0.33 + i * 0.011);
  return {
    still: 9,
    init(canvas) { S = surface(canvas); },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, x0 = m, x1 = w - m, bw = x1 - x0, tt = t % PER;
      label(ctx, 'one file in the archive', x0, m + 8 * u, { px: 9.5 * u });
      text(ctx, '66 MB', x1, m + 8 * u, { px: 11 * u, col: K.soft, align: 'right' });
      const by = m + 18 * u, bh = 24 * u;
      ctx.fillStyle = rgba(K.ink, 0.045); ctx.fillRect(x0, by, bw, bh);
      box(ctx, x0, by, bw, bh, K.ruleStrong);
      const head = (tt % 2.4) / 2.4 * 1.2, lit = f => (head >= f ? clamp(1 - (head - f) / 0.7, 0.5, 1) : 0.5);
      ctx.fillStyle = rgba(K.signal, lit(0)); ctx.fillRect(x0 + 1, by + 1, Math.max(2, bw * 0.012), bh - 1);
      for (const f of rows) { ctx.fillStyle = rgba(K.signal, lit(f)); ctx.fillRect(x0 + bw * f, by + 1, Math.max(1, bw * 0.0042), bh - 1); }
      if (head <= 1) line(ctx, hair(x0 + bw * head), by - 5 * u, hair(x0 + bw * head), by + bh + 5 * u, K.signal);
      label(ctx, 'header', x0, by + bh + 15 * u, { px: 9 * u, col: K.signal });
      label(ctx, 'pixel rows', x0 + bw * 0.33, by + bh + 15 * u, { px: 9 * u, col: K.signal });
      if (w > 420) label(ctx, 'the rest is never read', x1, by + bh + 15 * u, { px: 9 * u, align: 'right' });
      const n = Math.round(NEXP * seg(tt, 1, 8)), mbE = n * KB, mbC = n * CUT, full = NEXP * CUT;
      const nw = text(ctx, String(n), x0, h * 0.47, { px: 30 * u, wt: 300, col: K.ink });
      label(ctx, 'exposures', x0 + nw + 9 * u, h * 0.47, { px: 9.5 * u });
      const row = (y, name, per, value, frac, col) => {
        const lw = label(ctx, name, x0, y, { px: 9.5 * u, col: K.soft });
        text(ctx, per, x0 + lw + 12 * u, y, { px: 10 * u, col: K.faint });
        text(ctx, value, x1, y, { px: 14 * u, col: K.ink, align: 'right' });
        line(ctx, x0, hair(y + 10 * u), x1, hair(y + 10 * u), K.rule);
        if (frac > 0) { ctx.fillStyle = col; ctx.fillRect(x0, y + 8 * u, Math.max(1.5, bw * frac), 4 * u); }
      };
      const perE = `≈ 80 kB / ${'exposure'}`, perC = `3.95 MB / ${'cutout'}`;
      row(h * 0.64, 'Ektos', perE, `≈ ${Math.round(mbE)} MB`, mbE / full, K.signal);
      row(h * 0.84, 'cutout service', perC, mbC < 1000 ? `≈ ${Math.round(mbC)} MB` : `≈ ${(mbC / 1000).toFixed(1)} GB`, mbC / full, rgba(K.ink, 0.6));
    },
  };
}

function stackScene() {
  let S, tiles, means, noise, pose;
  const NT = 12, R = 26, FLY = 0.8, HOLD = 3.2;
  const SRC = [[8.3, 7.1, 6.5], [18.6, 10.4, 3.4], [6.2, 19.3, 2.4], [16.6, 18.8, 1.05]];
  const paint = img => {
    const c = document.createElement('canvas'); c.width = c.height = R;
    const x = c.getContext('2d'), id = x.createImageData(R, R), ink = rgb(K.ink);
    for (let p = 0; p < R * R; p++) {
      const g = Math.pow(clamp((img[p] + 1) / 7.5), 0.9);
      for (let j = 0; j < 3; j++) id.data[4 * p + j] = ink[j] * g;
      id.data[4 * p + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    return c;
  };
  return {
    still: NT * FLY + 1,
    init(canvas) {
      S = surface(canvas);
      const r = rng(5), sky = new Float32Array(R * R), far = [];
      for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
        let v = 0, near = false;
        for (const [sx, sy, a] of SRC) { const d2 = (x - sx) ** 2 + (y - sy) ** 2; v += a * Math.exp(-0.5 * d2 / 1.1); if (d2 < 16) near = true; }
        sky[y * R + x] = v; if (!near) far.push(y * R + x);
      }
      const sum = new Float32Array(R * R);
      tiles = []; means = []; noise = []; pose = [];
      for (let k = 0; k < NT; k++) {
        const one = new Float32Array(R * R), mean = new Float32Array(R * R);
        for (let p = 0; p < R * R; p++) { one[p] = sky[p] + gauss(r); sum[p] += one[p]; mean[p] = sum[p] / (k + 1); }
        let s2 = 0; for (const p of far) s2 += mean[p] * mean[p];
        tiles.push(paint(one)); means.push(paint(mean)); noise.push(Math.sqrt(s2 / far.length));
        pose.push({ y: 0.26 + 0.48 * r(), rot: (r() - 0.5) * 1.2 });
      }
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, tt = t % (NT * FLY + HOLD), flying = tt < NT * FLY, k = flying ? Math.floor(tt / FLY) : NT, p = flying ? (tt - k * FLY) / FLY : 0;
      const g = Math.min(h * 0.6, w * 0.36), gx = w * 0.23, gy = (h - g) / 2 + 4 * u, merge = flying ? ease(seg(p, 0.78, 1)) : 0;
      label(ctx, 'exposures of one visit', m, m + 8 * u, { px: 9.5 * u });
      ctx.imageSmoothingEnabled = false;
      if (k > 0) ctx.drawImage(means[k - 1], gx, gy, g, g);
      if (flying && merge > 0) { ctx.globalAlpha = merge; ctx.drawImage(means[k], gx, gy, g, g); ctx.globalAlpha = 1; }
      box(ctx, gx, gy, g, g, K.ruleStrong);
      for (let i = 1; i < 4; i++) { const q = g * i / 4; line(ctx, hair(gx + q), gy, hair(gx + q), gy + 4 * u, K.ruleStrong); line(ctx, gx, hair(gy + q), gx + 4 * u, hair(gy + q), K.ruleStrong); }
      label(ctx, 'common grid', gx, gy + g + 15 * u, { px: 9 * u });
      const nx = gx + g + 13 * u;
      line(ctx, hair(nx), gy + 26 * u, hair(nx), gy + 10 * u, K.soft); line(ctx, nx - 3 * u, gy + 14 * u, nx + 0.5, gy + 10 * u, K.soft); line(ctx, nx + 3 * u + 1, gy + 14 * u, nx + 0.5, gy + 10 * u, K.soft);
      text(ctx, 'N', nx + 0.5, gy + 5 * u, { px: 9.5 * u, col: K.soft, align: 'center' });
      if (flying) {
        const q = ease(seg(p, 0, 0.8)), cx = lerp(w * 0.1, gx + g / 2, q), cy = lerp(h * pose[k].y, gy + g / 2, q), sz = lerp(g * 0.55, g, q);
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(pose[k].rot * (1 - q));
        ctx.globalAlpha = seg(p, 0, 0.15) * (1 - merge) * 0.92; ctx.drawImage(tiles[k], -sz / 2, -sz / 2, sz, sz);
        ctx.globalAlpha = seg(p, 0, 0.15) * (1 - merge); box(ctx, -sz / 2, -sz / 2, sz, sz, K.signal);
        ctx.restore();
      }
      ctx.imageSmoothingEnabled = true;
      const px0 = gx + g + 38 * u, px1 = w - m - 4 * u, py0 = gy + 12 * u, py1 = gy + g - 4 * u, shown = k + (flying && merge >= 1 ? 1 : 0);
      label(ctx, 'noise', px0, py0 - 10 * u, { px: 9 * u });
      line(ctx, hair(px0), py0, hair(px0), py1, K.ruleStrong); line(ctx, px0, hair(py1), px1, hair(py1), K.ruleStrong);
      const PX = i => lerp(px0 + 8 * u, px1 - 4 * u, i / (NT - 1)), PY = i => lerp(py1 - 3 * u, py0 + 4 * u, noise[i] / noise[0]);
      ctx.strokeStyle = K.ruleStrong; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < shown; i++) (i ? ctx.lineTo(PX(i), PY(i)) : ctx.moveTo(PX(i), PY(i)));
      ctx.stroke();
      for (let i = 0; i < shown; i++) { const q = 2.2 * u; ctx.fillStyle = i === shown - 1 ? K.signal : K.ink; ctx.fillRect(PX(i) - q, PY(i) - q, 2 * q, 2 * q); }
      text(ctx, '1', PX(0), py1 + 14 * u, { px: 10 * u, col: K.faint, align: 'center' });
      text(ctx, String(NT), PX(NT - 1), py1 + 14 * u, { px: 10 * u, col: K.faint, align: 'center' });
      label(ctx, 'exposures', (PX(0) + PX(NT - 1)) / 2, py1 + 14 * u, { px: 9 * u, align: 'center' });
      if (shown > 0) text(ctx, `N = ${shown}`, px1, py0 - 10 * u, { px: 11 * u, col: K.soft, align: 'right' });
    },
  };
}

function limits(frames) {
  let sig = 0, hi = 0;
  const meds = frames.map(f => { const s = E.robustStats(f.img); sig = Math.max(sig, s.sig); hi = Math.max(hi, s.hi - s.med); return s.med; });
  return { meds, lo: -2.5 * sig, hi: Math.max(hi, 14 * sig), sig };
}
const stretch = (v, lo, hi) => { const x = clamp((v - lo) / (hi - lo)); return Math.asinh(x / 0.08) / Math.asinh(1 / 0.08); };
function grayCanvas(fr, med, lim, n) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d'), id = ctx.createImageData(n, n);
  for (let p = 0; p < n * n; p++) {
    const v = fr.img[p], g = v === v ? 255 * stretch(v - med, lim.lo, lim.hi) : 30, o = p * 4;
    id.data[o] = id.data[o + 1] = id.data[o + 2] = g; id.data[o + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
function diffCanvas(fa, fb, lim, n) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d'), id = ctx.createImageData(n, n), bg = rgb(K.deep), colA = rgb(K.a), colB = rgb(K.b), scale = 9 * lim.sig;
  for (let p = 0; p < n * n; p++) {
    const d = (fb.img[p] - lim.meds[1]) - (fa.img[p] - lim.meds[0]), o = p * 4;
    id.data[o + 3] = 255;
    if (d !== d) { id.data[o] = id.data[o + 1] = id.data[o + 2] = 30; continue; }
    const col = d > 0 ? colB : colA, k = Math.pow(Math.min(1, Math.abs(d) / scale), 0.8);
    for (let j = 0; j < 3; j++) id.data[o + j] = bg[j] + (col[j] - bg[j]) * k;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

const LOUPE = 29;
let luhman = null;
function loadLuhman() {
  if (luhman) return luhman;
  luhman = (async () => {
    const pkg = await E.loadPackage('luhman16'), man = pkg.man;
    const grid = E.makeGrid(man.grid.n, man.grid.scale), n = grid.n, lam = [1.61, 2.44];
    const va = 0, vb = man.visits.length - 1;
    if (vb <= va) throw new Error('the package has a single visit');
    const fa = E.frame(pkg, grid, va, lam), fb = E.frame(pkg, grid, vb, lam);
    if (!fa.used || !fb.used) throw new Error('no exposures in the window');
    const lim = limits([fa, fb]);
    let tgt = null;
    if (man.astrometry) {
      const pa = E.apparentXiEta(man.astrometry, man.visits[va].mjd, man.center), pb = E.apparentXiEta(man.astrometry, man.visits[vb].mjd, man.center);
      const c = grid.col((pa[0] + pb[0]) / 2), r = grid.row((pa[1] + pb[1]) / 2);
      if (c > 2 && r > 2 && c < n - 3 && r < n - 3) tgt = { c, r };
    }
    const cs = Math.min(LOUPE, n), mid = tgt || { c: grid.c, r: grid.c };
    const crop = { cs, c0: clamp(Math.round(mid.c - (cs - 1) / 2), 0, n - cs), r0: clamp(Math.round(mid.r - (cs - 1) / 2), 0, n - cs) };
    return {
      n, scale: grid.scale, name: man.name, tgt, crop,
      A: grayCanvas(fa, lim.meds[0], lim, n), B: grayCanvas(fb, lim.meds[1], lim, n), D: diffCanvas(fa, fb, lim, n),
      ya: man.visits[va].year.toFixed(2), yb: man.visits[vb].year.toFixed(2), na: fa.used, nb: fb.used,
    };
  })();
  luhman.catch(err => console.warn('how: Luhman 16 frames are not available:', (err && err.message) || err));
  return luhman;
}
function platePair(ctx, w, h, u, D, img) {
  const m = 16 * u, gap = 26 * u, top = m + 22 * u, bot = 26 * u;
  const p = Math.floor(Math.min(h - top - bot, (w - 2 * m - gap) / 2)), x1 = Math.round((w - 2 * p - gap) / 2), x2 = Math.round(x1 + p + gap), y = Math.round(top);
  const { c0, r0, cs } = D.crop, f = p / D.n, z = p / cs;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x1, y, p, p);
  ctx.drawImage(img, c0, r0, cs, cs, x2, y, p, p);
  box(ctx, x1, y, p, p, K.ruleStrong); box(ctx, x2, y, p, p, K.ruleStrong);
  const rx = x1 + c0 * f, ry = y + r0 * f, rs = cs * f;
  box(ctx, rx, ry, rs, rs, K.signal);
  line(ctx, rx + rs, ry, x2, y, rgba(K.signal, 0.35)); line(ctx, rx + rs, ry + rs, x2, y + p, rgba(K.signal, 0.35));
  if (D.tgt) {
    const tx = x2 + (D.tgt.c + 0.5 - c0) * z, ty = y + (D.tgt.r + 0.5 - r0) * z, hb = 4.6 * z;
    corners(ctx, tx - hb, ty - hb, 2 * hb, 2 * hb, hb * 0.42, K.signal, 1.2);
  }
  const bar = 10 / D.scale * z, sy = y + p - 10 * u;
  dimension(ctx, x2 + 9 * u, sy, x2 + 9 * u + bar, sy, K.ink, 3);
  text(ctx, '10″', x2 + 9 * u + bar / 2, sy - 6 * u, { px: 10 * u, col: K.ink, align: 'center' });
  const fov = D.n * D.scale / 60;
  const lw = label(ctx, `${fov.toFixed(0)}′ ${'plate'}`, x1, y + p + 15 * u, { px: 9 * u });
  text(ctx, '· 1.61–2.44 µm', x1 + lw + 5 * u, y + p + 15 * u, { px: 9.5 * u, col: K.faint });
  label(ctx, `${'zoom'} · ${Math.round(cs * D.scale)}″`, x2, y + p + 15 * u, { px: 9 * u });
  return { x1, x2, y, p, ty: m + 10 * u };
}
const LOADING = () => 'Loading the real frames…';
const FAILED = () => 'Could not load the Luhman 16 package; this step needs real data.';
function realScene(still, body) {
  let S, D = null, state = 'loading';
  return {
    still,
    init(canvas) { S = surface(canvas); canvas.dataset.state = state; },
    wake() {
      return loadLuhman().then(d => { D = d; state = 'real'; }, () => { state = 'failed'; }).then(() => { S.canvas.dataset.state = state; });
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      if (!D) { notice(ctx, w, h, u, state === 'failed' ? FAILED() : LOADING()); return; }
      body(ctx, w, h, u, D, t);
    },
  };
}
const blinkScene = () => realScene(1.2, (ctx, w, h, u, D, t) => {
  const isB = Math.floor(t / 0.8) % 2 === 1, g = platePair(ctx, w, h, u, D, isB ? D.B : D.A);
  text(ctx, isB ? `B · ${D.yb}` : `A · ${D.ya}`, g.x1, g.ty, { px: 13 * u, wt: 500, col: isB ? K.b : K.a });
  text(ctx, `${D.name} · ${isB ? D.nb : D.na} ${'exposures'}`, g.x2 + g.p, g.ty, { px: 10.5 * u, col: K.faint, align: 'right' });
});
const diffScene = () => realScene(3.5, (ctx, w, h, u, D, t) => {
  const tt = t % 6.4, phase = tt < 1.1 ? 0 : tt < 2.2 ? 1 : 2, g = platePair(ctx, w, h, u, D, [D.A, D.B, D.D][phase]);
  text(ctx, ['A', 'B', 'B − A'][phase], g.x1, g.ty, { px: 13 * u, wt: 500, col: [K.a, K.b, K.ink][phase] });
  if (phase < 2) { text(ctx, phase ? D.yb : D.ya, g.x2 + g.p, g.ty, { px: 10.5 * u, col: K.faint, align: 'right' }); return; }
  const q = 6 * u, yb = g.ty - q;
  const wb = text(ctx, 'only in B', g.x2 + g.p, g.ty, { px: 10.5 * u, col: K.soft, align: 'right' });
  ctx.fillStyle = K.b; ctx.fillRect(g.x2 + g.p - wb - q - 5 * u, yb, q, q);
  const xa = g.x2 + g.p - wb - q - 20 * u, wa = text(ctx, 'only in A', xa, g.ty, { px: 10.5 * u, col: K.soft, align: 'right' });
  ctx.fillStyle = K.a; ctx.fillRect(xa - wa - q - 5 * u, yb, q, q);
});

function stereoScene() {
  let S;
  const PER = 16;
  const disparity = tt => {
    if (tt < 1) return 0;
    if (tt < 5.5) return 0.5 * Math.sin(Math.PI * seg(tt, 1, 5.5));
    if (tt < 10) return -0.34 * Math.sin(Math.PI * seg(tt, 5.5, 10));
    return -1.3 * ease(seg(tt, 10.4, 11.8)) * (1 - ease(seg(tt, 14, 15.2)));
  };
  return {
    still: 3.2,
    init(canvas) { S = surface(canvas); },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, tt = t % PER, yp = h * 0.42, ye = h * 0.87, cx = w * 0.47, e = w * 0.13, xl = cx - e / 2, xr = cx + e / 2;
      const xs = w * 0.2, xm = w * 0.72, d = disparity(tt) * e, xA = xm + d / 2, xB = xm - d / 2;
      label(ctx, 'seen from above', m, m + 8 * u, { px: 9.5 * u });
      line(ctx, w * 0.06, hair(yp), w * 0.94, hair(yp), K.ruleStrong);
      label(ctx, 'plate', w * 0.06, yp + 15 * u, { px: 9 * u });
      line(ctx, xl, ye, xs, yp, rgba(K.a, 0.4)); line(ctx, xr, ye, xs, yp, rgba(K.b, 0.4));
      dot(ctx, xs, yp, 2.8 * u, K.ink);
      text(ctx, 'fixed star: on the plate', xs, yp - 12 * u, { px: 10.5 * u, col: K.soft, align: 'center' });
      line(ctx, xl, ye, xA, yp, K.a, 1.3); line(ctx, xr, ye, xB, yp, K.b, 1.3);
      const den = e + d, top = h * 0.17;
      if (den > 0.05 * e) {
        const s = e / den, ix = xl + s * (xA - xl), iy = ye + s * (yp - ye);
        if (s > 1) { line(ctx, xA, yp, ix, iy, rgba(K.a, 0.7), 1, [3, 3]); line(ctx, xB, yp, ix, iy, rgba(K.b, 0.7), 1, [3, 3]); }
        dot(ctx, ix, iy, 3.4 * u, K.signal); ring(ctx, ix, iy, 7.5 * u, rgba(K.signal, 0.6));
        const where = s < 0.985 ? 'in front' : s > 1.015 ? 'behind' : 'on the plate';
        text(ctx, where, ix + 13 * u, iy + 4 * u, { px: 11.5 * u, col: K.signal });
      } else {
        const s2 = (ye - top) / (ye - yp);
        line(ctx, xA, yp, xl + s2 * (xA - xl), top, rgba(K.a, 0.7), 1, [3, 3]); line(ctx, xB, yp, xr + s2 * (xB - xr), top, rgba(K.b, 0.7), 1, [3, 3]);
        text(ctx, 'no merging: a double image', w - m, m + 8 * u, { px: 11 * u, col: K.soft, align: 'right' });
      }
      if (Math.abs(d) < 0.012 * e) dot(ctx, xm, yp, 2.8 * u, K.ink);
      else { dot(ctx, xA, yp, 3 * u, K.a); dot(ctx, xB, yp, 3 * u, K.b); }
      for (const [x, col] of [[xl, K.a], [xr, K.b]]) { ctx.fillStyle = K.deep; ctx.beginPath(); ctx.arc(x, ye, 6.5 * u, 0, TAU); ctx.fill(); ring(ctx, x, ye, 6.5 * u, K.soft); dot(ctx, x, ye, 2.2 * u, col); }
      text(ctx, 'left eye · A', xl - 13 * u, ye + 4 * u, { px: 11 * u, col: K.a, align: 'right' });
      text(ctx, 'right eye · B', xr + 13 * u, ye + 4 * u, { px: 11 * u, col: K.b });
    },
  };
}

function coldScene() {
  let S, stars;
  const PER = 10, KCOL = 0.62;
  const cold = { x: 0.6, y: 0.44 };
  return {
    still: 7.5,
    init(canvas) {
      S = surface(canvas);
      const r = rng(21);
      stars = [{ x: 0.7, y: 0.53, b: 0.85 }];
      while (stars.length < 9) { const s = { x: 0.1 + 0.8 * r(), y: 0.1 + 0.8 * r(), b: 0.35 + 0.65 * r() }; if (Math.hypot(s.x - cold.x, s.y - cold.y) > 0.24) stars.push(s); }
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, opw = 36 * u, top = m + 24 * u, tt = t % PER, ramp = ease(seg(tt, 1.6, 5.2));
      const p = Math.floor(Math.min((w - 2 * m - 2 * opw) / 3, h - top - m - 26 * u)), x0 = (w - 3 * p - 2 * opw) / 2, y = top + (h - top - m - 26 * u - p) / 2;
      const panel = (i, starA, coldA, name, band) => {
        const x = x0 + i * (p + opw);
        ctx.fillStyle = rgba(K.ink, 0.03); ctx.fillRect(x, y, p, p);
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, p, p); ctx.clip();
        for (const s of stars) if (starA * s.b > 0.012) blob(ctx, x + s.x * p, y + s.y * p, (0.07 + 0.05 * s.b) * p, K.ink, starA * s.b);
        if (coldA > 0.012) blob(ctx, x + cold.x * p, y + cold.y * p, 0.105 * p, K.ink, coldA);
        ctx.restore();
        box(ctx, x, y, p, p, K.ruleStrong);
        const nw = text(ctx, name, x, y - 9 * u, { px: 12 * u, wt: 500, col: K.ink });
        if (band) text(ctx, band, x + nw + 7 * u, y - 9 * u, { px: 10 * u, col: K.faint });
        return x;
      };
      panel(0, KCOL, 0.9, 'W2s', '4.0–5.0 µm');
      const xm = panel(1, 1, 0, 'W1s', '3.0–3.8 µm');
      const xr = panel(2, KCOL * (1 - ramp), 0.9, 'R', '');
      text(ctx, '− k ·', x0 + p + opw / 2, y + p / 2, { px: 15 * u, wt: 300, col: K.ink, align: 'center', base: 'middle' });
      text(ctx, '=', x0 + 2 * p + 1.5 * opw, y + p / 2, { px: 17 * u, wt: 300, col: K.ink, align: 'center', base: 'middle' });
      const ky = y + p + 12 * u;
      line(ctx, xm, hair(ky), xm + p, hair(ky), K.rule);
      line(ctx, hair(xm + p * ramp), ky - 4 * u, hair(xm + p * ramp), ky + 4 * u, K.signal, 1.5);
      text(ctx, 'k: median ratio of the field stars', xm + p / 2, ky + 16 * u, { px: 10 * u, col: K.faint, align: 'center' });
      const a = seg(tt, 5.3, 5.9);
      if (a > 0) {
        const cx = xr + cold.x * p, cy = y + cold.y * p, hb = 0.13 * p;
        ctx.globalAlpha = a;
        corners(ctx, cx - hb, cy - hb, 2 * hb, 2 * hb, hb * 0.45, K.signal, 1.2);
        label(ctx, 'cold object', cx, cy + hb + 13 * u, { px: 9 * u, col: K.signal, align: 'center' });
        ctx.globalAlpha = 1;
      }
    },
  };
}

function wiseScene() {
  let S, stars;
  const PER = 11.5, Y0 = 2010.6, Y1 = 2026.33;
  return {
    still: 9.5,
    init(canvas) {
      S = surface(canvas);
      const r = rng(33);
      stars = Array.from({ length: 34 }, () => ({ x: 0.03 + 0.94 * r(), y: 0.06 + 0.88 * r(), m: Math.pow(r(), 2.4) }));
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, x0 = m, x1 = w - m, pw = x1 - x0, y0 = h * 0.3, y1 = h * 0.77, tt = t % PER, f = seg(tt, 0.8, 7.6), here = f >= 1;
      box(ctx, x0, y0, pw, y1 - y0, K.rule);
      for (const s of stars) dot(ctx, x0 + s.x * pw, y0 + s.y * (y1 - y0), 0.6 + 1.3 * s.m, rgba(K.ink, 0.16 + 0.5 * s.m));
      const ax = x0 + pw * 0.11, bx = x1 - pw * 0.11, yc = (y0 + y1) / 2, rise = (bx - ax) * 0.042, ay = yc + rise, by = yc - rise;
      const px = lerp(ax, bx, f), py = lerp(ay, by, f);
      line(ctx, ax, ay, bx, by, K.ruleStrong, 1, [2, 4]);
      line(ctx, ax, ay, px, py, rgba(K.signal, 0.85), 1.2);
      blob(ctx, ax, ay, 11 * u, K.a, 0.45); dot(ctx, ax, ay, 3.6 * u, K.a);
      text(ctx, '2010 · WISE', ax, ay + 21 * u, { px: 11 * u, col: K.a, align: 'center' });
      if (here) { blob(ctx, bx, by, 11 * u, K.b, 0.45); dot(ctx, bx, by, 3.6 * u, K.b); } else { ring(ctx, bx, by, 3.6 * u, rgba(K.b, 0.55)); dot(ctx, px, py, 3.2 * u, K.signal); }
      text(ctx, '2026 · SPHEREx', bx, by - 14 * u, { px: 11 * u, col: here ? K.b : rgba(K.b, 0.55), align: 'center' });
      const qx = x1 - 14 * u, qy = y1 - 12 * u;
      line(ctx, hair(qx), qy, hair(qx), qy - 13 * u, K.soft); line(ctx, qx, hair(qy), qx - 13 * u, hair(qy), K.soft);
      text(ctx, 'N', qx + 0.5, qy - 17 * u, { px: 9 * u, col: K.soft, align: 'center' });
      text(ctx, 'E', qx - 17 * u, qy + 3 * u, { px: 9 * u, col: K.soft, align: 'right' });
      const ry = y1 + 13 * u, YX = yr => lerp(ax, bx, (yr - Y0) / (Y1 - Y0));
      line(ctx, ax, hair(ry), bx, hair(ry), K.ruleStrong);
      for (let yr = 2011; yr <= 2026; yr++) {
        const big = yr % 4 === 0;
        line(ctx, hair(YX(yr)), ry, hair(YX(yr)), ry + (big ? 7 : 4) * u, K.ruleStrong);
        if (big) text(ctx, String(yr), YX(yr), ry + 20 * u, { px: 10 * u, col: K.faint, align: 'center' });
      }
      line(ctx, hair(px), ry - 5 * u, hair(px), ry + 7 * u, K.signal, 1.5);
      text(ctx, String(Math.floor(lerp(Y0, Y1, f))), x0, m + 27 * u, { px: 30 * u, wt: 300, col: K.ink });
      const a = seg(tt, 7.7, 8.3);
      if (a > 0) {
        ctx.globalAlpha = a;
        dimension(ctx, ax, y0 + 17 * u, bx, y0 + 17 * u, K.soft, 4);
        text(ctx, '129.5 ± 0.3″', (ax + bx) / 2, y0 + 11 * u, { px: 12 * u, col: K.ink, align: 'center' });
        text(ctx, `8.23″ / ${'yr'}`, x1, m + 27 * u, { px: 15 * u, wt: 300, col: K.ink, align: 'right' });
        label(ctx, 'measured', x1, m + 8 * u, { px: 9 * u, align: 'right' });
        ctx.globalAlpha = 1;
      }
    },
  };
}

function parallaxScene() {
  let S;
  const PER = 13, YEARS = 3;
  return {
    still: 11,
    init(canvas) { S = surface(canvas); },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, xs = m + 8 * u, xe = w - m - 8 * u, tt = t % PER, yrs = YEARS * seg(tt, 0.6, 9.6);
      const ax = w * 0.016, by = h * 0.105;
      const base = tau => [lerp(xs, xe, tau / YEARS), lerp(h * 0.71, h * 0.55, tau / YEARS)];
      const pos = tau => { const [x, y] = base(tau), th = TAU * tau; return [x - ax * Math.cos(th), y - by * Math.sin(th)]; };
      label(ctx, 'the path on the sky', m, m + 8 * u, { px: 9.5 * u });
      const [b0x, b0y] = base(0), [b3x, b3y] = base(YEARS);
      line(ctx, b0x, b0y, b3x, b3y, K.ruleStrong, 1, [2, 4]);
      for (let k = 0; k <= YEARS; k++) { const [x, y] = base(k); line(ctx, hair(x), y - 4 * u, hair(x), y + 4 * u, K.ruleStrong); }
      const [c1x, c1y] = base(1);
      dimension(ctx, b0x, b0y + by + 14 * u, c1x, c1y + by + 14 * u, K.faint, 3);
      text(ctx, '1 year', (b0x + c1x) / 2, (b0y + c1y) / 2 + by + 28 * u, { px: 10 * u, col: K.faint, align: 'center' });
      text(ctx, 'straight motion', b3x, b3y - 10 * u, { px: 10 * u, col: K.faint, align: 'right' });
      ctx.strokeStyle = K.ink; ctx.lineWidth = 1.3; ctx.beginPath();
      for (let tau = 0; tau <= yrs + 1e-6; tau += 0.01) { const [x, y] = pos(tau); (tau ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); }
      ctx.stroke();
      const [px, py] = pos(yrs);
      dot(ctx, px, py, 3.3 * u, K.signal);
      if (yrs > 0.25) {
        const [qx, qy] = base(0.25), [rx, ry] = pos(0.25), a = seg(yrs, 0.25, 0.45);
        ctx.globalAlpha = a;
        dimension(ctx, qx, qy, rx, ry, K.soft, 3);
        text(ctx, 'parallax', rx, ry - 9 * u, { px: 10.5 * u, col: K.soft, align: 'center' });
        ctx.globalAlpha = 1;
      }
      const ex = w - m - 44 * u, ey = m + 30 * u, erx = 32 * u, ery = 11 * u, th = TAU * yrs;
      ctx.strokeStyle = K.ruleStrong; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(ex, ey, erx, ery, 0, 0, TAU); ctx.stroke();
      ring(ctx, ex, ey, 3 * u, K.soft); dot(ctx, ex + erx * Math.cos(th), ey + ery * Math.sin(th), 2.4 * u, K.ink);
      label(ctx, 'Earth, one turn a year', w - m, ey + ery + 16 * u, { px: 9 * u, align: 'right' });
      const a = seg(tt, 9.8, 10.4);
      if (a > 0) {
        ctx.globalAlpha = a;
        text(ctx, '0.502 ± 0.038″', xe, h - m - 18 * u, { px: 13 * u, col: K.ink, align: 'right' });
        text(ctx, '≈ 2.0 pc', xe, h - m, { px: 13 * u, col: K.ink, align: 'right' });
        label(ctx, 'WISE 0855', xe - 106 * u, h - m - 18 * u, { px: 9 * u, align: 'right' });
        ctx.globalAlpha = 1;
      }
    },
  };
}

async function loadControls() {
  const out = [];
  for (const [slug, name] of [['wise0855', 'WISE 0855'], ['smdet1', 'SMDET-1']]) {
    const res = await fetch(`data/${slug}/candidate.json`);
    if (!res.ok) throw new Error(`${slug}: ${res.status}`);
    const cd = await res.json(), c = cd.colour_excess.bands['4.4-5.0'].c;
    const val = bins => (bins['4.4-5.0'] && bins['2.4-3.8'] ? bins['4.4-5.0'].flux - c * bins['2.4-3.8'].flux : NaN);
    const ctrl = cd.random.map(r => val(r.bins)).filter(v => v === v), tgt = val(cd.bins);
    if (ctrl.length < 10 || tgt !== tgt) throw new Error(`${slug}: no controls`);
    const sorted = [...ctrl].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
    const dev = sorted.map(v => Math.abs(v - med)).sort((a, b) => a - b), sig = 1.4826 * dev[dev.length >> 1] || 1;
    out.push({ name, z: ctrl.map(v => (v - med) / sig), zt: (tgt - med) / sig, n: ctrl.length, reach: ctrl.filter(v => v >= tgt).length });
  }
  return out;
}
function controlsScene() {
  let S, rows = null, state = 'loading', order = [];
  const PER = 11, Z0 = -7, Z1 = 25;
  return {
    still: 9,
    init(canvas) { S = surface(canvas); canvas.dataset.state = state; },
    wake() {
      return loadControls().then(r => { rows = r; state = 'real'; const q = rng(3); order = r.map(row => row.z.map(() => q())); },
        err => { state = 'failed'; console.warn('how: control measurements are not available:', err && err.message || err); })
        .then(() => { S.canvas.dataset.state = state; });
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      if (!rows) { notice(ctx, w, h, u, state === 'failed' ? 'The control measurements could not be loaded; the numbers are in the table.' : 'Loading the control measurements…'); return; }
      const m = 18 * u, x0 = m, x1 = w - m, tt = t % PER, H = (h - m - 40 * u) / 2, X = z => x0 + (clamp(z, Z0, Z1) - Z0) / (Z1 - Z0) * (x1 - x0);
      const shown = seg(tt, 0.5, 3.6), drop = ease(seg(tt, 3.9, 4.6)), told = seg(tt, 4.8, 5.3);
      rows.forEach((row, i) => {
        const ys = m * 0.5 + i * H, yc = ys + H * 0.64, th = Math.min(11 * u, H * 0.17);
        text(ctx, row.name, x0, ys + 14 * u, { px: 12.5 * u, wt: 500, col: K.ink });
        line(ctx, x0, hair(yc + th + 4 * u), x1, hair(yc + th + 4 * u), K.ruleStrong);
        let low = 0, high = 0;
        ctx.strokeStyle = rgba(K.ink, 0.5); ctx.lineWidth = 1; ctx.beginPath();
        row.z.forEach((z, j) => {
          if (order[i][j] > shown) return;
          if (z < Z0) { low++; return; } if (z > Z1) { high++; return; }
          ctx.moveTo(hair(X(z)), yc - th); ctx.lineTo(hair(X(z)), yc + th);
        });
        ctx.stroke();
        if (low) text(ctx, `‹ ${low} ${'off scale'}`, x0, yc - th - 7 * u, { px: 10 * u, col: K.faint });
        if (high) text(ctx, `${high} ${'off scale'} ›`, x1, yc - th - 7 * u, { px: 10 * u, col: K.faint, align: 'right' });
        if (drop > 0) {
          const tx = X(row.zt), ty = yc - th - 6 * u - (1 - drop) * 10 * u;
          ctx.globalAlpha = drop; ctx.fillStyle = K.signal;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 5 * u, ty - 9 * u); ctx.lineTo(tx + 5 * u, ty - 9 * u); ctx.closePath(); ctx.fill();
          ctx.fillRect(tx - 0.75, ty, 1.5, yc + th + 4 * u - ty);
          ctx.globalAlpha = 1;
        }
        if (told > 0) {
          ctx.globalAlpha = told;
          const verdict = row.reach === 0 ? 'target outside the controls' : 'target among the controls';
          text(ctx, `${row.reach} / ${row.n} · ${verdict}`, x1, ys + 14 * u, { px: 11 * u, col: K.soft, align: 'right' });
          ctx.globalAlpha = 1;
        }
        if (i === rows.length - 1) for (let z = 0; z <= Z1; z += 5) {
          line(ctx, hair(X(z)), yc + th + 4 * u, hair(X(z)), yc + th + 8 * u, K.ruleStrong);
          text(ctx, z ? `${z}σ` : '0', X(z), yc + th + 21 * u, { px: 10 * u, col: K.faint, align: 'center' });
        }
      });
      label(ctx, 'colour excess, in units of the control scatter', x0, h - m * 0.5, { px: 9 * u });
    },
  };
}

function trialsScene() {
  let S, trials;
  const PER = 11.5;
  const CELLS = [[[0, 10], [0, 10], [1, 9]], [[0, 10], [1, 9], [9, 9]], [[1, 10], [9, 10], [10, 10]]];
  const SNR = ['6', '10', '16'], SHIFT = ['3″', '6″', '12″'];
  return {
    still: 10,
    init(canvas) {
      S = surface(canvas);
      const r = rng(9);
      trials = [];
      CELLS.forEach((row, ri) => row.forEach(([found, n], ci) => { const pick = shuffled(n, r); for (let s = 0; s < n; s++) trials.push({ ri, ci, s, found: pick.indexOf(s) < found }); }));
      shuffled(trials.length, r).forEach((rank, i) => { trials[i].at = 0.6 + 6 * rank / trials.length; });
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, left = m + 54 * u, right = w - m, top = m + 42 * u, bottom = h - m - 24 * u, cw = (right - left) / 3, ch = (bottom - top) / 3, tt = t % PER;
      label(ctx, 'machine observer', m, m + 8 * u, { px: 9.5 * u, col: K.soft });
      text(ctx, 'human experiment: not yet run', right, m + 8 * u, { px: 10.5 * u, col: K.faint, align: 'right' });
      label(ctx, 'shift', left - 10 * u, top - 10 * u, { px: 9 * u, align: 'right' });
      for (let i = 0; i < 3; i++) {
        text(ctx, SHIFT[i], left + (i + 0.5) * cw, top - 10 * u, { px: 11.5 * u, col: K.soft, align: 'center' });
        text(ctx, `S/N ${SNR[i]}`, left - 10 * u, top + (i + 0.5) * ch + 4 * u, { px: 11 * u, col: K.soft, align: 'right' });
      }
      for (let i = 0; i <= 3; i++) { line(ctx, hair(left + i * cw), top, hair(left + i * cw), bottom, K.rule); line(ctx, left, hair(top + i * ch), right, hair(top + i * ch), K.rule); }
      const pad = 9 * u, gp = 4 * u, q = Math.min(12 * u, (cw - 2 * pad - 4 * gp) / 5, (ch - 2 * pad - gp - 13 * u) / 2);
      for (const tr of trials) {
        const a = seg(tt, tr.at, tr.at + 0.2); if (a <= 0) continue;
        const x = left + tr.ci * cw + pad + (tr.s % 5) * (q + gp), y = top + tr.ri * ch + pad + Math.floor(tr.s / 5) * (q + gp);
        ctx.globalAlpha = a; box(ctx, x, y, q, q, K.ruleStrong);
        if (tr.found) { ctx.globalAlpha = ease(seg(tt, tr.at + 0.15, tr.at + 0.5)); ctx.fillStyle = K.ink; ctx.fillRect(Math.round(x), Math.round(y), Math.round(q) + 1, Math.round(q) + 1); }
        ctx.globalAlpha = 1;
      }
      const a = seg(tt, 6.9, 7.5);
      if (a > 0) {
        ctx.globalAlpha = a;
        CELLS.forEach((row, ri) => row.forEach(([found, n], ci) => text(ctx, `${found} / ${n}`, left + ci * cw + pad, top + (ri + 1) * ch - 7 * u, { px: 10.5 * u, col: K.soft })));
        box(ctx, left + 3, top + 3, cw - 6, 3 * ch - 6, K.signal);
        box(ctx, left + 2 * cw + 3, top + ch + 3, cw - 6, 2 * ch - 6, K.signal);
        text(ctx, '1 / 30', left + cw / 2, bottom + 17 * u, { px: 12 * u, col: K.signal, align: 'center' });
        text(ctx, '19 / 19', left + 2.5 * cw, bottom + 17 * u, { px: 12 * u, col: K.signal, align: 'center' });
        ctx.globalAlpha = 1;
      }
    },
  };
}

function parityScene() {
  let S;
  const PER = 10, N = 68;
  return {
    still: 8,
    init(canvas) { S = surface(canvas); },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, x0 = m + 86 * u, x1 = w - m - 8 * u, y1 = h * 0.4, y2 = h * 0.62, tt = t % PER, q = Math.max(1, Math.min(3.2 * u, 0.3 * (x1 - x0) / N));
      const scan = lerp(x0 - 16 * u, x1 + 16 * u, seg(tt, 0.6, 6.2)), XI = i => lerp(x0, x1, i / (N - 1));
      let count = 0;
      text(ctx, 'Python', m, y1 + 4 * u, { px: 12.5 * u, col: K.ink });
      text(ctx, 'Browser', m, y2 + 4 * u, { px: 12.5 * u, col: K.ink });
      line(ctx, x0 - 8 * u, hair(y1), x1 + 8 * u, hair(y1), K.rule); line(ctx, x0 - 8 * u, hair(y2), x1 + 8 * u, hair(y2), K.rule);
      for (let i = 0; i < N; i++) {
        const x = XI(i), ok = scan >= x;
        if (ok) {
          count++;
          line(ctx, hair(x), y1 + q, hair(x), y2 - q, rgba(K.ink, 0.3));
          ctx.fillStyle = K.ink; ctx.fillRect(x - q, y1 - q, 2 * q, 2 * q); ctx.fillRect(x - q, y2 - q, 2 * q, 2 * q);
        } else { box(ctx, x - q, y1 - q, 2 * q, 2 * q, K.ruleStrong); box(ctx, x - q, y2 - q, 2 * q, 2 * q, K.ruleStrong); }
      }
      if (scan < x1 + 15 * u) line(ctx, hair(scan), y1 - 20 * u, hair(scan), y2 + 20 * u, K.signal);
      label(ctx, 'same package, same maths', m, m + 8 * u, { px: 9.5 * u });
      const cwid = text(ctx, `${count} / ${N}`, x1 + 8 * u, m + 27 * u, { px: 28 * u, wt: 300, col: K.ink, align: 'right' });
      label(ctx, 'checks', x1 + 8 * u - cwid - 9 * u, m + 27 * u, { px: 9 * u, align: 'right' });
      const a = seg(tt, 6.4, 7);
      if (a > 0) {
        ctx.globalAlpha = a;
        label(ctx, 'largest relative difference: stacks, photometry, injection', m, h - m - 2 * u, { px: 9 * u });
        const sw = text(ctx, '−8', x1 + 8 * u, h - m - 9 * u, { px: 9.5 * u, col: K.ink, align: 'right' });
        text(ctx, '7 × 10', x1 + 8 * u - sw - 1, h - m - 2 * u, { px: 15 * u, wt: 300, col: K.ink, align: 'right' });
        ctx.globalAlpha = 1;
      }
    },
  };
}

export const SCENES = {
  hero: heroScene, lvf: lvfScene, bytes: bytesScene, stack: stackScene, blink: blinkScene, diff: diffScene,
  stereo: stereoScene, cold: coldScene, wise: wiseScene, parallax: parallaxScene, controls: controlsScene,
  trials: trialsScene, parity: parityScene,
};

async function fontsReady() {
  if (!document.fonts) return;
  const sample = 'Ag 0123 µ″±';
  const load = Promise.all(['300', '400', '500'].map(wt => document.fonts.load(`${wt} 12px "IBM Plex Sans"`, sample))).then(() => document.fonts.ready);
  await Promise.race([load.catch(() => {}), new Promise(done => setTimeout(done, 3000))]);
}

function traceProgress() {
  const steps = document.querySelector('.steps'), bar = steps && steps.querySelector('.trace');
  if (!bar) return;
  let queued = false;
  const place = () => { queued = false; const r = steps.getBoundingClientRect(); bar.style.height = `${clamp(window.innerHeight * 0.5 - r.top, 0, r.height).toFixed(0)}px`; };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', ask);
  place();
}

export async function start(lang) {
  readTokens();
  traceProgress();
  await fontsReady();
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const items = [];
  for (const canvas of document.querySelectorAll('canvas[data-scene]')) {
    const make = SCENES[canvas.dataset.scene];
    if (!make) continue;
    const scene = make();
    try { scene.init(canvas, LANG); } catch (err) { console.warn('how: scene could not start:', canvas.dataset.scene, err); continue; }
    canvas.setAttribute('role', 'img');
    if (canvas.dataset[LANG]) canvas.setAttribute('aria-label', canvas.dataset[LANG]);
    items.push({ canvas, scene, t: 0, on: false, woke: false, dead: false });
  }
  const byCanvas = new Map(items.map(it => [it.canvas, it]));

  const paint = it => {
    if (it.dead) return;
    try { it.scene.draw(still ? (it.scene.still || 0) : it.t); }
    catch (err) { it.dead = true; console.warn('how: scene stopped:', it.canvas.dataset.scene, err); }
  };
  const wake = it => {
    if (it.woke) return;
    it.woke = true;
    const p = it.scene.wake && it.scene.wake();
    if (p && p.then) p.then(() => paint(it));
  };

  let raf = 0, last = 0;
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let any = false;
    for (const it of items) if (it.on && !it.dead) { any = true; it.t += dt; paint(it); }
    raf = any ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!still && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };

  if ('IntersectionObserver' in window) {
    const see = new IntersectionObserver(entries => {
      for (const en of entries) {
        const it = byCanvas.get(en.target);
        it.on = en.isIntersecting;
        if (it.on) { wake(it); if (still) paint(it); }
      }
      kick();
    }, { threshold: 0.12 });
    const near = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { wake(byCanvas.get(en.target)); near.unobserve(en.target); }
    }, { rootMargin: '150% 0px' });
    for (const it of items) { see.observe(it.canvas); near.observe(it.canvas); }
  } else {
    for (const it of items) { it.on = true; wake(it); }
    kick();
  }
  items.forEach(paint);
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(entries => { for (const en of entries) { const it = byCanvas.get(en.target); if (it) paint(it); } });
    for (const it of items) ro.observe(it.canvas);
  }
}
