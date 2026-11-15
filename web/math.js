import * as E from './engine.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180, AS = 206264.80624709636;
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
function median(a) { const s = Float64Array.from(a).sort(), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; }
const madSigma = (a, med = median(a)) => 1.4826 * median(Array.from(a, v => Math.abs(v - med)));

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
const pct = (v, d = 0) => `${v.toFixed(d)}%`;
const signed = (v, d) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
const minus = s => String(s).replace('-', '−');
const spaced = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function knobs(canvas) {
  const out = {}, fig = canvas.closest('figure');
  if (fig) for (const el of fig.querySelectorAll('input[type="range"][data-k]')) out[el.dataset.k] = el;
  return out;
}
const val = (el, fallback) => { const v = el ? Number(el.value) : NaN; return v === v ? v : fallback; };

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
function dot(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.fill(); }
function ring(ctx, x, y, r, col, lw = 1) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.stroke(); }
function sq(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
function blob(ctx, x, y, r, hex, a) {
  if (!(r > 0)) return;
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
function plus(ctx, x, y, r, col, lw = 1) { line(ctx, x - r, y, x + r, y, col, lw); line(ctx, x, y - r, x, y + r, col, lw); }
function path(ctx, pts, col, lw = 1) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke(); ctx.restore();
}
function tile(img, n, tone, into) {
  const c = into || document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d'), id = x.createImageData(n, n), ink = rgb(K.ink), bg = rgb(K.deep);
  for (let p = 0; p < n * n; p++) {
    const g = clamp(tone(img[p]));
    for (let j = 0; j < 3; j++) id.data[4 * p + j] = bg[j] + (ink[j] - bg[j]) * g;
    id.data[4 * p + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}
const grey = g => { const ink = rgb(K.ink), bg = rgb(K.deep); g = clamp(g); return `rgb(${[0, 1, 2].map(j => Math.round(bg[j] + (ink[j] - bg[j]) * g)).join(',')})`; };
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
function dataScene(still, load, body, words) {
  let S, knob, D = null, state = 'loading';
  return {
    still,
    init(canvas) { S = surface(canvas); knob = knobs(canvas); canvas.dataset.state = state; },
    wake() {
      return load().then(d => { D = d; state = 'real'; }, err => { state = 'failed'; console.warn('math: measurements are not available:', (err && err.message) || err); })
        .then(() => { S.canvas.dataset.state = state; });
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      if (!D) { notice(ctx, w, h, u, state === 'failed' ? words()[1] : words()[0]); return; }
      body(ctx, w, h, u, D, knob, t);
    },
  };
}

function gnomonicScene() {
  let S, knob;
  return {
    init(canvas) { S = surface(canvas); knob = knobs(canvas); },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, deg = val(knob.theta, 30), th = deg * D2R;
      const py = m + 36 * u, R = Math.max(1, Math.min(h - py - m - 24 * u, w * 0.4)), ox = w * 0.27, oy = py + R, up = -Math.PI / 2;
      const tan = E.tanProject(0, deg, 0, 0)[1] / AS, ix = ox + R * tan, sx = ox + R * Math.sin(th), sy = oy - R * Math.cos(th);
      label(ctx, 'the plate: a plane touching the sky', m, m + 8 * u, { px: 9.5 * u });
      ctx.strokeStyle = K.ruleStrong; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(ox, oy, R, up - 0.55, up + 1.2); ctx.stroke();
      label(ctx, 'the sky', ox - R * Math.sin(0.55) + 10 * u, oy - R * Math.cos(0.55) + 26 * u, { px: 9 * u });
      line(ctx, m, hair(py), w - m, hair(py), K.ink);
      line(ctx, hair(ox), py - 5 * u, hair(ox), py + 5 * u, K.ink);
      text(ctx, 'centre', ox - 7 * u, py - 8 * u, { px: 10 * u, col: K.soft, align: 'right' });
      line(ctx, hair(ox), oy, hair(ox), py, K.rule, 1, [2, 4]);
      ring(ctx, ox, oy, 3 * u, K.soft);
      text(ctx, 'observer', ox, oy + 17 * u, { px: 10 * u, col: K.soft, align: 'center' });
      line(ctx, ox, oy, ix, py, rgba(K.signal, 0.75));
      ctx.strokeStyle = K.soft; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(ox, oy, 24 * u, up, up + th); ctx.stroke();
      text(ctx, 'θ', ox + 36 * u * Math.sin(th / 2), oy - 36 * u * Math.cos(th / 2) + 3 * u, { px: 11.5 * u, col: K.soft, align: 'center' });
      ctx.strokeStyle = K.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox, oy, R, up, up + th); ctx.stroke();
      blob(ctx, sx, sy, 9 * u, K.ink, 0.5); dot(ctx, sx, sy, 2.6 * u, K.ink);
      text(ctx, 'star', sx + 9 * u, sy + 15 * u, { px: 10 * u, col: K.soft });
      line(ctx, ox, hair(py), ix, hair(py), K.signal, 2);
      sq(ctx, ix, hair(py), 3 * u, K.signal);
      if (ix - ox > 46 * u) text(ctx, 'tan θ', (ox + ix) / 2, py - 8 * u, { px: 10.5 * u, col: K.signal, align: 'center' });
      const xr = w - m, yb = h - m - 2 * u, edge = (Math.tan(150 / AS) - 150 / AS) * AS;
      const row = (y, name, value, col) => { text(ctx, value, xr, y, { px: 12 * u, col, align: 'right' }); text(ctx, name, xr - 104 * u, y, { px: 10.5 * u, col: K.faint, align: 'right' }); };
      row(yb - 54 * u, 'on the sphere', `θ = ${th.toFixed(4)}`, K.ink);
      row(yb - 37 * u, 'on the plate', `tan θ = ${tan.toFixed(4)}`, K.signal);
      row(yb - 20 * u, 'difference', pct(th > 0 ? (tan / th - 1) * 100 : 0, 1), K.ink);
      text(ctx, `${'difference at the edge of a 5′ plate'}: ${edge.toFixed(5)}″`, xr, yb, { px: 10 * u, col: K.faint, align: 'right' });
    },
  };
}

function skyScene() {
  let S, stages, mean, hist;
  const SKY = 0.146, SIG = 0.0167, NB = 54, LO = -4.5, HI = 13.5, STEP = 1.7;
  return {
    still: STEP * 6.5,
    init(canvas) {
      S = surface(canvas);
      const r = rng(21);
      const vals = Array.from({ length: 2401 }, () => SKY + SIG * (gauss(r) + (r() < 0.09 ? 2 - 7 * Math.log(1 - r()) : 0)));
      mean = vals.reduce((a, v) => a + v, 0) / vals.length;
      let med = median(vals), sig = madSigma(vals, med);
      stages = [{ med, sig }];
      for (let k = 0; k < 5; k++) {
        const keep = vals.filter(v => Math.abs(v - med) < 3 * sig);
        if (keep.length < 30) break;
        med = median(keep); sig = madSigma(keep, med);
        stages.push({ med, sig });
      }
      hist = new Array(NB).fill(0);
      for (const v of vals) hist[clamp(Math.floor(((v - SKY) / SIG - LO) / (HI - LO) * NB), 0, NB - 1)]++;
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, x0 = m, x1 = w - m, yb = h - m - 20 * u, yt = m + 52 * u, tt = t % (STEP * (stages.length + 1) + 2.8);
      const k = Math.min(stages.length, Math.floor(tt / STEP)), st = k ? stages[k - 1] : null;
      const X = v => x0 + ((v - SKY) / SIG - LO) / (HI - LO) * (x1 - x0), bw = (x1 - x0) / NB, top = Math.max(...hist);
      label(ctx, 'the pixels of one exposure', m, m + 8 * u, { px: 9.5 * u });
      const stage = !k ? 'the mean is fooled by the stars' : k === 1 ? 'median and 1.4826 · MAD' : `${'clipping round'} ${k - 1} / ${stages.length - 1}`;
      text(ctx, stage, x1, m + 8 * u, { px: 10.5 * u, col: K.soft, align: 'right' });
      text(ctx, st ? `m = ${st.med.toFixed(4)} · σ = ${st.sig.toFixed(4)} MJy/sr` : `${'mean'} = ${mean.toFixed(4)} MJy/sr`, x1, m + 25 * u, { px: 12 * u, col: K.ink, align: 'right' });
      if (st) {
        const a = X(st.med - 3 * st.sig), b = X(st.med + 3 * st.sig);
        ctx.fillStyle = rgba(K.signal, 0.1); ctx.fillRect(a, yt - 6 * u, b - a, yb - yt + 6 * u);
        line(ctx, hair(a), yt - 6 * u, hair(a), yb, rgba(K.signal, 0.5)); line(ctx, hair(b), yt - 6 * u, hair(b), yb, rgba(K.signal, 0.5));
        text(ctx, '±3σ', b + 5 * u, yt + 6 * u, { px: 10.5 * u, col: K.signal });
      }
      for (let i = 0; i < NB; i++) {
        if (!hist[i]) continue;
        const c = SKY + SIG * (LO + (i + 0.5) / NB * (HI - LO)), bh = Math.max(1.5, (yb - yt) * hist[i] / top);
        ctx.fillStyle = rgba(K.ink, !st || Math.abs(c - st.med) < 3 * st.sig ? 0.62 : 0.2);
        ctx.fillRect(x0 + i * bw + 0.5, yb - bh, Math.max(1, bw - 1), bh);
      }
      line(ctx, x0, hair(yb), x1, hair(yb), K.ruleStrong);
      for (const s of [0, 5, 10]) {
        line(ctx, hair(X(SKY + s * SIG)), yb, hair(X(SKY + s * SIG)), yb + 4 * u, K.ruleStrong);
        text(ctx, s ? `+${s}σ` : SKY.toFixed(3), X(SKY + s * SIG), yb + 15 * u, { px: 10 * u, col: K.faint, align: 'center' });
      }
      label(ctx, 'pixels with stars', X(SKY + 7.5 * SIG), yb - 14 * u, { px: 9 * u, align: 'center' });
      line(ctx, hair(X(mean)), yt - 6 * u, hair(X(mean)), yb, K.soft, 1, [3, 3]);
      text(ctx, 'mean', X(mean) + 5 * u, yt - 11 * u, { px: 10 * u, col: K.soft });
      if (st) {
        line(ctx, hair(X(st.med)), yt - 6 * u, hair(X(st.med)), yb, K.signal, 1.5);
        text(ctx, 'median', X(st.med) - 5 * u, yt - 11 * u, { px: 10 * u, col: K.signal, align: 'right' });
      }
    },
  };
}

function resampleScene() {
  let S, img, nodes, act;
  const M = [5.818397, -1.760393, -1.910358, -5.871608], NP = 6, GRID = 3.075, STEP = 1.25;
  const det = M[0] * M[3] - M[1] * M[2], MI = [M[3] / det, -M[1] / det, -M[2] / det, M[0] / det];
  const C = [-(M[0] + M[1]) * (NP - 1) / 2, -(M[2] + M[3]) * (NP - 1) / 2];
  const sky = (x, y) => [M[0] * x + M[1] * y + C[0], M[2] * x + M[3] * y + C[1]];
  const pix = (xi, eta) => { const dx = xi - C[0], dy = eta - C[1]; return [MI[0] * dx + MI[1] * dy, MI[2] * dx + MI[3] * dy]; };
  return {
    still: STEP * 9.4,
    init(canvas) {
      S = surface(canvas);
      const r = rng(4);
      img = new Float32Array(NP * NP);
      for (let y = 0; y < NP; y++) for (let x = 0; x < NP; x++) img[y * NP + x] = clamp(0.1 + 0.85 * Math.exp(-0.5 * ((x - 2.8) ** 2 + (y - 2.3) ** 2) / 0.8) + 0.05 * gauss(r));
      nodes = []; act = [];
      for (let j = 9; j >= -9; j--) for (let i = 9; i >= -9; i--) {
        const [x, y] = pix(i * GRID, j * GRID);
        if (x < 0 || y < 0 || x > NP - 1 || y > NP - 1) continue;
        nodes.push({ xi: i * GRID, eta: j * GRID, x, y });
        if (x >= 1 && y >= 1 && x < NP - 2 && y < NP - 2) act.push(nodes.length - 1);
      }
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, size = Math.min(w * 0.54, h - 2 * m - 46 * u), sc = size / 46.4, lx = m + size / 2, ly = m + 20 * u + size / 2;
      const P = (xi, eta) => [lx - xi * sc, ly - eta * sc], Q = (x, y) => P(...sky(x, y));
      const cell = (x, y) => { ctx.beginPath(); [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].forEach(([a, b], i) => { const [px, py] = Q(x + a, y + b); (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); }); ctx.closePath(); };
      label(ctx, 'the exposure’s own pixels', m, m + 8 * u, { px: 9.5 * u });
      for (let y = 0; y < NP; y++) for (let x = 0; x < NP; x++) {
        cell(x, y); ctx.fillStyle = grey(0.04 + 0.8 * img[y * NP + x]); ctx.fill();
        ctx.strokeStyle = K.rule; ctx.lineWidth = 1; ctx.stroke();
      }
      for (const n of nodes) { const [px, py] = P(n.xi, n.eta); plus(ctx, px, py, 2.2 * u, rgba(K.ink, 0.5)); }
      label(ctx, 'plus signs: the common grid, north up', m, h - m * 0.55, { px: 9 * u });
      const a = nodes[act[Math.floor(t / STEP) % act.length]], x0 = Math.floor(a.x), y0 = Math.floor(a.y), fx = a.x - x0, fy = a.y - y0;
      const nb = [[0, 0], [1, 0], [0, 1], [1, 1]], wt = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const v = nb.map(([i, j]) => img[(y0 + j) * NP + x0 + i]), out = v.reduce((s, vi, i) => s + wt[i] * vi, 0), [ax, ay] = P(a.xi, a.eta);
      nb.forEach(([i, j], q) => {
        cell(x0 + i, y0 + j); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.2; ctx.stroke();
        const [cx, cy] = Q(x0 + i, y0 + j);
        line(ctx, ax, ay, cx, cy, rgba(K.signal, 0.85), 0.6 + 3.2 * wt[q]);
      });
      sq(ctx, ax, ay, 3 * u, K.signal);
      const rx = m + size + 26 * u, q = Math.min(46 * u, (w - m - rx - 8 * u) / 2, (h - 2 * m - 96 * u) / 2), gp = 6 * u, ty = m + 22 * u;
      label(ctx, 'four neighbours, four shares', rx, m + 8 * u, { px: 9.5 * u });
      nb.forEach(([i, j], n) => {
        const x = rx + i * (q + gp), y = ty + j * (q + gp);
        ctx.fillStyle = grey(0.04 + 0.8 * v[n]); ctx.fillRect(x, y, q, q); box(ctx, x, y, q, q, K.ruleStrong);
        text(ctx, pct(wt[n] * 100), x + q / 2, y + q / 2 + 4 * u, { px: 12 * u, wt: 500, col: v[n] > 0.5 ? K.deep : K.ink, align: 'center' });
        text(ctx, `v${i}${j}`, x + 4 * u, y + 11 * u, { px: 8.5 * u, col: v[n] > 0.5 ? K.deep : K.faint });
      });
      const y2 = ty + 2 * q + gp + 20 * u;
      text(ctx, `fx = ${fx.toFixed(2)} · fy = ${fy.toFixed(2)}`, rx, y2, { px: 11 * u, col: K.soft });
      ctx.fillStyle = grey(0.04 + 0.8 * out); ctx.fillRect(rx, y2 + 12 * u, 22 * u, 22 * u); box(ctx, rx, y2 + 12 * u, 22 * u, 22 * u, K.signal);
      text(ctx, `v = ${out.toFixed(2)}`, rx + 32 * u, y2 + 28 * u, { px: 13 * u, col: K.ink });
    },
  };
}

function stackScene() {
  let S, knob, layers, sig, far;
  const R = 24, NMAX = 64, SRC = [[7.2, 8.1, 5], [16.4, 15.2, 2.2], [6.3, 18.6, 0.9]], CR = [18, 5];
  const cache = new Map();
  function stackOf(n) {
    if (cache.has(n)) return cache.get(n);
    const img = new Float32Array(R * R), tmp = new Float64Array(n);
    let rejected = 0, wsum = 0;
    for (let i = 0; i < n; i++) wsum += 1 / (sig[i] * sig[i]);
    for (let p = 0; p < R * R; p++) {
      let med = 0;
      if (n >= 3) { for (let i = 0; i < n; i++) tmp[i] = layers[i][p]; med = median(tmp); }
      let sw = 0, swx = 0;
      for (let i = 0; i < n; i++) {
        const v = layers[i][p];
        if (n >= 3 && Math.abs(v - med) > Math.max(8 * sig[i], 2 * Math.abs(med))) { rejected++; continue; }
        const wi = 1 / (sig[i] * sig[i]); sw += wi; swx += wi * v;
      }
      img[p] = swx / sw;
    }
    const st = { noise: madSigma(far.map(p => img[p])), formal: 1 / Math.sqrt(wsum), rejected, tile: tile(img, R, v => Math.pow(clamp((v + 1) / 7.5), 0.9)) };
    cache.set(n, st);
    return st;
  }
  return {
    init(canvas) {
      S = surface(canvas); knob = knobs(canvas);
      const r = rng(5), truth = new Float32Array(R * R);
      far = [];
      for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
        let v = 0, near = x === CR[0] && y === CR[1];
        for (const [sx, sy, a] of SRC) { const d2 = (x - sx) ** 2 + (y - sy) ** 2; v += a * Math.exp(-0.5 * d2 / 1.2); if (d2 < 16) near = true; }
        truth[y * R + x] = v; if (!near) far.push(y * R + x);
      }
      layers = []; sig = [];
      for (let i = 0; i < NMAX; i++) {
        const s = 0.8 + 0.45 * r(), one = new Float32Array(R * R);
        for (let p = 0; p < R * R; p++) one[p] = truth[p] + s * gauss(r);
        layers.push(one); sig.push(s);
      }
      layers[0][CR[1] * R + CR[0]] += 40;
    },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, N = clamp(Math.round(val(knob.n, 9)), 1, NMAX), st = stackOf(N);
      const g = Math.min(h - 2 * m - 42 * u, w * 0.38), gx = m, gy = m + 22 * u, c = g / R;
      label(ctx, N === 1 ? 'a single exposure' : `stack of ${N} exposures`, gx, m + 8 * u, { px: 9.5 * u });
      ctx.imageSmoothingEnabled = false; ctx.drawImage(st.tile, gx, gy, g, g); ctx.imageSmoothingEnabled = true;
      box(ctx, gx, gy, g, g, K.ruleStrong);
      corners(ctx, gx + CR[0] * c - 4 * u, gy + CR[1] * c - 4 * u, c + 8 * u, c + 8 * u, 4 * u, K.signal);
      text(ctx, N < 3 ? 'the cosmic-ray hit is still there' : 'the cosmic-ray hit is rejected', gx, gy + g + 16 * u, { px: 10.5 * u, col: N < 3 ? K.signal : K.soft });
      const px0 = gx + g + 40 * u, px1 = w - m - 4 * u, py0 = gy + 4 * u, py1 = gy + g - 2 * u, n1 = stackOf(1).noise;
      const PX = n => lerp(px0 + 6 * u, px1 - 5 * u, (n - 1) / (NMAX - 1)), PY = v => lerp(py1 - 2 * u, py0 + 6 * u, v / (1.12 * n1));
      label(ctx, 'noise', px0, gy - 6 * u, { px: 9 * u });
      line(ctx, hair(px0), py0, hair(px0), py1, K.ruleStrong); line(ctx, px0, hair(py1), px1, hair(py1), K.ruleStrong);
      const curve = []; let ws = 0;
      for (let n = 1; n <= NMAX; n++) { ws += 1 / (sig[n - 1] * sig[n - 1]); curve.push([PX(n), PY(1 / Math.sqrt(ws))]); }
      path(ctx, curve, K.ruleStrong);
      text(ctx, '1 / √Σw ≈ σ / √N', PX(NMAX), PY(1 / Math.sqrt(ws)) - 9 * u, { px: 10 * u, col: K.faint, align: 'right' });
      for (let n = 1; n <= N; n++) sq(ctx, PX(n), PY(stackOf(n).noise), (n === N ? 2.8 : 1.3) * u, n === N ? K.signal : rgba(K.ink, 0.8));
      text(ctx, `N = ${N}`, px1, py0 + 14 * u, { px: 15 * u, wt: 300, col: K.ink, align: 'right' });
      text(ctx, `${'measured'} ${st.noise.toFixed(2)} · ${'expected'} ${st.formal.toFixed(2)}`, px1, py0 + 31 * u, { px: 10.5 * u, col: K.soft, align: 'right' });
      text(ctx, '1', PX(1), py1 + 14 * u, { px: 10 * u, col: K.faint, align: 'center' });
      text(ctx, String(NMAX), PX(NMAX), py1 + 14 * u, { px: 10 * u, col: K.faint, align: 'center' });
      label(ctx, 'exposures', (PX(1) + PX(NMAX)) / 2, py1 + 14 * u, { px: 9 * u, align: 'center' });
    },
  };
}

function psfScene() {
  let S, knob, P, noise, pmax;
  const B = 7, SG = 7.45 / 2.354820045 / 6.15, TO_UJY = 37.86 / E.ARCSEC2_PER_SR * 1e12, SIGPIX = 0.06, SKYLVL = 0.42, OFF = [0.28, -0.17], FMAX = 2000;
  return {
    init(canvas) {
      S = surface(canvas); knob = knobs(canvas);
      const r = rng(8), half = B >> 1, norm = 1 / (TAU * SG * SG);
      P = []; noise = [];
      for (let row = -half; row <= half; row++) for (let col = -half; col <= half; col++) {
        P.push(norm * Math.exp(-0.5 * ((col - OFF[0]) ** 2 + (row - OFF[1]) ** 2) / (SG * SG)));
        noise.push(SIGPIX * gauss(r));
      }
      pmax = Math.max(...P);
    },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, truth = val(knob.flux, 600), amp = truth / TO_UJY, n = B * B, d = new Float64Array(n);
      let sp = 0, spp = 0, sd = 0, spd = 0;
      for (let i = 0; i < n; i++) { d[i] = amp * P[i] + SKYLVL + noise[i]; sp += P[i]; spp += P[i] * P[i]; sd += d[i]; spd += P[i] * d[i]; }
      const den = n * spp - sp * sp, F = (n * spd - sp * sd) / den, sky = (sd - F * sp) / n, eF = Math.sqrt(n / den) * SIGPIX;
      const Fu = F * TO_UJY, eFu = eF * TO_UJY;
      const g = Math.min(h - 2 * m - 42 * u, w * 0.34), gx = m, gy = m + 22 * u, c = g / B, lo = SKYLVL - 2.5 * SIGPIX, span = 5 * SIGPIX + 0.9 * amp * pmax;
      label(ctx, 'one exposure, 7 × 7 pixels', gx, m + 8 * u, { px: 9.5 * u });
      for (let i = 0; i < n; i++) { ctx.fillStyle = grey(Math.pow(clamp((d[i] - lo) / span), 0.8)); ctx.fillRect(gx + (i % B) * c, gy + Math.floor(i / B) * c, c + 0.5, c + 0.5); }
      box(ctx, gx, gy, g, g, K.ruleStrong);
      plus(ctx, gx + (3.5 + OFF[0]) * c, gy + (3.5 + OFF[1]) * c, 5 * u, K.signal, 1.2);
      text(ctx, `${'the flux you chose'}: ${truth.toFixed(0)} µJy`, gx, gy + g + 16 * u, { px: 10.5 * u, col: K.soft });
      const px0 = gx + g + 44 * u, px1 = w - m - 4 * u, py0 = gy, py1 = gy + g, y0 = SKYLVL - 0.3, y1 = SKYLVL + FMAX / TO_UJY * pmax + 0.2;
      const PX = p => lerp(px0 + 5 * u, px1 - 6 * u, p / pmax), PY = v => lerp(py1 - 3 * u, py0 + 3 * u, (v - y0) / (y1 - y0));
      line(ctx, hair(px0), py0, hair(px0), py1, K.ruleStrong); line(ctx, px0, hair(py1), px1, hair(py1), K.ruleStrong);
      line(ctx, px0, hair(PY(sky)), px1, hair(PY(sky)), K.rule, 1, [3, 3]);
      text(ctx, 'S', px1, PY(sky) + 13 * u, { px: 10.5 * u, col: K.faint, align: 'right' });
      ctx.save(); ctx.beginPath(); ctx.rect(px0, py0, px1 - px0, py1 - py0); ctx.clip();
      line(ctx, PX(0), PY(sky), PX(pmax), PY(sky + F * pmax), K.signal, 1.5);
      for (let i = 0; i < n; i++) sq(ctx, PX(P[i]), PY(d[i]), 1.7 * u, rgba(K.ink, 0.8));
      ctx.restore();
      text(ctx, `F = ${minus(Fu.toFixed(0))} ± ${eFu.toFixed(0)} µJy`, px0 + 10 * u, py0 + 15 * u, { px: 13 * u, col: K.ink });
      text(ctx, `${'the slope of the line'} · S/N ${minus((F / eF).toFixed(1))}`, px0 + 10 * u, py0 + 31 * u, { px: 10.5 * u, col: K.signal });
      label(ctx, 'PSF value P', px1, py1 + 15 * u, { px: 9 * u, align: 'right' });
      label(ctx, 'pixel value d', px0, gy - 6 * u, { px: 9 * u });
    },
  };
}

function centroidScene() {
  let S, img, plate, runs;
  const N = 19, SC = 3.075, SG = 10 / 2.354820045, HALF = 11, STEP = 0.62, HOLD = 2.6, SRC = [2.3, -1.6];
  const X = c => (c - (N - 1) / 2) * SC, Y = r => ((N - 1) / 2 - r) * SC;
  function walk(xi0, eta0) {
    let cx = xi0, cy = eta0, bg = 0;
    const far = [], steps = [{ x: cx, y: cy, d: NaN }];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const d = Math.hypot(X(c) - xi0, Y(r) - eta0); if (d > 16 && d < 24) far.push(img[r * N + c]); }
    if (far.length > 20) { far.sort((a, b) => a - b); bg = far[far.length >> 1]; }
    for (let it = 0; it < 12; it++) {
      let sw = 0, sx = 0, sy = 0;
      for (let r = 0; r < N; r++) {
        const y = Y(r); if (Math.abs(y - cy) > HALF) continue;
        for (let c = 0; c < N; c++) {
          const x = X(c); if (Math.abs(x - cx) > HALF) continue;
          const v = img[r * N + c] - bg, g = Math.exp(-0.5 * ((x - cx) ** 2 + (y - cy) ** 2) / (SG * SG));
          sw += g * v; sx += g * v * (x - cx); sy += g * v * (y - cy);
        }
      }
      if (!(sw > 0)) break;
      const dx = 2 * sx / sw, dy = 2 * sy / sw;
      cx += dx; cy += dy;
      steps.push({ x: cx, y: cy, d: Math.hypot(dx, dy) });
      if (Math.hypot(dx, dy) < 0.01 || Math.hypot(cx - xi0, cy - eta0) > HALF) break;
    }
    return steps;
  }
  return {
    still: 9 * STEP,
    init(canvas) {
      S = surface(canvas);
      const r = rng(31), s2 = (9 / 2.354820045) ** 2;
      img = new Float32Array(N * N);
      for (let row = 0; row < N; row++) for (let c = 0; c < N; c++) img[row * N + c] = 0.05 + Math.exp(-0.5 * ((X(c) - SRC[0]) ** 2 + (Y(row) - SRC[1]) ** 2) / s2) + 0.03 * gauss(r);
      plate = tile(img, N, v => 0.03 + 0.9 * v);
      runs = [[-5.2, 4.1], [4.6, 4.4], [3.2, -5.6]].map(([dx, dy]) => walk(SRC[0] + dx, SRC[1] + dy));
    },
    draw(t) {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, total = runs.reduce((s, r) => s + r.length * STEP + HOLD, 0);
      let lt = t % total, run = runs[0];
      for (const r of runs) { const dur = r.length * STEP + HOLD; if (lt < dur) { run = r; break; } lt -= dur; }
      const k = Math.min(run.length - 1, Math.floor(lt / STEP)), at = run[k], done = k === run.length - 1;
      const g = Math.min(h - 2 * m - 26 * u, w * 0.5), gx = m, gy = m + 20 * u, s = g / (N * SC), TX = x => gx + g / 2 + x * s, TY = y => gy + g / 2 - y * s;
      label(ctx, 'windowed centroid', gx, m + 8 * u, { px: 9.5 * u });
      ctx.imageSmoothingEnabled = false; ctx.drawImage(plate, gx, gy, g, g); ctx.imageSmoothingEnabled = true;
      box(ctx, gx, gy, g, g, K.ruleStrong);
      ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, g, g); ctx.clip();
      plus(ctx, TX(SRC[0]), TY(SRC[1]), 6 * u, K.deep, 2.4); plus(ctx, TX(SRC[0]), TY(SRC[1]), 6 * u, K.ink, 1);
      path(ctx, run.slice(0, k + 1).map(p => [TX(p.x), TY(p.y)]), rgba(K.signal, 0.8));
      for (let i = 0; i < k; i++) sq(ctx, TX(run[i].x), TY(run[i].y), 1.6 * u, K.signal);
      ctx.strokeStyle = rgba(K.signal, 0.4); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(TX(at.x - HALF), TY(at.y + HALF), 2 * HALF * s, 2 * HALF * s); ctx.setLineDash([]);
      ring(ctx, TX(at.x), TY(at.y), SG * s, K.signal, 1.4); ring(ctx, TX(at.x), TY(at.y), 2 * SG * s, rgba(K.signal, 0.35));
      ctx.restore();
      label(ctx, `${Math.round(N * SC)}″`, gx + g, gy + g + 14 * u, { px: 9 * u, align: 'right' });
      const bx0 = gx + g + 30 * u, bx1 = w - m, top = gy + 50 * u, bot = gy + g, YL = d => lerp(bot, top, (Math.log10(clamp(d, 1e-3, 10)) + 3) / 4), bw = (bx1 - bx0 - 34 * u) / 12;
      text(ctx, done ? 'stopped' : `${'step'} ${k}`, bx1, m + 8 * u, { px: 10.5 * u, col: K.soft, align: 'right' });
      text(ctx, k ? `Δ = ${at.d.toFixed(3)}″` : 'start', bx0, gy + 16 * u, { px: 14 * u, wt: 300, col: K.ink });
      if (done) text(ctx, `${'from the true place'} ${Math.hypot(at.x - SRC[0], at.y - SRC[1]).toFixed(2)}″`, bx0, gy + 33 * u, { px: 10.5 * u, col: K.soft });
      line(ctx, bx0, hair(bot), bx1, hair(bot), K.ruleStrong);
      for (const [d, name] of [[10, '10″'], [1, '1″'], [0.1, '0.1″'], [0.01, '0.01″']]) {
        const stop = d === 0.01;
        line(ctx, bx0, hair(YL(d)), bx1, hair(YL(d)), stop ? rgba(K.signal, 0.7) : K.rule, 1, stop ? [3, 3] : null);
        text(ctx, name, bx1, YL(d) - 4 * u, { px: 9.5 * u, col: stop ? K.signal : K.faint, align: 'right' });
      }
      for (let i = 1; i <= k; i++) { ctx.fillStyle = i === k ? K.signal : rgba(K.ink, 0.6); ctx.fillRect(bx0 + (i - 1) * bw + 1, YL(run[i].d), Math.max(2, bw - 3), bot - YL(run[i].d)); }
      label(ctx, 'size of the step', bx0, bot + 14 * u, { px: 9 * u });
    },
  };
}

function coldScene() {
  let S, knob, w1, w2, stars, t1, t2, tr, lastK = NaN;
  const R = 34, KMED = 0.655, COLD = [20.5, 14.5], KMIN = 0.3, KMAX = 1;
  const OFFS = [0.03, -0.14, 0.11, -0.05, 0.01, -0.1, 0.15, -0.03, 0.05, -0.07, 0.08, -0.01, 0];
  const tone = v => 0.24 + 0.62 * v;
  return {
    init(canvas) {
      S = surface(canvas); knob = knobs(canvas);
      const r = rng(17);
      stars = [{ x: COLD[0] + 1.9, y: COLD[1] + 0.8, f: 1.1 }];
      while (stars.length < OFFS.length) {
        const x = 3 + (R - 6) * r(), y = 3 + (R - 6) * r();
        if (Math.hypot(x - COLD[0], y - COLD[1]) < 7 || stars.some(s => Math.hypot(s.x - x, s.y - y) < 5.5)) continue;
        stars.push({ x, y, f: 0.3 + 1.3 * r() ** 2 });
      }
      stars.forEach((s, i) => { s.k = KMED + OFFS[i]; });
      w1 = new Float32Array(R * R); w2 = new Float32Array(R * R);
      const peak = (x, y, sx, sy) => Math.exp(-0.5 * ((x - sx) ** 2 + (y - sy) ** 2) / 1.56);
      for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
        let a = 0.03 * peak(x, y, ...COLD), b = 1.0 * peak(x, y, ...COLD);
        for (const s of stars) { const p = s.f * peak(x, y, s.x, s.y); a += p; b += s.k * p; }
        w1[y * R + x] = a + 0.02 * gauss(r); w2[y * R + x] = b + 0.02 * gauss(r);
      }
      t2 = tile(w2, R, tone); t1 = tile(w1, R, tone); tr = document.createElement('canvas');
    },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, k = clamp(val(knob.k, KMED), KMIN, KMAX), gap = 30 * u;
      if (k !== lastK) { const res = new Float32Array(R * R); for (let p = 0; p < R * R; p++) res[p] = w2[p] - k * w1[p]; tile(res, R, tone, tr); lastK = k; }
      const q = Math.min((w - 2 * m - 2 * gap) / 3, h - m - 24 * u - 80 * u), x0 = (w - 3 * q - 2 * gap) / 2, y0 = m + 24 * u, c = q / R;
      ctx.imageSmoothingEnabled = false;
      [[t2, 'W2s · 4.0–5.0 µm'], [t1, 'W1s · 3.0–3.8 µm'], [tr, 'R = W2s − k · W1s']].forEach(([img, name], i) => {
        const x = x0 + i * (q + gap);
        ctx.drawImage(img, x, y0, q, q); box(ctx, x, y0, q, q, i === 2 ? K.ink : K.ruleStrong);
        text(ctx, name, x, y0 - 8 * u, { px: 10.5 * u, col: i === 2 ? K.ink : K.soft });
        corners(ctx, x + (COLD[0] - 2.6) * c, y0 + (COLD[1] - 2.6) * c, 6.2 * c, 6.2 * c, 1.6 * c, K.signal);
      });
      ctx.imageSmoothingEnabled = true;
      text(ctx, '− k ·', x0 + q + gap / 2, y0 + q / 2 + 4 * u, { px: 12 * u, col: K.ink, align: 'center' });
      text(ctx, '=', x0 + 2 * q + 1.5 * gap, y0 + q / 2 + 4 * u, { px: 13 * u, col: K.ink, align: 'center' });
      const ay = y0 + q + 44 * u, ax0 = m + 4 * u, ax1 = w - m - 4 * u, KX = v => lerp(ax0, ax1, (v - KMIN) / (KMAX - KMIN));
      line(ctx, ax0, hair(ay), ax1, hair(ay), K.ruleStrong);
      for (const s of stars) line(ctx, hair(KX(s.k)), ay - 10 * u, hair(KX(s.k)), ay, rgba(K.ink, 0.75));
      for (const v of [KMIN, KMAX]) text(ctx, v.toFixed(1), KX(v), ay + 15 * u, { px: 10 * u, col: K.faint, align: v === KMIN ? 'left' : 'right' });
      line(ctx, hair(KX(KMED)), ay, hair(KX(KMED)), ay + 5 * u, K.ink);
      text(ctx, `${'median'} ${KMED}`, KX(KMED), ay + 16 * u, { px: 10 * u, col: K.soft, align: 'center' });
      line(ctx, hair(KX(k)), ay - 17 * u, hair(KX(k)), ay + 5 * u, K.signal, 1.5);
      text(ctx, `k = ${k.toFixed(3)}`, clamp(KX(k), ax0 + 24 * u, ax1 - 24 * u), ay - 22 * u, { px: 11 * u, col: K.signal, align: 'center' });
      const left = stars.reduce((s, st) => s + Math.abs(st.k - k) * st.f, 0) / stars.reduce((s, st) => s + st.k * st.f, 0);
      label(ctx, 'the ratios of the stars', ax0, ay + 34 * u, { px: 9 * u });
      text(ctx, `${'star light left'}: ${pct(left * 100)}`, ax1, ay + 34 * u, { px: 11 * u, col: K.ink, align: 'right' });
    },
  };
}

const W0855 = { ra: 133.795125, dec: -7.245139 };
async function loadMotion() {
  const res = await fetch('data/wise0855/analysis.json');
  if (!res.ok) throw new Error(`wise0855/analysis.json: ${res.status}`);
  const a = await res.json(), fit = a.fits && a.fits['WISE + SPHEREx'], eps = [...(a.wise_epochs || []), ...(a.spherex_epochs || [])];
  if (!fit || !fit.pa || fit.pa.length !== eps.length || eps.length < 8) throw new Error('no joint fit in analysis.json');
  const pts = eps.map((e, i) => ({ yr: E.mjdToYear(e.mjd), dt: E.mjdToYear(e.mjd) - fit.t_ref, x: e.xi, y: e.eta, sx: e.e_xi, sy: e.e_eta, pa: fit.pa[i], pd: fit.pd[i], late: e.src === 'SPHEREx' }));
  const curve = [];
  for (let yr = 2009.8; yr <= 2026.9; yr += 0.01) curve.push([yr, E.parallaxFactors(W0855.ra, W0855.dec, 51544.5 + (yr - 2000) * 365.25)[0]]);
  const scan = []; for (let i = 0; i <= 100; i++) scan.push(profile(pts, i / 100).chi2);
  return { pts, curve, scan, best: fit.plx, dof: 2 * pts.length - 5, late: pts.filter(p => p.late).length };
}
function profile(pts, plx) {
  const out = { chi2: 0 };
  for (const [v, s, p] of [['x', 'sx', 'pa'], ['y', 'sy', 'pd']]) {
    let sw = 0, st = 0, stt = 0, sy = 0, sty = 0;
    for (const e of pts) { const wt = 1 / (e[s] * e[s]), y = e[v] - plx * e[p]; sw += wt; st += wt * e.dt; stt += wt * e.dt * e.dt; sy += wt * y; sty += wt * e.dt * y; }
    const mu = (sw * sty - st * sy) / (sw * stt - st * st), z0 = (sy - mu * st) / sw;
    for (const e of pts) out.chi2 += ((e[v] - plx * e[p] - z0 - mu * e.dt) / e[s]) ** 2;
    out[v] = [z0, mu];
  }
  return out;
}
const motionScene = () => dataScene(0, loadMotion, (ctx, w, h, u, D, knob) => {
  const m = 18 * u, plx = val(knob.plx, D.best), f = profile(D.pts, plx);
  const x0 = m + 30 * u, x1 = w - m, top = m + 30 * u, bot = h * 0.57, Y0 = 2009.6, Y1 = 2027, RNG = 1.4;
  const XX = yr => lerp(x0, x1, (yr - Y0) / (Y1 - Y0)), YY = v => lerp(bot, top, (v + RNG) / (2 * RNG));
  label(ctx, 'WISE 0855 · east–west wobble', m, m + 8 * u, { px: 9.5 * u });
  const ws = text(ctx, `SPHEREx · ${D.late}`, x1, m + 8 * u, { px: 10.5 * u, col: K.b, align: 'right' });
  text(ctx, `WISE · ${D.pts.length - D.late}`, x1 - ws - 14 * u, m + 8 * u, { px: 10.5 * u, col: K.a, align: 'right' });
  line(ctx, hair(x0), top, hair(x0), bot, K.ruleStrong); line(ctx, x0, hair(bot), x1, hair(bot), K.ruleStrong);
  line(ctx, x0, hair(YY(0)), x1, hair(YY(0)), K.rule);
  for (const v of [-1, 0, 1]) { line(ctx, x0 - 4 * u, hair(YY(v)), x0, hair(YY(v)), K.ruleStrong); text(ctx, v ? `${signed(v, 0)}″` : '0', x0 - 7 * u, YY(v) + 3.5 * u, { px: 10 * u, col: K.faint, align: 'right' }); }
  for (let yr = 2010; yr <= 2026; yr += 2) { line(ctx, hair(XX(yr)), bot, hair(XX(yr)), bot + (yr % 4 === 2 ? 6 : 3) * u, K.ruleStrong); if (yr % 4 === 2) text(ctx, String(yr), XX(yr), bot + 18 * u, { px: 10 * u, col: K.faint, align: 'center' }); }
  ctx.save(); ctx.beginPath(); ctx.rect(x0, top - 2, x1 - x0, bot - top + 2); ctx.clip();
  path(ctx, D.curve.map(([yr, p]) => [XX(yr), YY(plx * p)]), rgba(K.signal, 0.85), 1.1);
  for (const e of D.pts) {
    const r = e.x - f.x[0] - f.x[1] * e.dt, col = e.late ? K.b : K.a, px = hair(XX(e.yr));
    line(ctx, px, YY(r - e.sx), px, YY(r + e.sx), rgba(col, 0.75));
    sq(ctx, px, YY(r), 2 * u, col);
  }
  ctx.restore();
  const ry = bot + 40 * u;
  text(ctx, `ϖ = ${plx.toFixed(3)}″`, x0, ry, { px: 13 * u, col: K.signal });
  text(ctx, `μ = ${signed(f.x[1], 3)}, ${signed(f.y[1], 3)} ″/${'yr'}`, x0 + 96 * u, ry, { px: 10.5 * u, col: K.soft });
  text(ctx, `χ² = ${f.chi2.toFixed(1)} / ${D.dof}`, x1, ry, { px: 13 * u, col: K.ink, align: 'right' });
  const c0 = ry + 16 * u, c1 = h - m - 16 * u, lo = Math.min(...D.scan), hi = Math.max(...D.scan), CX = p => lerp(x0, x1, p), CY = c => lerp(c1, c0 + 3 * u, clamp((c - lo) / (hi - lo)));
  line(ctx, x0, hair(c1), x1, hair(c1), K.ruleStrong);
  path(ctx, D.scan.map((c, i) => [CX(i / 100), CY(c)]), rgba(K.ink, 0.7));
  line(ctx, hair(CX(D.best)), c1, hair(CX(D.best)), c1 + 4 * u, K.ink);
  text(ctx, `${'best'} ${D.best.toFixed(3)}″`, CX(D.best), c1 + 15 * u, { px: 10 * u, col: K.soft, align: 'center' });
  text(ctx, '0', x0, c1 + 15 * u, { px: 10 * u, col: K.faint }); text(ctx, '1″', x1, c1 + 15 * u, { px: 10 * u, col: K.faint, align: 'right' });
  line(ctx, hair(CX(plx)), c0, hair(CX(plx)), c1, rgba(K.signal, 0.6));
  sq(ctx, CX(plx), CY(f.chi2), 2.8 * u, K.signal);
}, () => ['Loading the measurements…', 'The WISE 0855 measurements could not be loaded; the numbers are in the table.']);

function distanceScene() {
  let S, knob;
  const MU = 8.15, MEAS = 0.502, PUB = 0.439, FAR = 5.2;
  return {
    init(canvas) { S = surface(canvas); knob = knobs(canvas); },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, plx = clamp(val(knob.plx, MEAS), 0.19, 1), d = 1 / plx, v = 4.74 * MU * d;
      const sx = m + 16 * u, cy = h * 0.39, au = Math.max(1, Math.min(32 * u, h * 0.16)), DX = pc => sx + (w - m - 22 * u - sx) * pc / FAR, px = DX(d);
      label(ctx, 'side view, not to scale', m, m + 8 * u, { px: 9.5 * u });
      ctx.strokeStyle = K.ruleStrong; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, cy, 7 * u, au, 0, 0, TAU); ctx.stroke();
      ring(ctx, sx, cy, 3 * u, K.soft);
      line(ctx, sx, cy, px, cy, K.rule, 1, [2, 4]);
      line(ctx, sx, cy - au, px, cy, rgba(K.ink, 0.6)); line(ctx, sx, cy + au, px, cy, rgba(K.ink, 0.6));
      dot(ctx, sx, cy - au, 2.5 * u, K.ink); dot(ctx, sx, cy + au, 2.5 * u, K.ink);
      text(ctx, 'Earth', m, cy - au - 9 * u, { px: 10 * u, col: K.soft });
      text(ctx, 'six months later', m, cy + au + 17 * u, { px: 10 * u, col: K.soft });
      const ang = Math.atan2(au, px - sx), rr = Math.max(0, Math.min(34 * u, (px - sx) * 0.4));
      ctx.strokeStyle = K.signal; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px, cy, rr, Math.PI, Math.PI + ang); ctx.stroke();
      text(ctx, `ϖ = ${plx.toFixed(3)}″`, clamp(px, sx + 60 * u, w - m - 34 * u), cy - 17 * u, { px: 11.5 * u, col: K.signal, align: 'center' });
      blob(ctx, px, cy, 10 * u, K.signal, 0.55); dot(ctx, px, cy, 3 * u, K.signal);
      const ay = h * 0.71;
      line(ctx, hair(px), cy + 8 * u, hair(px), ay, rgba(K.signal, 0.5), 1, [2, 3]);
      line(ctx, sx, hair(ay), DX(FAR), hair(ay), K.ruleStrong);
      for (let pc = 0; pc <= 5; pc++) { line(ctx, hair(DX(pc)), ay, hair(DX(pc)), ay + 4 * u, K.ruleStrong); text(ctx, pc === 5 ? '5 pc' : String(pc), DX(pc), ay + 15 * u, { px: 10 * u, col: K.faint, align: 'center' }); }
      line(ctx, hair(DX(1 / MEAS)), ay - 6 * u, hair(DX(1 / MEAS)), ay, K.ink); line(ctx, hair(DX(1 / PUB)), ay - 6 * u, hair(DX(1 / PUB)), ay, K.ink);
      text(ctx, `${'measured'} ≈ 2.0`, DX(1 / MEAS) - 3 * u, ay - 9 * u, { px: 10 * u, col: K.soft, align: 'right' });
      text(ctx, `${'published'} 2.28 pc`, DX(1 / PUB) + 3 * u, ay - 9 * u, { px: 10 * u, col: K.soft });
      line(ctx, hair(px), ay - 8 * u, hair(px), ay + 5 * u, K.signal, 1.5);
      const yb = h - m - 2 * u;
      text(ctx, `d = 1 / ${plx.toFixed(3)} = ${d.toFixed(2)} pc`, m, yb, { px: 12.5 * u, col: K.ink });
      text(ctx, `v = 4.74 × ${MU} × ${d.toFixed(2)} = ${v.toFixed(0)} km/s`, w - m, yb, { px: 12.5 * u, col: K.ink, align: 'right' });
    },
  };
}

async function loadExcess() {
  const res = await fetch('data/smdet1/candidate.json');
  if (!res.ok) throw new Error(`smdet1/candidate.json: ${res.status}`);
  const cd = await res.json(), names = ['2.4-3.8', '3.8-4.4', '4.4-5.0'], flux = (b, n) => (b && b[n] ? b[n].flux : NaN);
  const rows = cd.random.map(r => names.map(n => flux(r.bins, n))).filter(r => r.every(Number.isFinite)), T = names.map(n => flux(cd.bins, n));
  if (rows.length < 20 || !T.every(Number.isFinite)) throw new Error('smdet1: no controls');
  const D = { x: rows.map(r => r[0]), y: rows.map(r => r[2]), tx: T[0], ty: T[2], c: cd.colour_excess.bands['4.4-5.0'].c };
  const sx = Float64Array.from(D.x).sort();
  D.x0 = Math.min(sx[Math.floor(sx.length * 0.06)], D.tx - 200); D.x1 = Math.max(sx[Math.floor(sx.length * 0.94)], D.tx + 200);
  D.raw = excess(D, 0).sig;
  return D;
}
function excess(D, c) {
  const e = D.x.map((x, i) => D.y[i] - c * x), med = median(e), sig = madSigma(e, med), et = D.ty - c * D.tx - med;
  return { e: e.map(v => v - med), et, sig, n: e.filter(v => v - med >= et).length };
}
const excessScene = () => dataScene(0, loadExcess, (ctx, w, h, u, D, knob) => {
  const m = 18 * u, c = val(knob.c, D.c), X = excess(D, c);
  const x0 = m + 38 * u, x1 = w - m, top = m + 62 * u, bot = h - m - 30 * u, RNG = 4.3 * D.raw;
  const PX = v => lerp(x0 + 4 * u, x1 - 4 * u, clamp((v - D.x0) / (D.x1 - D.x0))), PY = v => lerp(bot - 3 * u, top + 3 * u, clamp((v + RNG) / (2 * RNG)));
  label(ctx, `SMDET-1 · ${D.x.length} empty positions`, m, m + 8 * u, { px: 9.5 * u });
  text(ctx, `c = ${c.toFixed(2)}`, m, m + 27 * u, { px: 13 * u, col: K.signal });
  text(ctx, `${'scatter'} σ = ${X.sig.toFixed(0)} µJy`, x1, m + 8 * u, { px: 12 * u, col: K.ink, align: 'right' });
  text(ctx, `${'target'} ${signed(X.et, 0)} µJy = ${(X.et / X.sig).toFixed(1)}σ`, x1, m + 25 * u, { px: 11 * u, col: K.signal, align: 'right' });
  text(ctx, `${X.n} / ${D.x.length} controls are at least this high`, x1, m + 41 * u, { px: 10.5 * u, col: K.soft, align: 'right' });
  ctx.fillStyle = rgba(K.signal, 0.1); ctx.fillRect(x0, PY(X.sig), x1 - x0, PY(-X.sig) - PY(X.sig));
  line(ctx, x0, hair(PY(X.sig)), x1, hair(PY(X.sig)), rgba(K.signal, 0.5)); line(ctx, x0, hair(PY(-X.sig)), x1, hair(PY(-X.sig)), rgba(K.signal, 0.5));
  line(ctx, hair(x0), top, hair(x0), bot, K.ruleStrong); line(ctx, x0, hair(bot), x1, hair(bot), K.ruleStrong);
  line(ctx, x0, hair(PY(0)), x1, hair(PY(0)), K.ruleStrong);
  for (const v of [-1000, 0, 1000]) { if (Math.abs(v) > RNG) continue; line(ctx, x0 - 4 * u, hair(PY(v)), x0, hair(PY(v)), K.ruleStrong); text(ctx, v ? signed(v, 0) : '0', x0 - 7 * u, PY(v) + 3.5 * u, { px: 10 * u, col: K.faint, align: 'right' }); }
  for (let v = Math.ceil(D.x0 / 1000) * 1000; v <= D.x1; v += 1000) { line(ctx, hair(PX(v)), bot, hair(PX(v)), bot + 4 * u, K.ruleStrong); text(ctx, minus(v), PX(v), bot + 15 * u, { px: 10 * u, col: K.faint, align: 'center' }); }
  for (let i = 0; i < X.e.length; i++) { const off = D.x[i] < D.x0 || D.x[i] > D.x1 || Math.abs(X.e[i]) > RNG; sq(ctx, PX(D.x[i]), PY(X.e[i]), 1.5 * u, rgba(K.ink, off ? 0.22 : 0.6)); }
  const tx = PX(D.tx), ty = PY(X.et), q = 5 * u;
  ctx.fillStyle = K.signal; ctx.beginPath(); ctx.moveTo(tx, ty - q); ctx.lineTo(tx + q, ty); ctx.lineTo(tx, ty + q); ctx.lineTo(tx - q, ty); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = K.deep; ctx.lineWidth = 1; ctx.stroke();
  text(ctx, 'target', tx + q + 4 * u, ty - q, { px: 10.5 * u, col: K.signal });
  text(ctx, `${'2.4–3.8 µm flux'}, µJy`, x1, bot + 28 * u, { px: 10 * u, col: K.faint, align: 'right' });
  text(ctx, `${'4.4–5.0 µm colour excess'}, µJy`, x0 + 6 * u, top + 11 * u, { px: 10 * u, col: K.faint });
}, () => ['Loading the control measurements…', 'The SMDET-1 control measurements could not be loaded; the numbers are in the text.']);

function sineFit(pts, P) {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0];
  for (const p of pts) {
    const wt = 1 / (p.e * p.e), ph = TAU * p.t / P, f = [1, Math.sin(ph), Math.cos(ph)];
    for (let i = 0; i < 3; i++) { b[i] += wt * f[i] * p.m; for (let j = 0; j < 3; j++) A[3 * i + j] += wt * f[i] * f[j]; }
  }
  const det3 = a => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const D = det3(A), c = [0, 1, 2].map(k => det3(A.map((v, i) => (i % 3 === k ? b[(i - k) / 3] : v))) / D);
  let chi2 = 0;
  for (const p of pts) { const ph = TAU * p.t / P; chi2 += ((p.m - c[0] - c[1] * Math.sin(ph) - c[2] * Math.cos(ph)) / p.e) ** 2; }
  return { c, chi2, amp: 2 * Math.hypot(c[1], c[2]) };
}
async function loadCurve() {
  const res = await fetch('data/rdra/variable.json');
  if (!res.ok) throw new Error(`rdra/variable.json: ${res.status}`);
  const lc = (await res.json()).light_curve, all = lc.mjd.map((t, i) => ({ t, m: lc.dmag[i], e: lc.e_dmag[i], n: lc.n[i] })).filter(p => Number.isFinite(p.m) && p.e > 0);
  const used = all.filter(p => p.n >= 5);
  if (used.length < 8) throw new Error('rdra: light curve too short');
  const scan = []; for (let P = 150; P <= 400; P += 0.5) scan.push(sineFit(used, P).chi2);
  const lo = Math.min(...scan);
  return { all, used, scan, lo, hi: Math.max(...scan), best: 150 + 0.5 * scan.indexOf(lo), t0: Math.min(...all.map(p => p.t)), t1: Math.max(...all.map(p => p.t)), published: 245.6 };
}
const curveScene = () => dataScene(0, loadCurve, (ctx, w, h, u, D, knob) => {
  const m = 18 * u, P = clamp(val(knob.p, D.best), 150, 400), f = sineFit(D.used, P);
  const x0 = m + 30 * u, x1 = w - m, top = m + 28 * u, bot = h * 0.57, span = D.t1 - D.t0;
  const mlo = Math.min(...D.all.map(p => p.m - p.e)) - 0.15, mhi = Math.max(...D.all.map(p => p.m + p.e)) + 0.15;
  const XX = t => lerp(x0 + 5 * u, x1 - 5 * u, (t - D.t0) / span), YY = v => lerp(bot - 2 * u, top, (v - mlo) / (mhi - mlo));
  label(ctx, `R Draconis · ${D.used.length} bins`, m, m + 8 * u, { px: 9.5 * u });
  text(ctx, 'up: brighter, magnitudes', x1, m + 8 * u, { px: 10 * u, col: K.faint, align: 'right' });
  line(ctx, hair(x0), top, hair(x0), bot, K.ruleStrong); line(ctx, x0, hair(bot), x1, hair(bot), K.ruleStrong);
  for (let v = Math.ceil(mlo); v <= mhi; v++) { line(ctx, x0 - 4 * u, hair(YY(v)), x0, hair(YY(v)), K.ruleStrong); if (!v) line(ctx, x0, hair(YY(0)), x1, hair(YY(0)), K.rule); text(ctx, v ? signed(v, 0) : '0', x0 - 7 * u, YY(v) + 3.5 * u, { px: 10 * u, col: K.faint, align: 'right' }); }
  for (let dday = 0; dday <= span; dday += 100) { line(ctx, hair(XX(D.t0 + dday)), bot, hair(XX(D.t0 + dday)), bot + 4 * u, K.ruleStrong); text(ctx, dday === 500 ? `500 ${'d'}` : String(dday), XX(D.t0 + dday), bot + 16 * u, { px: 10 * u, col: K.faint, align: 'center' }); }
  ctx.save(); ctx.beginPath(); ctx.rect(x0, top - 2, x1 - x0, bot - top + 2); ctx.clip();
  const sine = [];
  for (let t = D.t0 - 8; t <= D.t1 + 8; t += 2) { const ph = TAU * t / P; sine.push([XX(t), YY(f.c[0] + f.c[1] * Math.sin(ph) + f.c[2] * Math.cos(ph))]); }
  path(ctx, sine, K.signal, 1.4);
  for (const p of D.all) {
    const px = hair(XX(p.t)), on = p.n >= 5;
    line(ctx, px, YY(p.m - p.e), px, YY(p.m + p.e), rgba(K.ink, on ? 0.5 : 0.22));
    if (on) sq(ctx, px, YY(p.m), 2 * u, K.ink); else { ctx.fillStyle = K.deep; ctx.fillRect(px - 2 * u, YY(p.m) - 2 * u, 4 * u, 4 * u); ctx.strokeStyle = K.faint; ctx.lineWidth = 1; ctx.strokeRect(px - 2 * u, YY(p.m) - 2 * u, 4 * u, 4 * u); }
  }
  ctx.restore();
  const ry = bot + 40 * u;
  text(ctx, `P = ${P.toFixed(1)} ${'d'}`, x0, ry, { px: 13 * u, col: K.signal });
  text(ctx, `peak to peak ${f.amp.toFixed(2)} mag`, x0 + 104 * u, ry, { px: 10.5 * u, col: K.soft });
  text(ctx, `χ² = ${f.chi2.toFixed(1)} / ${D.used.length - 3}`, x1, ry, { px: 13 * u, col: K.ink, align: 'right' });
  const c0 = ry + 16 * u, c1 = h - m - 16 * u, CX = p => lerp(x0, x1, (p - 150) / 250), CY = c => lerp(c1, c0 + 3 * u, clamp(Math.log(c / D.lo) / Math.log(D.hi / D.lo)));
  line(ctx, x0, hair(c1), x1, hair(c1), K.ruleStrong);
  path(ctx, D.scan.map((c, i) => [CX(150 + 0.5 * i), CY(c)]), rgba(K.ink, 0.7));
  line(ctx, hair(CX(D.published)), c1 - 5 * u, hair(CX(D.published)), c1 + 4 * u, K.ink); line(ctx, hair(CX(D.best)), c1, hair(CX(D.best)), c1 + 4 * u, K.ink);
  text(ctx, `${'published'} ${D.published}`, CX(D.published) + 2 * u, c1 + 15 * u, { px: 10 * u, col: K.soft, align: 'right' });
  text(ctx, `${'best'} ${D.best.toFixed(0)}`, CX(D.best) + 5 * u, c1 + 15 * u, { px: 10 * u, col: K.soft });
  text(ctx, '150', x0, c1 + 15 * u, { px: 10 * u, col: K.faint }); text(ctx, `400 ${'d'}`, x1, c1 + 15 * u, { px: 10 * u, col: K.faint, align: 'right' });
  line(ctx, hair(CX(P)), c0, hair(CX(P)), c1, rgba(K.signal, 0.6));
  sq(ctx, CX(P), CY(f.chi2), 2.8 * u, K.signal);
}, () => ['Loading the light curve…', 'The R Draconis light curve could not be loaded; the numbers are in the text.']);

function stereoScene() {
  let S, knob;
  const DIST = 2.0, IPD = 0.063, PLATE = 1.6, FIELD = 49 * 6.15, ZMAX = 6.3;
  return {
    init(canvas) { S = surface(canvas); knob = knobs(canvas); },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, shift = val(knob.shift, 3), d = shift * PLATE / FIELD, fused = d < IPD * 0.999, Z = fused ? DIST * IPD / (IPD - d) : Infinity;
      const ye = h - m - 20 * u, zs = (ye - m - 14 * u) / ZMAX, cx = w * 0.6, xs = 0.15 * w / IPD, yp = ye - DIST * zs, el = cx - IPD * xs / 2, er = cx + IPD * xs / 2;
      const ax = cx - d * xs / 2, bx = cx + d * xs / 2, ZY = z => ye - z * zs;
      line(ctx, w * 0.26, hair(yp), w - m - 44 * u, hair(yp), K.ink);
      const fx = w * 0.36;
      line(ctx, el, ye, fx, yp, K.rule); line(ctx, er, ye, fx, yp, K.rule); dot(ctx, fx, yp, 2.6 * u, K.ink);
      text(ctx, 'fixed star', fx, yp - 9 * u, { px: 10 * u, col: K.soft, align: 'center' });
      const zend = fused && Z > DIST ? Math.min(Z, ZMAX) : fused ? DIST : ZMAX, far = (ex, px) => ex + (px - ex) * zend / DIST;
      line(ctx, el, ye, far(el, ax), ZY(zend), rgba(K.a, 0.85), 1.2); line(ctx, er, ye, far(er, bx), ZY(zend), rgba(K.b, 0.85), 1.2);
      dot(ctx, ax, yp, 3 * u, K.a); dot(ctx, bx, yp, 3 * u, K.b);
      if (fused && Z <= ZMAX) { ring(ctx, cx, ZY(Z), 6 * u, K.signal, 1.3); dot(ctx, cx, ZY(Z), 2.6 * u, K.signal); }
      ring(ctx, el, ye, 4 * u, K.a, 1.4); ring(ctx, er, ye, 4 * u, K.b, 1.4);
      text(ctx, 'left eye · A', el - 2 * u, ye + 17 * u, { px: 10 * u, col: K.a, align: 'right' });
      text(ctx, 'right eye · B', er + 2 * u, ye + 17 * u, { px: 10 * u, col: K.b });
      const dx = w - m - 26 * u;
      line(ctx, hair(dx), ye, hair(dx), ZY(ZMAX), K.ruleStrong);
      for (let z = 0; z <= 6; z++) { line(ctx, dx, hair(ZY(z)), dx + 4 * u, hair(ZY(z)), K.ruleStrong); if (z) text(ctx, z === 6 ? '6 m' : String(z), dx + 8 * u, ZY(z) + 3.5 * u, { px: 10 * u, col: K.faint }); }
      text(ctx, 'plate', dx - 6 * u, yp - 5 * u, { px: 10 * u, col: K.soft, align: 'right' });
      if (fused && Z <= ZMAX) line(ctx, dx - 6 * u, hair(ZY(Z)), dx + 5 * u, hair(ZY(Z)), K.signal, 1.5);
      label(ctx, 'seen from above', m, m + 8 * u, { px: 9.5 * u });
      text(ctx, `Δ = ${minus(shift.toFixed(1))}″`, m, m + 30 * u, { px: 13 * u, col: K.signal });
      text(ctx, `d = ${minus((d * 1000).toFixed(0))} mm`, m, m + 47 * u, { px: 11 * u, col: K.soft });
      if (fused) {
        const off = Z - DIST, where = Math.abs(off) < 0.005 ? 'on the plate' : off > 0 ? `${off.toFixed(2)} m behind the plate` : `${(-off).toFixed(2)} m in front of the plate`;
        text(ctx, `Z = ${Z.toFixed(2)} m`, m, m + 70 * u, { px: 15 * u, wt: 300, col: K.ink });
        text(ctx, where, m, m + 86 * u, { px: 10.5 * u, col: K.soft });
      } else {
        text(ctx, 'the lines never meet', m, m + 70 * u, { px: 12.5 * u, col: K.ink });
        text(ctx, 'the image doubles: no fusion', m, m + 86 * u, { px: 10.5 * u, col: K.soft });
      }
    },
  };
}

function wilson(k, n) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + 1 / n, c = p + 1 / (2 * n), h = Math.sqrt(p * (1 - p) / n + 1 / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
function wilsonScene() {
  let S, knob;
  const CELLS = [[6, 3, 0, 10], [6, 6, 0, 10], [6, 12, 1, 9], [10, 3, 0, 10], [10, 6, 1, 9], [10, 12, 9, 9], [16, 3, 1, 10], [16, 6, 9, 10], [16, 12, 10, 10]];
  return {
    init(canvas) { S = surface(canvas); knob = knobs(canvas); },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, k = clamp(Math.round(val(knob.k, 9)), 0, 10), x0 = m, bx0 = m + 142 * u, bx1 = w - m - 6 * u, y0 = m + 26 * u, yb = h - m - 22 * u, rh = (yb - y0) / 10;
      const X = p => lerp(bx0, bx1, p);
      label(ctx, 'rate found and Wilson interval', m, m + 8 * u, { px: 9.5 * u });
      for (const p of [0, 0.5, 1]) { line(ctx, hair(X(p)), y0, hair(X(p)), yb + 4 * u, p === 0.5 ? K.rule : K.ruleStrong); text(ctx, pct(p * 100), X(p), yb + 17 * u, { px: 10 * u, col: K.faint, align: 'center' }); }
      const row = (i, name, kk, n, col, soft) => {
        const y = y0 + (i + 0.5) * rh, [lo, hi] = wilson(kk, n);
        text(ctx, name, x0, y + 3.5 * u, { px: 10.5 * u, col: soft });
        text(ctx, `${kk} / ${n}`, bx0 - 12 * u, y + 3.5 * u, { px: 10.5 * u, col, align: 'right' });
        line(ctx, x0, hair(y + rh / 2), bx1, hair(y + rh / 2), K.rule);
        ctx.fillStyle = col; ctx.fillRect(X(lo), y - 1.5 * u, Math.max(2, X(hi) - X(lo)), 3 * u);
        line(ctx, hair(X(lo)), y - 5 * u, hair(X(lo)), y + 5 * u, col); line(ctx, hair(X(hi)), y - 5 * u, hair(X(hi)), y + 5 * u, col);
        sq(ctx, X(kk / n), y, 3.4 * u, K.deep); sq(ctx, X(kk / n), y, 2.4 * u, col);
        return [lo, hi];
      };
      const [lo, hi] = row(0, 'your choice', k, 10, K.signal, K.signal);
      text(ctx, `${pct(lo * 100)} – ${pct(hi * 100)}`, bx1, m + 8 * u, { px: 11.5 * u, col: K.signal, align: 'right' });
      CELLS.forEach(([snr, shift, kk, n], i) => row(i + 1, `S/N ${snr} · ${shift}″`, kk, n, K.ink, K.soft));
    },
  };
}

function costScene() {
  let S, knob;
  const HEAD = 2880 * 11, OVER = 750, NPIX = 2 * 24 + 1, PER = HEAD + OVER + NPIX * (4 * NPIX + OVER), CUT = 3.95e6, NMAX = 600;
  return {
    init(canvas) { S = surface(canvas); knob = knobs(canvas); },
    draw() {
      const { ctx, w, h, u } = S.fit();
      ctx.clearRect(0, 0, w, h);
      const m = 18 * u, x0 = m, x1 = w - m, bw = x1 - x0, N = clamp(Math.round(val(knob.n, 358)), 1, NMAX);
      label(ctx, 'one exposure', x0, m + 8 * u, { px: 9.5 * u });
      text(ctx, `${spaced(PER)} ${'bytes'}`, x1, m + 8 * u, { px: 11 * u, col: K.soft, align: 'right' });
      const by = m + 17 * u, bh = 18 * u, parts = [[HEAD, rgba(K.ink, 0.5)], [4 * NPIX * NPIX, K.signal], [(NPIX + 1) * OVER, rgba(K.ink, 0.2)]];
      let x = x0;
      const at = parts.map(([bytes, col]) => { const wd = bw * bytes / PER; ctx.fillStyle = col; ctx.fillRect(x, by, wd - 1.5, bh); x += wd; return x - wd; });
      const ly = by + bh + 15 * u;
      text(ctx, `${'header'} ${spaced(HEAD)}`, x0, ly, { px: 10 * u, col: K.soft });
      text(ctx, `${'pixels'} ${spaced(4 * NPIX * NPIX)}`, at[1] + bw * 4 * NPIX * NPIX / PER / 2, ly, { px: 10 * u, col: K.signal, align: 'center' });
      text(ctx, `${`overhead of ${NPIX + 1} requests`} ${spaced((NPIX + 1) * OVER)}`, x1, ly, { px: 10 * u, col: K.soft, align: 'right' });
      const nw = text(ctx, String(N), x0, h * 0.53, { px: 30 * u, wt: 300, col: K.ink });
      label(ctx, 'exposures', x0 + nw + 9 * u, h * 0.53, { px: 9.5 * u });
      const mb = v => (v < 1e9 ? `${(v / 1e6).toFixed(1)} MB` : `${(v / 1e9).toFixed(2)} GB`);
      const row = (y, name, per, bytes, col) => {
        const lw = label(ctx, name, x0, y, { px: 9.5 * u, col: K.soft });
        text(ctx, per, x0 + lw + 12 * u, y, { px: 10 * u, col: K.faint });
        text(ctx, mb(bytes), x1, y, { px: 14 * u, col: K.ink, align: 'right' });
        line(ctx, x0, hair(y + 10 * u), x1, hair(y + 10 * u), K.rule);
        ctx.fillStyle = col; ctx.fillRect(x0, y + 8 * u, Math.max(1.5, bw * bytes / (NMAX * CUT)), 4 * u);
      };
      row(h * 0.69, 'Ektos', `N × ${spaced(PER)} B`, N * PER, K.signal);
      row(h * 0.88, 'cutout service', 'N × 3.95 MB', N * CUT, rgba(K.ink, 0.6));
    },
  };
}

export const SCENES = {
  gnomonic: gnomonicScene, sky: skyScene, resample: resampleScene, stack: stackScene, psf: psfScene, centroid: centroidScene,
  cold: coldScene, motion: motionScene, distance: distanceScene, excess: excessScene, lightcurve: curveScene, stereo: stereoScene,
  wilson: wilsonScene, cost: costScene,
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

function readout(input) {
  const out = input.closest('.knob') && input.closest('.knob').querySelector('output');
  if (!out) return;
  const unit = input.dataset.uEn ?? input.dataset.u ?? '';
  out.textContent = minus(Number(input.value).toFixed(Number(input.dataset.d) || 0)) + unit;
}

export async function start(lang) {
  readTokens();
  traceProgress();
  for (const input of document.querySelectorAll('.knob input[type="range"]')) readout(input);
  await fontsReady();
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const items = [];
  for (const canvas of document.querySelectorAll('canvas[data-scene]')) {
    const make = SCENES[canvas.dataset.scene];
    if (!make) continue;
    const scene = make();
    try { scene.init(canvas, LANG); } catch (err) { console.warn('math: scene could not start:', canvas.dataset.scene, err); continue; }
    canvas.setAttribute('role', 'img');
    if (canvas.dataset[LANG]) canvas.setAttribute('aria-label', canvas.dataset[LANG]);
    items.push({ canvas, scene, t: 0, on: false, woke: false, dead: false });
  }
  const byCanvas = new Map(items.map(it => [it.canvas, it]));

  const paint = it => {
    if (it.dead || !it.canvas.clientWidth) return;
    try { it.scene.draw(still ? (it.scene.still || 0) : it.t); }
    catch (err) { it.dead = true; console.warn('math: scene stopped:', it.canvas.dataset.scene, err); }
  };
  const wake = it => {
    if (it.woke) return;
    it.woke = true;
    const p = it.scene.wake && it.scene.wake();
    if (p && p.then) p.then(() => paint(it));
  };

  for (const it of items) {
    const fig = it.canvas.closest('figure');
    if (fig) for (const input of fig.querySelectorAll('input[type="range"]')) input.addEventListener('input', () => { readout(input); paint(it); });
  }

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
