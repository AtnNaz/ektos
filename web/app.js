import * as E from './engine.js';
import { STR } from './i18n.js';
import { mountSite, currentLang } from './site.js';

const $ = id => document.getElementById(id);
const INK = '#E8ECF4', SOFT = '#9BA5B8', RULE = 'rgba(232,236,244,0.22)', PANEL = '#0A0E18', DARK = '#10151F';
const GLASS = [232, 236, 242];
const COL_A = [255, 111, 94], COL_B = [91, 181, 255], BRASS = '#E9B44C', WASH = 'rgba(233,180,76,0.15)';
const LAM_MIN = 0.7, LAM_MAX = 5.1;

const S = {
  lang: currentLang(),
  pkg: null, grid: null, slug: null, index: {}, epochs: [],
  mode: 'blink', stereo: 'anaglyph', axis: 0, band: 'W2s', lam: [4.0, 5.03],
  a: 0, b: 1, neg: false, cold: false, marks: true, playing: true, rate: 2.5, phase: 0, movie: false, frameIdx: 0,
  probe: null, follow: false, entered: null, timer: null, fov: null, engine: null,
  gen: 0, findSeq: 0, dragging: false, kb: null, kbOn: false,
};
const REPEAT = 0.15;
const t = (k, v = {}) => (STR[S.lang][k] ?? STR.en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');

function wiseBandFor(lam) {
  const mid = 0.5 * (lam[0] + lam[1]);
  if (!S.pkg.wise) return null;
  if (lam[1] >= 4.0 && mid > 3.9 && S.pkg.wise.W2) return 'W2';
  if (lam[0] <= 3.8 && lam[1] >= 2.8 && S.pkg.wise.W1) return 'W1';
  return null;
}
const lamKey = lam => `${lam[0].toFixed(3)}|${lam[1].toFixed(3)}`;
function allFrame(g = S.grid) {
  const key = `all|${lamKey(S.lam)}|${g.n}`;
  if (!S.pkg.cache.has(key)) S.pkg.cache.set(key, E.combine(S.pkg, E.select(S.pkg, { lam: S.lam }), g));
  return S.pkg.cache.get(key);
}
const fullGrid = () => E.makeGrid(S.pkg.man.grid.n, S.pkg.man.grid.scale);
const CACHE_KEEP = 24, COLD_WINDOWS = [[4.0, 5.03], [3.0, 3.8]];
function trimCache() {
  const c = S.pkg && S.pkg.cache;
  if (!c || c.size <= CACHE_KEEP) return;
  const live = [lamKey(S.lam), ...(S.cold ? COLD_WINDOWS.map(lamKey) : [])];
  let extra = c.size - CACHE_KEEP;
  for (const k of [...c.keys()]) {
    if (extra <= 0) break;
    if (live.some(l => k.includes(l))) continue;
    c.delete(k); extra--;
  }
}
const WSCALE = new WeakMap();
function wiseScale(band, exact) {
  let memo = WSCALE.get(S.pkg);
  if (!memo) WSCALE.set(S.pkg, memo = new Map());
  const sKey = `${band}|${lamKey(S.lam)}`;
  if (memo.has(sKey)) return { ...memo.get(sKey), exact: true };
  if (!exact && memo.has(band)) return { ...memo.get(band), exact: false };
  const full = S.pkg.wise[band], ref = allFrame(fullGrid()), ws = E.robustStats(full), rs = E.robustStats(ref.img), ratios = [];
  for (let p = 0; p < full.length; p++) {
    const a = full[p] - ws.med, b = ref.img[p] - rs.med;
    if (a > 12 * ws.sig && b > 12 * rs.sig) ratios.push(b / a);
  }
  ratios.sort((x, y) => x - y);
  const sc = { s: ratios.length > 8 ? ratios[ratios.length >> 1] : rs.sig / ws.sig, med: ws.med, sig: ws.sig, n: ratios.length };
  memo.set(sKey, sc); memo.set(band, sc);
  return { ...sc, exact: true };
}
function wiseFrame(band) {
  const key = `wise|${band}|${lamKey(S.lam)}|${S.grid.n}`;
  if (S.pkg.cache.has(key)) return S.pkg.cache.get(key);
  const full = S.pkg.wise[band], { s, med, sig, n, exact } = wiseScale(band, !S.dragging), w = E.cropCentered(full, S.pkg.man.grid.n, S.grid.n);
  const img = new Float32Array(w.length), err = new Float32Array(w.length).fill(sig * s);
  for (let p = 0; p < w.length; p++) img[p] = (w[p] - med) * s;
  const fr = { img, err, cnt: null, used: 0, scaled: s, nmatch: n };
  if (exact) S.pkg.cache.set(key, fr);
  return fr;
}
const wiseInPair = () => [S.a, S.b].some(i => S.epochs[i] && S.epochs[i].kind === 'wise');
const coldOn = () => S.cold && !wiseInPair();
const coldAvailable = () => S.pkg.man.visits.some(v => v.star_colour_w2w1);
function epochFrame(i) {
  const ep = S.epochs[i];
  if (!ep) return null;
  if (ep.kind === 'wise') { const b = !coldOn() && wiseBandFor(S.lam); return b ? wiseFrame(b) : null; }
  if (coldOn()) return E.coldFilter(S.pkg, S.grid, ep.visit);
  return E.frame(S.pkg, S.grid, ep.visit, S.lam);
}
function movieList(lazy = false) {
  const out = [];
  S.epochs.forEach((ep, idx) => {
    if (lazy && !coldOn()) {
      if (ep.kind === 'wise' ? wiseBandFor(S.lam) : E.select(S.pkg, { visit: ep.visit, lam: S.lam }).length >= 3) out.push({ idx, fr: null });
      return;
    }
    const fr = epochFrame(idx);
    if (fr && (ep.kind === 'wise' || fr.used >= 3)) out.push({ idx, fr });
  });
  return out;
}
function epochLabel(i, short = false) {
  const ep = S.epochs[i];
  if (!ep) return '';
  if (ep.kind === 'wise') return short ? `${ep.from.slice(0, 4)} WISE` : `${ep.from} – ${ep.to}, WISE ${wiseBandFor(S.lam) || ''}`;
  return short ? ep.from.slice(0, 7) : `${ep.from} – ${ep.to}, SPHEREx`;
}

function limits(frames) {
  let sig = 0, hi = 0;
  const meds = frames.map(f => { const s = E.robustStats(f.img); sig = Math.max(sig, s.sig); hi = Math.max(hi, s.hi - s.med); return s.med; });
  return { meds, lo: -2.5 * sig, hi: Math.max(hi, 14 * sig), sig };
}
const stretch = (v, lo, hi) => { const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return Math.asinh(x / 0.08) / Math.asinh(1 / 0.08); };

function small(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }
function grayCanvas(fr, med, lo, hi, neg) {
  const n = S.grid.n, c = small(n), ctx = c.getContext('2d'), id = ctx.createImageData(n, n);
  for (let p = 0; p < n * n; p++) {
    const v = fr.img[p];
    let g = v === v ? stretch(v - med, lo, hi) : 0;
    if (neg) g = 1 - g;
    const o = p * 4;
    if (v !== v) { id.data[o] = id.data[o + 1] = id.data[o + 2] = neg ? 216 : 30; id.data[o + 3] = 255; continue; }
    id.data[o] = neg ? GLASS[0] * g : 255 * g; id.data[o + 1] = neg ? GLASS[1] * g : 255 * g; id.data[o + 2] = neg ? GLASS[2] * g : 255 * g; id.data[o + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
function anaglyphCanvas(fa, fb, L) {
  const n = S.grid.n, c = small(n), ctx = c.getContext('2d'), id = ctx.createImageData(n, n);
  for (let p = 0; p < n * n; p++) {
    let ga = fa.img[p] === fa.img[p] ? stretch(fa.img[p] - L.meds[0], L.lo, L.hi) : 0;
    let gb = fb.img[p] === fb.img[p] ? stretch(fb.img[p] - L.meds[1], L.lo, L.hi) : 0;
    if (S.neg) { ga = 1 - ga; gb = 1 - gb; }
    const o = p * 4;
    id.data[o] = 255 * ga; id.data[o + 1] = 255 * gb; id.data[o + 2] = 255 * gb; id.data[o + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
function diffCanvas(fa, fb, L) {
  const n = S.grid.n, c = small(n), ctx = c.getContext('2d'), id = ctx.createImageData(n, n);
  const bg = S.neg ? GLASS : [8, 11, 18], scale = 9 * L.sig;
  for (let p = 0; p < n * n; p++) {
    const d = (fb.img[p] - L.meds[1]) - (fa.img[p] - L.meds[0]), o = p * 4;
    if (d !== d) { id.data[o] = id.data[o + 1] = id.data[o + 2] = S.neg ? 216 : 30; id.data[o + 3] = 255; continue; }
    const x = Math.min(1, Math.abs(d) / scale), col = d > 0 ? COL_B : COL_A, k = Math.pow(x, 0.8);
    for (let j = 0; j < 3; j++) id.data[o + j] = bg[j] + (col[j] - bg[j]) * k;
    id.data[o + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

const MIN_TEXT = 11;
function fontPx(cv, base) {
  const w = cv.getBoundingClientRect().width;
  return w > 0 ? Math.max(base, Math.ceil(MIN_TEXT * cv.width / w)) : base;
}
const PL = { size: 900, m: 52 };
function plateXY(xi, eta) {
  const w = PL.size - 2 * PL.m, f = w / (S.grid.n * S.grid.scale);
  return [PL.size / 2 - xi * f, PL.size / 2 - eta * f];
}
function drawImageRot(ctx, img, x, y, w, h, deg) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x + w / 2, y + h / 2); ctx.rotate(deg * Math.PI / 180);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const k = Math.abs(deg) % 90 === 0 ? 1 : 1.0;
  ctx.drawImage(img, -w / 2 * k, -h / 2 * k, w * k, h * k);
  ctx.restore();
}

function drawPlate() {
  const cv = $('plate'), ctx = cv.getContext('2d'), { size, m } = PL, w = size - 2 * m, fz = base => fontPx(cv, base);
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, size, size);
  if (!S.pkg) return;
  const fa = epochFrame(S.a), fb = epochFrame(S.b);
  let shown = null, caption = '';
  const lamTxt = coldOn() && S.mode !== 'sum' ? t('coldBand') : `${S.lam[0].toFixed(2)}–${S.lam[1].toFixed(2)} µm`;

  if (S.mode === 'sum') {
    const fr = allFrame(), L = limits([fr]);
    drawImageRot(ctx, grayCanvas(fr, L.meds[0], L.lo, L.hi, S.neg), m, m, w, w, 0);
    caption = t('capSum', { n: fr.used, lam: lamTxt, v: S.pkg.man.visits.length });
    shown = { mjd: null };
  } else if (S.mode === 'blink' && S.movie) {
    const list = movieList(S.dragging);
    if (list.length) {
      const key = `mlim|${lamKey(S.lam)}|${coldOn()}|${S.grid.n}`, i = S.frameIdx % list.length, cur = list[i];
      let L, med;
      if (!cur.fr) { cur.fr = epochFrame(cur.idx); L = limits([cur.fr]); med = L.meds[0]; }
      else {
        if (!S.pkg.cache.has(key)) S.pkg.cache.set(key, limits(list.map(x => x.fr)));
        L = S.pkg.cache.get(key); med = L.meds[i];
      }
      drawImageRot(ctx, grayCanvas(cur.fr, med, L.lo, L.hi, S.neg), m, m, w, w, 0);
      shown = { mjd: S.epochs[cur.idx].mjd, tag: cur.idx === S.a ? 'A' : cur.idx === S.b ? 'B' : '·', idx: cur.idx };
      caption = t('capMovie', { lam: lamTxt, i: i + 1, n: list.length });
    } else {
      ctx.fillStyle = SOFT; ctx.font = `500 ${fz(22)}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(t('noFrames'), size / 2, size / 2);
    }
  } else if (!fa || !fb) {
    ctx.fillStyle = SOFT; ctx.font = `500 ${fz(22)}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(t(S.epochs.length < 2 ? 'oneEpoch' : 'noWise'), size / 2, size / 2);
  } else {
    const L = limits([fa, fb]);
    if (S.mode === 'blink') {
      const which = S.phase ? S.b : S.a, fr = S.phase ? fb : fa;
      drawImageRot(ctx, grayCanvas(fr, L.meds[S.phase], L.lo, L.hi, S.neg), m, m, w, w, 0);
      shown = { mjd: S.epochs[which].mjd, tag: S.phase ? 'B' : 'A', idx: which };
      caption = t('capBlink', { lam: lamTxt, na: fa.used || '—', nb: fb.used || '—' });
    } else if (S.mode === 'diff') {
      drawImageRot(ctx, diffCanvas(fa, fb, L), m, m, w, w, 0);
      caption = t('capDiff', { lam: lamTxt, a: epochLabel(S.a, true), b: epochLabel(S.b, true) });
      shown = { mjd: null };
    } else if (S.stereo === 'anaglyph') {
      drawImageRot(ctx, anaglyphCanvas(fa, fb, L), m, m, w, w, S.axis);
      caption = t('capAnaglyph', { a: epochLabel(S.a, true), b: epochLabel(S.b, true) });
    } else {
      const ca = grayCanvas(fa, L.meds[0], L.lo, L.hi, S.neg), cb = grayCanvas(fb, L.meds[1], L.lo, L.hi, S.neg), hw = w / 2 - 6;
      drawImageRot(ctx, ca, m, m + w / 4, hw, hw, S.axis);
      drawImageRot(ctx, cb, m + w / 2 + 6, m + w / 4, hw, hw, S.axis);
      ctx.fillStyle = `rgb(${COL_A})`; ctx.font = `600 ${fz(20)}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'left';
      ctx.fillText('A  ' + epochLabel(S.a, true), m, m + w / 4 - 12);
      ctx.fillStyle = `rgb(${COL_B})`; ctx.fillText('B  ' + epochLabel(S.b, true), m + w / 2 + 6, m + w / 4 - 12);
      caption = t('capSide');
    }
  }
  const cf = coldOn() && [fa, fb].find(f => f && f.k);
  if (cf) caption += ' ' + t(cf.kDefault ? 'capColdDefault' : 'capCold', { k: cf.k.toFixed(2), n: cf.kn });
  if (S.cold && S.mode !== 'sum') { const why = coldWhy(); if (why) caption += ' ' + why; }

  const field = S.grid.n * S.grid.scale, f = w / field, tickPx = fz(17), off = Math.max(28, 16 + tickPx / 2);
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1.5; ctx.strokeRect(m, m, w, w);
  ctx.font = `500 ${tickPx}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const side = !(S.mode === 'stereo');
  if (side) {
    for (let a = -Math.floor(field / 60) * 30; a <= field / 2; a += 30) {
      const p = size / 2 + a * f, major = a % 60 === 0, len = major ? 12 : 6;
      ctx.beginPath(); ctx.moveTo(p, m); ctx.lineTo(p, m - len); ctx.moveTo(p, size - m); ctx.lineTo(p, size - m + len);
      ctx.moveTo(m, p); ctx.lineTo(m - len, p); ctx.moveTo(size - m, p); ctx.lineTo(size - m + len, p); ctx.stroke();
      if (major && a !== 0) { ctx.fillText(`${Math.abs(a) / 60}′`, p, size - m + off); ctx.fillText(`${Math.abs(a) / 60}′`, m - off, p); }
    }
    ctx.font = `650 ${fz(19)}px "IBM Plex Sans", sans-serif`;
    ctx.fillText(t('north'), size / 2, m - off); ctx.fillText(t('east'), m - off, size / 2);
  }

  if (S.marks && side && S.mode !== 'stereo') drawOverlays(ctx, shown, m, w, fz);

  if (S.mode === 'blink' && shown && shown.tag) {
    const col = shown.tag === 'A' ? COL_A : shown.tag === 'B' ? COL_B : [58, 68, 92];
    const label = shown.tag === '·' ? epochLabel(shown.idx) : `${shown.tag}   ${epochLabel(shown.idx)}`, tagPx = fz(24);
    ctx.font = `600 ${tagPx}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = `rgb(${col})`; ctx.fillRect(m, m, tw + 28, Math.round(tagPx * 1.75));
    ctx.fillStyle = '#fff'; ctx.fillText(label, m + 14, m + Math.round(tagPx * 1.2));
  }
  drawCursor(ctx);
  $('caption').textContent = caption;
}
function coldWhy() {
  if (!S.cold || !S.pkg.man.wise) return '';
  if (wiseInPair()) return t('coldWise');
  return S.mode === 'blink' && S.movie ? t('coldMovie') : '';
}
function drawCursor(ctx) {
  if (!S.kbOn || !S.kb || (S.mode === 'stereo' && !S.exp)) return;
  const { size, m } = PL, w = size - 2 * m;
  let spots;
  if (S.mode === 'stereo' && S.stereo === 'side') {
    const hw = w / 2 - 6, top = m + w / 4, g = hw / (S.grid.n * S.grid.scale);
    spots = [m, m + w / 2 + 6].map(left => [left + hw / 2 - S.kb.xi * g, top + hw / 2 - S.kb.eta * g]);
  } else spots = [plateXY(S.kb.xi, S.kb.eta)];
  ctx.save(); ctx.strokeStyle = BRASS; ctx.lineWidth = 2;
  for (const [x, y] of spots) {
    ctx.strokeRect(x - 12, y - 12, 24, 24);
    ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
  }
  ctx.restore();
}

function drawOverlays(ctx, shown, m, w, fz = b => b) {
  const man = S.pkg.man, inside = (x, y) => x > m + 4 && x < m + w - 4 && y > m + 4 && y < m + w - 4;
  ctx.save(); ctx.beginPath(); ctx.rect(m, m, w, w); ctx.clip();
  const mjd = shown && shown.mjd ? shown.mjd : man.visits[man.visits.length - 1].mjd;
  if (man.gaia) {
    ctx.strokeStyle = S.neg ? 'rgba(24,33,30,0.45)' : 'rgba(244,246,241,0.55)'; ctx.lineWidth = 1.2;
    if (!man._bright) man._bright = man.gaia.filter(g => g.g < 17.5).sort((p, q) => p.g - q.g).slice(0, 60);
    for (const g of man._bright) {
      const ast = { ra: g.ra, dec: g.dec, epoch: 2016.0, pmra: (g.pmra || 0) / 1000, pmdec: (g.pmdec || 0) / 1000, plx: (g.plx || 0) / 1000 };
      const [xi, eta] = E.apparentXiEta(ast, mjd, man.center), [x, y] = plateXY(xi, eta);
      if (!inside(x, y)) continue;
      ctx.beginPath(); ctx.arc(x, y, 13, 0, 2 * Math.PI); ctx.stroke();
    }
  }
  if (man.astrometry) {
    const ast = man.astrometry, [x0, y0] = plateXY(...E.tanProject(ast.ra, ast.dec, man.center[0], man.center[1]));
    const [x1, y1] = plateXY(...E.apparentXiEta(ast, mjd, man.center));
    ctx.strokeStyle = BRASS; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    const br = (x, y, r) => { for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(x + sx * r, y + sy * (r - 9)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - 9), y + sy * r); ctx.stroke(); } };
    br(x1, y1, 22);
    ctx.fillStyle = BRASS; ctx.font = `600 ${fz(17)}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(String(Math.floor(ast.epoch)), x0, y0 - 14);
    ctx.beginPath(); ctx.arc(x0, y0, 4, 0, 2 * Math.PI); ctx.fill();
  }
  if (S.probe) {
    const [x, y] = plateXY(S.probe.xi, S.probe.eta);
    ctx.strokeStyle = S.neg ? DARK : '#fff'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 9, y); ctx.moveTo(x + 9, y); ctx.lineTo(x + 26, y);
    ctx.moveTo(x, y - 26); ctx.lineTo(x, y - 9); ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 26); ctx.stroke();
  }
  ctx.restore();
}

function buildEpochs() {
  const man = S.pkg.man;
  S.epochs = [];
  if (man.wise) S.epochs.push({ kind: 'wise', mjd: 0.5 * (man.wise.mjd[0] + man.wise.mjd[1]), from: man.wise.from, to: man.wise.to });
  man.visits.forEach((v, i) => S.epochs.push({ kind: 'spx', visit: i, mjd: v.mjd, from: v.from, to: v.to }));
}
function renderEpochs() {
  const box = $('epochs'); box.innerHTML = '';
  S.epochs.forEach((ep, i) => {
    const row = document.createElement('div'); row.className = 'epoch' + (i === S.a ? ' is-a' : '') + (i === S.b ? ' is-b' : '');
    const n = ep.kind === 'wise' ? (wiseBandFor(S.lam) ? '' : null) : E.select(S.pkg, { visit: ep.visit, lam: S.lam }).length;
    row.dataset.empty = (n === null || n === 0) ? 'true' : 'false';
    const mk = (cls, on, label) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pick ' + cls; b.textContent = label; b.setAttribute('aria-pressed', on); b.title = t(cls === 'a' ? 'pickA' : 'pickB'); b.setAttribute('aria-label', `${b.title}: ${ep.from} – ${ep.to}`); b.onclick = () => { S[cls] = i; refresh(); }; return b; };
    const info = document.createElement('div');
    info.innerHTML = `<div class="when">${ep.from} – ${ep.to}</div><div class="what">${ep.kind === 'wise' ? t('wiseWhat', { b: wiseBandFor(S.lam) || 'W1 / W2' }) : 'SPHEREx'}</div>`;
    const cnt = document.createElement('div'); cnt.className = 'count';
    cnt.textContent = ep.kind === 'wise' ? (n === null ? t('outOfBand') : t('atlas')) : t('nExp', { n });
    row.append(mk('a', i === S.a, 'A'), mk('b', i === S.b, 'B'), info, cnt);
    box.append(row);
  });
}

const SM = { w: 760, h: 230, left: 104, right: 14, top: 26, bottom: 30 };
const smX = lam => SM.left + (lam - LAM_MIN) / (LAM_MAX - LAM_MIN) * (SM.w - SM.left - SM.right);
const smLam = x => LAM_MIN + (x - SM.left) / (SM.w - SM.left - SM.right) * (LAM_MAX - LAM_MIN);
function drawSampling() {
  const cv = $('sampling'), ctx = cv.getContext('2d'), man = S.pkg.man, fs = fontPx(cv, 15), font = wt => `${wt} ${fs}px "IBM Plex Sans", sans-serif`;
  const labels = S.epochs.map((_, r) => (r === S.a ? 'A ' : r === S.b ? 'B ' : '') + epochLabel(r, true));
  ctx.font = font(650);
  SM.left = Math.max(104, Math.ceil(16 + Math.max(0, ...labels.map(s => ctx.measureText(s).width))));
  SM.top = Math.max(26, fs + 11); SM.bottom = Math.max(30, fs + 15);
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, SM.w, SM.h);
  const rows = S.epochs.length, rh = (SM.h - SM.top - SM.bottom) / rows, rowY = r => SM.top + r * rh + rh / 2;
  ctx.fillStyle = WASH; ctx.fillRect(smX(S.lam[0]), SM.top - 4, smX(S.lam[1]) - smX(S.lam[0]), SM.h - SM.top - SM.bottom + 8);
  ctx.strokeStyle = BRASS; ctx.lineWidth = 2;
  for (const l of S.lam) { ctx.beginPath(); ctx.moveTo(smX(l), SM.top - 4); ctx.lineTo(smX(l), SM.h - SM.bottom + 4); ctx.stroke(); }
  ctx.font = font(500); ctx.textBaseline = 'middle';
  for (const [name, lo, hi] of [['D1', .73, 1.13], ['D2', 1.08, 1.67], ['D3', 1.61, 2.44], ['D4', 2.39, 3.87], ['D5', 3.79, 4.45], ['D6', 4.40, 5.03]]) {
    ctx.fillStyle = SOFT; ctx.textAlign = 'center'; ctx.fillText(name, smX((lo + hi) / 2), SM.top - 14);
    ctx.strokeStyle = RULE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(smX(lo), SM.top - 6); ctx.lineTo(smX(lo), SM.top - 2); ctx.stroke();
  }
  const written = [];
  for (const r of [S.a, S.b, ...S.epochs.map((_, i) => i)]) {
    const y = rowY(r);
    if (!S.epochs[r] || written.some(v => Math.abs(v - y) < fs * 1.05)) continue;
    written.push(y);
    ctx.fillStyle = r === S.a ? `rgb(${COL_A})` : r === S.b ? `rgb(${COL_B})` : INK; ctx.textAlign = 'left';
    ctx.font = font(r === S.a || r === S.b ? 650 : 450);
    ctx.fillText(labels[r], 6, y);
  }
  S.epochs.forEach((ep, r) => {
    const y = rowY(r);
    if (ep.kind === 'wise') {
      ctx.fillStyle = 'rgba(232,236,244,0.2)';
      for (const [lo, hi] of [[2.8, 3.8], [4.0, 5.1]]) ctx.fillRect(smX(lo), y - rh * 0.22, smX(hi) - smX(lo), rh * 0.44);
      return;
    }
    for (const e of man.exposures) {
      if (e.v !== ep.visit) continue;
      const inWin = e.lam >= S.lam[0] && e.lam <= S.lam[1];
      ctx.strokeStyle = inWin ? INK : 'rgba(232,236,244,0.3)'; ctx.lineWidth = inWin ? 1.8 : 1.1;
      ctx.beginPath(); ctx.moveTo(smX(e.lam), y - rh * 0.3); ctx.lineTo(smX(e.lam), y + rh * 0.3); ctx.stroke();
    }
  });
  const ny = SM.h - SM.bottom + 10 + fs / 2;
  ctx.fillStyle = SOFT; ctx.textAlign = 'center'; ctx.font = font(450);
  for (let l = 1; l <= 5; l++) { ctx.fillText(String(l), smX(l), ny); ctx.strokeStyle = RULE; ctx.beginPath(); ctx.moveTo(smX(l), SM.h - SM.bottom + 4); ctx.lineTo(smX(l), SM.h - SM.bottom + 9); ctx.stroke(); }
  const unitW = ctx.measureText('µm').width, fiveEnd = smX(5) + ctx.measureText('5').width / 2 + 6;
  if (SM.w - 6 - unitW > fiveEnd) { ctx.textAlign = 'right'; ctx.fillText('µm', SM.w - 6, ny); } else { ctx.textAlign = 'left'; ctx.fillText('µm', 6, ny); }
}
function onFrame(fn) {
  let done = false;
  const go = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(tmo); fn(); };
  const raf = requestAnimationFrame(go), tmo = setTimeout(go, 50);
  return () => { done = true; cancelAnimationFrame(raf); clearTimeout(tmo); };
}
function wireSampling() {
  const cv = $('sampling'); let drag = null, pending = null, cancel = null;
  const lamAt = ev => { const r = cv.getBoundingClientRect(); return Math.min(LAM_MAX, Math.max(LAM_MIN, smLam((ev.clientX - r.left) / r.width * SM.w))); };
  const apply = () => { cancel = null; if (!pending) return; S.lam = pending; pending = null; S.band = null; S.cold = false; refresh(false); };
  const end = (ev, release) => {
    if (drag === null) return;
    if (cancel) cancel(); cancel = null; pending = null;
    const l = lamAt(ev);
    if (release && Math.abs(l - drag) < 0.03) { const half = (S.lam[1] - S.lam[0]) / 2; S.lam = [Math.max(LAM_MIN, l - half), Math.min(LAM_MAX, l + half)]; S.band = null; S.cold = false; }
    else if (release) { S.lam = [Math.min(drag, l), Math.max(drag, l)]; S.band = null; S.cold = false; }
    drag = null; S.dragging = false; refresh();
  };
  cv.addEventListener('pointerdown', ev => { drag = lamAt(ev); S.dragging = true; try { cv.setPointerCapture(ev.pointerId); } catch (err) {  } });
  cv.addEventListener('pointermove', ev => {
    if (drag === null) return;
    const l = lamAt(ev); if (Math.abs(l - drag) < 0.03) return;
    pending = [Math.min(drag, l), Math.max(drag, l)];
    if (!cancel) cancel = onFrame(apply);
  });
  cv.addEventListener('pointerup', ev => end(ev, true));
  cv.addEventListener('pointercancel', ev => end(ev, false));
}
function renderBands() {
  const box = $('bands'); box.innerHTML = '';
  const bands = { ...S.pkg.man.bands, [t('allBands')]: [0.73, 5.03] };
  for (const [name, [lo, hi]] of Object.entries(bands)) {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = name === 'W1s' ? t('w1s') : name === 'W2s' ? t('w2s') : name;
    b.setAttribute('aria-pressed', S.band === name);
    b.onclick = () => { S.band = name; S.lam = [lo, hi]; S.cold = false; refresh(); };
    box.append(b);
  }
}

function trackFor(probe) {
  const man = S.pkg.man;
  if (S.follow && man.astrometry) return mjd => E.apparentXiEta(man.astrometry, mjd, man.center);
  return () => [probe.xi, probe.eta];
}
function drawSpectrum() {
  const cv = $('spec'), ctx = cv.getContext('2d'), W = 760, H = 340, R = 14, T = 16, fs = fontPx(cv, 15);
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, W, H);
  const man = S.pkg.man, probe = S.probe || (S.follow && man.astrometry ? { xi: 0, eta: 0 } : null);
  $('specHint').textContent = probe ? (S.follow && man.astrometry ? t('specFollow') : t('specAt', coordsOf(probe))) : t('spectrumHint');
  if (!probe) return;
  const pts = E.spectrum(S.pkg, trackFor(probe));
  if (pts.length < 5) return;
  const fl = pts.map(p => p.flux).sort((a, b) => a - b), q = f => fl[Math.min(fl.length - 1, Math.floor(f * fl.length))];
  let lo = Math.min(0, q(0.03)), hi = q(0.985); const pad = 0.12 * (hi - lo || 1); lo -= pad; hi += pad;
  const unit = Math.max(Math.abs(hi), Math.abs(lo)) > 5000 ? 1000 : 1, step = niceStep((hi - lo) / 4), ticks = [];
  for (let f = Math.ceil(lo / step) * step; f <= hi; f += step) ticks.push([f, (f / unit).toFixed(step / unit < 1 ? 1 : 0)]);
  ctx.font = `450 ${fs}px "IBM Plex Sans", sans-serif`;
  const ux = Math.max(16, fs / 2 + 4), L = Math.max(78, Math.ceil(ux + fs / 2 + 12 + Math.max(0, ...ticks.map(k => ctx.measureText(k[1]).width)))), B = Math.max(44, 2 * fs + 12);
  const X = l => L + (l - LAM_MIN) / (LAM_MAX - LAM_MIN) * (W - L - R), Y = f => H - B - (f - lo) / (hi - lo) * (H - T - B);
  ctx.fillStyle = WASH; ctx.fillRect(X(S.lam[0]), T, X(S.lam[1]) - X(S.lam[0]), H - T - B);
  ctx.strokeStyle = RULE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(W - R, Y(0)); ctx.stroke();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H - B); ctx.lineTo(W - R, H - B); ctx.stroke();
  ctx.fillStyle = SOFT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let l = 1; l <= 5; l++) ctx.fillText(String(l), X(l), H - B + 6 + fs / 2);
  ctx.fillText('µm', W - R - 12, H - 2 - fs / 2);
  ctx.textAlign = 'right';
  for (const [f, s] of ticks) ctx.fillText(s, L - 8, Y(f));
  ctx.save(); ctx.translate(ux, (T + H - B) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(unit === 1000 ? 'mJy' : 'µJy', 0, 0); ctx.restore();
  const va = S.epochs[S.a] && S.epochs[S.a].kind === 'spx' ? S.epochs[S.a].visit : -1, vb = S.epochs[S.b] && S.epochs[S.b].kind === 'spx' ? S.epochs[S.b].visit : -1;
  for (const pass of [0, 1]) for (const p of pts) {
    const hot = p.v === va || p.v === vb; if (hot !== !!pass) continue;
    const col = p.v === va ? `rgb(${COL_A})` : p.v === vb ? `rgb(${COL_B})` : 'rgba(155,165,184,0.5)';
    const x = X(p.lam), y = Math.max(T, Math.min(H - B, Y(p.flux)));
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Math.max(T, Y(p.flux + p.err))); ctx.lineTo(x, Math.min(H - B, Y(p.flux - p.err))); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, hot ? 3.4 : 2.6, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); let started = false;
  for (let l = 0.74; l < 5.04;) {
    const dw = l < 3.8 ? l / 40 : l / 120 * 2, sel = pts.filter(p => p.lam >= l && p.lam < l + dw);
    if (sel.length >= 2) { let sw = 0, s = 0; for (const p of sel) { const w = 1 / (p.err * p.err); sw += w; s += w * p.flux; } const x = X(l + dw / 2), y = Math.max(T, Math.min(H - B, Y(s / sw))); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; }
    l += dw;
  }
  ctx.stroke();
}
const niceStep = raw => { const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };
function coordsOf(p) { const [ra, dec] = E.tanDeproject(p.xi, p.eta, S.pkg.man.center[0], S.pkg.man.center[1]); return { ra: E.fmtRA(ra), dec: E.fmtDec(dec) }; }

function probeAt(i) {
  const man = S.pkg.man;
  if (S.probe.target && man.astrometry && S.epochs[i]) { const [xi, eta] = E.apparentXiEta(man.astrometry, S.epochs[i].mjd, man.center); return { xi, eta }; }
  return S.probe;
}
function renderMeasure() {
  const box = $('measure'), man = S.pkg.man;
  if (!S.probe) { box.innerHTML = `<p class="hint">${t('measureHint')}</p>`; return; }
  const fa = epochFrame(S.a), fb = epochFrame(S.b), qa = probeAt(S.a), qb = probeAt(S.b);
  const inPlate = q => Math.max(Math.abs(q.xi), Math.abs(q.eta)) < S.grid.n * S.grid.scale / 2 - 9;
  const ca = fa && inPlate(qa) && E.centroid(fa, S.grid, qa.xi, qa.eta), cb = fb && inPlate(qb) && E.centroid(fb, S.grid, qb.xi, qb.eta);
  const row = (k, v, cls = '') => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`;
  const pos = (c, q) => !inPlate(q) ? t('outside') : c && c.snr > 4 ? `${c.xi >= 0 ? '+' : '−'}${Math.abs(c.xi).toFixed(1)}″, ${c.eta >= 0 ? '+' : '−'}${Math.abs(c.eta).toFixed(1)}″  (S/N ${c.snr.toFixed(0)})` : t('noSource');
  let html = '<table>' + row(`<span class="a">A</span> ${epochLabel(S.a, true)}`, pos(ca, qa)) + row(`<span class="b">B</span> ${epochLabel(S.b, true)}`, pos(cb, qb));
  const holes = (fr, q) => { if (!fr || !inPlate(q)) return 0; let n = 0; for (let r = 0; r < S.grid.n; r++) for (let c = 0; c < S.grid.n; c++) if (Math.hypot(S.grid.xi(c) - q.xi, S.grid.eta(r) - q.eta) < 9 && fr.img[r * S.grid.n + c] !== fr.img[r * S.grid.n + c]) n++; return n; };
  if (holes(fa, qa) + holes(fb, qb) > 0) html += `<tr><td colspan="2" class="warn">${t('saturated')}</td></tr>`;
  if (ca && cb && ca.snr > 4 && cb.snr > 4) {
    const dx = cb.xi - ca.xi, dy = cb.eta - ca.eta, d = Math.hypot(dx, dy), dt = (S.epochs[S.b].mjd - S.epochs[S.a].mjd) / 365.25;
    const pa = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, e = Math.hypot(ca.e, cb.e, REPEAT * Math.SQRT2);
    html += row(t('shift'), `${d.toFixed(1)} ± ${e.toFixed(1)}″`, 'big') + row(t('direction'), `${pa.toFixed(0)}° (${t('paNote')})`)
      + row(t('interval'), `${Math.abs(dt).toFixed(2)} ${t('years')}`)
      + row(t('rateRow'), d > 3 * e ? `${(d / Math.abs(dt)).toFixed(2)} ″/${t('year')}` : t('notSignificant'), 'big');
  }
  if (man.astrometry) {
    const pa_ = E.apparentXiEta(man.astrometry, S.epochs[S.a].mjd, man.center), pb_ = E.apparentXiEta(man.astrometry, S.epochs[S.b].mjd, man.center);
    html += row(t('predicted'), `${Math.hypot(pb_[0] - pa_[0], pb_[1] - pa_[1]).toFixed(1)}″`)
      + row(t('catalogue'), `${Math.hypot(man.astrometry.pmra, man.astrometry.pmdec).toFixed(2)} ″/${t('year')}`);
  }
  box.innerHTML = html + '</table><p class="hint">' + t('measureNote') + '</p>';
}

function renderProv() {
  const p = S.pkg.man.provenance, man = S.pkg.man;
  const dois = p.dois.map(d => `<a href="https://doi.org/${d}" target="_blank" rel="noopener">${d}</a>`).join(', ');
  const first = E.select(S.pkg, { lam: S.lam })[0];
  $('prov').innerHTML = `<p>${t('provSource', { n: man.exposures.length, v: man.visits.length })}</p>
    <p>${t('provRelease', { c: p.collections.join(', '), pv: p.pipeline.join(', ') })} DOI ${dois}</p>
    ${man.fetch && man.fetch.listed > man.fetch.asked ? `<p>${t('thinned', { listed: man.fetch.listed, kept: man.fetch.asked })}</p>` : ''}
    ${man.wise ? `<p>${t('provWise', { c: man.wise.coadd })} DOI <a href="https://doi.org/${man.wise.doi}" target="_blank" rel="noopener">${man.wise.doi}</a></p>` : ''}
    ${man.gaia ? `<p>${t('provGaia', { n: man.gaia.length })}</p>` : ''}
    <p>${t('provAccess')}</p>
    ${first ? `<p>${t('provFile')} <a href="https://irsa.ipac.caltech.edu/ibe/data/spherex/${first.key}" target="_blank" rel="noopener">${first.id}, D${first.det}, ${first.lam.toFixed(3)} µm</a></p>` : ''}`;
}

let VR = null;
const expStored = () => { try { return JSON.parse(localStorage.getItem('ektos-exp') || '[]'); } catch (e) { return []; } };
function expStatus() {
  const x = S.exp, tr = x.trials[x.i];
  $('expStatus').textContent = t('expTrial', { i: x.i + 1, n: x.trials.length, mode: t(tr.mode === 'blink' ? 'modeBlink' : 'modeStereo') });
}
function spxPair(minShown, minAuto = 8) {
  const cnt = i => E.select(S.pkg, { visit: S.epochs[i].visit, lam: S.lam }).length;
  const isSpx = i => S.epochs[i] && S.epochs[i].kind === 'spx';
  const pair = (a, b, auto) => ({ a, b, va: S.epochs[a].visit, vb: S.epochs[b].visit, auto });
  if (isSpx(S.a) && isSpx(S.b) && S.epochs[S.a].visit !== S.epochs[S.b].visit && cnt(S.a) >= minShown && cnt(S.b) >= minShown) return pair(S.a, S.b, false);
  const ok = S.epochs.map((_, i) => i).filter(i => isSpx(i) && cnt(i) >= minAuto);
  return ok.length >= 2 ? pair(ok[0], ok[ok.length - 1], true) : null;
}
const pairNote = p => (p.auto ? t('pairAuto', { a: epochLabel(p.a, true), b: epochLabel(p.b, true) }) : '');
function expPair() {
  const p = spxPair(8);
  if (!p) notice(t('expNeedSpx'));
  return p;
}
async function expStart() {
  const X = await import('./experiment.js'), pair = expPair();
  if (!pair) return;
  const obs = Math.max(1, Math.round(+$('expObs').value || 1));
  S.fov = null; setGrid();
  S.exp = {
    X, base: S.pkg, va: pair.va, vb: pair.vb, obs, limit: Math.max(5, +$('expTime').value || 30), i: -1, rows: [],
    trials: X.makeTrials(S.grid.n * S.grid.scale, { seed: 1, reps: Math.max(1, Math.round(+$('expReps').value || 1)), flip: obs % 2 }),
    saved: { marks: S.marks, probe: S.probe, movie: S.movie, mode: S.mode, axis: S.axis, cold: S.cold, playing: S.playing, a: S.a, b: S.b },
  };
  Object.assign(S, { marks: false, probe: null, movie: false, cold: false, axis: 0, playing: true, follow: false, a: pair.a, b: pair.b });
  document.body.classList.add('exp-running'); $('expRun').hidden = false; $('expForm').hidden = true; notice(pairNote(pair));
  plateLabel();
  expNext();
  $('plate').focus();
}
function expNext() {
  const x = S.exp; clearTimeout(x.timer);
  for (;;) {
    x.i++;
    if (x.i >= x.trials.length) return expFinish();
    const b = x.X.buildTrial(x.base, x.trials[x.i], x.va, x.vb, S.lam);
    if (b.flux === b.flux) { S.pkg = b.pkg; x.flux = b.flux; break; }
  }
  const tr = x.trials[x.i];
  S.mode = tr.mode; S.phase = 0; S.kb = null; x.t0 = performance.now();
  x.timer = setTimeout(() => expAnswer(null, 'timeout'), x.limit * 1000);
  refresh(false); expStatus();
  if (VR) VR.setPair(vrPair({ blink: tr.mode === 'blink', status: $('expStatus').textContent }));
}
function expAnswer(pos, answer) {
  const x = S.exp; if (!x || x.i < 0 || x.i >= x.trials.length) return;
  const tr = x.trials[x.i], ast = x.base.man.astrometry;
  if (pos && ast && !(tr.snr && x.X.isHit(tr, pos.xi, pos.eta))) {
    const near = [x.va, x.vb].some(v => { const [ox, oy] = E.apparentXiEta(ast, x.base.man.visits[v].mjd, x.base.man.center); return Math.hypot(pos.xi - ox, pos.eta - oy) <= x.X.HIT_RADIUS; });
    if (near) { x.real = (x.real || 0) + 1; $('expStatus').textContent = t('expReal'); if (VR) VR.setPair({ ...vrPair({ blink: tr.mode === 'blink' }), status: t('expReal') }); return; }
  }
  x.rows.push({
    id: tr.id, mode: tr.mode, display: VR ? 'vr' : tr.mode === 'stereo' ? S.stereo : 'screen', snr: tr.snr, shift: tr.shift, angle: tr.angle, xi: tr.xi, eta: tr.eta,
    flux: x.flux, answer, rx: pos ? pos.xi : null, ry: pos ? pos.eta : null, hit: !!(pos && tr.snr && x.X.isHit(tr, pos.xi, pos.eta)), rt: (performance.now() - x.t0) / 1000, real_clicks: x.real || 0,
  });
  x.real = 0;
  expNext();
}
function expFinish() {
  const x = S.exp; clearTimeout(x.timer);
  S.pkg = x.base; Object.assign(S, x.saved); S.exp = null;
  document.body.classList.remove('exp-running'); $('expRun').hidden = true; $('expForm').hidden = false; notice('');
  plateLabel();
  if (x.rows.length) {
    const all = expStored();
    all.push({ when: new Date().toISOString(), observer: x.obs, field: S.slug, lam: S.lam, va: x.va, vb: x.vb, limit: x.limit, hit_radius: x.X.HIT_RADIUS, rows: x.rows });
    localStorage.setItem('ektos-exp', JSON.stringify(all));
  }
  refresh();
  if (VR) VR.setPair(vrPair({ status: '' }));
  expRender();
}
async function expRender() {
  const X = await import('./experiment.js'), all = expStored(), box = $('expResult');
  if (!all.length) { box.innerHTML = ''; return; }
  const sum = X.summarise(all.flatMap(s => s.rows));
  const pct = (k, n) => { if (!n) return '—'; const [lo, hi] = X.wilson(k, n); return `${k} / ${n} (%${Math.round(100 * lo)}–${Math.round(100 * hi)})`; };
  const line = (label, f) => `<tr><td>${label}</td><td>${f(sum.blink)}</td><td>${f(sum.stereo)}</td></tr>`;
  let h = `<p class="hint">${t('expSessions', { n: all.length, o: new Set(all.map(s => s.observer)).size })}</p><table class="exp"><tr><td></td><td>${t('modeBlink')}</td><td>${t('modeStereo')}</td></tr>`
    + line(t('expFound'), m => pct(m.hit, m.n)) + line(t('expWrong'), m => `${m.wrong} / ${m.n}`)
    + line(t('expFalse'), m => pct(m.false_alarm, m.empty)) + line(t('expRT'), m => m.rt === null ? '—' : `${m.rt.toFixed(1)} s`);
  const shifts = [...new Set([...sum.blink.byShift, ...sum.stereo.byShift].map(b => b.shift))].sort((p, q) => p - q);
  const snrs = [...new Set([...sum.blink.bySnr, ...sum.stereo.bySnr].map(b => b.snr))].sort((p, q) => p - q);
  for (const d of shifts) h += line(t('expShift', { d }), m => { const c = m.byShift.find(b => b.shift === d); return c ? `${c.hit} / ${c.n}` : '—'; });
  for (const s of snrs) h += line(t('expSnr', { s }), m => { const c = m.bySnr.find(b => b.snr === s); return c ? `${c.hit} / ${c.n}` : '—'; });
  box.innerHTML = h + `</table><p class="hint">${t('expNote')}</p>`;
}
async function expMachine() {
  const pair = expPair(); if (!pair) return;
  notice('');
  const m = await busy('expMachine', 'expMachineOut', 'expComputing', 'machine', pair, { seed: 1, reps: 10 });
  if (!m) return;
  let h = (pair.auto ? `<p class="hint">${pairNote(pair)}</p>` : '') + `<p class="hint">${t('expMachineHead', { thr: m.threshold, fp: m.false_peaks })}</p><table class="exp"><tr><td>${t('expCell')}</td><td>${t('expFound')}</td><td>${t('expAlready')}</td></tr>`;
  for (const c of m.cells) h += `<tr><td>S/N ${c.snr}, ${c.shift}″ (${c.flux.toFixed(0)} µJy)</td><td>${c.found} / ${c.n}</td><td>${c.already} / ${c.n}</td></tr>`;
  $('expMachineOut').innerHTML = h + '</table>';
  window.__machine = m;
}
let WK = null, wkPkg = null, wkSeq = 0;
const wkWait = new Map(), pkgIds = new WeakMap();
let pkgSeq = 0;
const pkgId = p => { if (!pkgIds.has(p)) pkgIds.set(p, ++pkgSeq); return pkgIds.get(p); };
function wkFail(msg) { for (const w of wkWait.values()) w.rej(new Error(msg)); wkWait.clear(); }
function worker() {
  if (WK === false) return null;
  if (!WK) {
    try { WK = new Worker(new URL('./machine-worker.js', import.meta.url), { type: 'module' }); } catch (err) { WK = false; return null; }
    WK.onmessage = ({ data }) => { const w = wkWait.get(data.id); if (!w) return; wkWait.delete(data.id); if (data.ok) w.res(data.out); else w.rej(new Error(data.msg)); };
    WK.onerror = ev => { ev.preventDefault(); WK.terminate(); WK = false; wkPkg = null; wkFail('worker failed'); };
  }
  return WK;
}
function stopJobs() {
  if (WK && wkWait.size) { WK.terminate(); WK = null; wkPkg = null; wkFail('cancelled'); }
}
async function runJob(job, va, vb, lam, opts) {
  const pkg = S.pkg, grid = fullGrid(), w = worker();
  if (w) {
    try {
      const id = ++wkSeq, msg = { id, job, va, vb, lam, opts, grid: { n: grid.n, scale: grid.scale }, pkgId: pkgId(pkg) }, move = [];
      if (wkPkg !== msg.pkgId) { const cube = pkg.cube.slice(); msg.pkg = { man: pkg.man, cube: cube.buffer }; move.push(cube.buffer); wkPkg = msg.pkgId; }
      return await new Promise((res, rej) => { wkWait.set(id, { res, rej }); w.postMessage(msg, move); });
    } catch (err) {
      if (err.message === 'cancelled') throw err;
      wkPkg = null;
    }
  }
  await new Promise(r => setTimeout(r, 30));
  const X = await import('./experiment.js');
  return job === 'limit' ? X.limit(pkg, grid, va, vb, lam, opts) : X.machine(pkg, grid, va, vb, lam, opts);
}
async function busy(btn, out, msgKey, job, pair, opts) {
  const b = $(btn), box = $(out), gen = S.gen, t0 = performance.now();
  b.disabled = true; b.textContent = t('working');
  box.innerHTML = `<p class="hint" role="status">${t(msgKey)} <span class="clock"></span></p>`;
  const tick = setInterval(() => { const c = box.querySelector('.clock'); if (c) c.textContent = t('elapsed', { s: Math.round((performance.now() - t0) / 1000) }); }, 500);
  try {
    const m = await runJob(job, pair.va, pair.vb, S.lam.slice(), opts);
    return gen === S.gen ? m : null;
  } catch (err) {
    if (gen === S.gen && err.message !== 'cancelled') { const p = document.createElement('p'); p.className = 'hint warn'; p.textContent = err.message; box.replaceChildren(p); }
    return null;
  } finally {
    clearInterval(tick); b.disabled = false; b.textContent = t(btn);
  }
}
function vrSpectrum(xi, eta, track = null) {
  const pts = E.spectrum(S.pkg, track || (() => [xi, eta]));
  if (pts.length < 20) return null;
  const bin = (sel, div) => {
    const out = [];
    for (let l = 0.74; l < 5.04;) {
      const dw = l / div, v = sel.filter(p => p.lam >= l && p.lam < l + dw);
      if (v.length >= 2) {
        const f = v.map(p => p.flux).sort((a, b) => a - b), med = f[f.length >> 1];
        const mad = 1.4826 * v.map(p => Math.abs(p.flux - med)).sort((a, b) => a - b)[v.length >> 1];
        let sw = 0, s = 0;
        for (const p of v) { if (Math.abs(p.flux - med) > 5 * Math.max(mad, p.err)) continue; const w = 1 / (p.err * p.err); sw += w; s += w * p.flux; }
        if (sw > 0) out.push([l + dw / 2, s / sw]);
      }
      l += dw;
    }
    return out;
  };
  const mean = bin(pts, 40), va = S.epochs[S.a] && S.epochs[S.a].kind === 'spx' ? S.epochs[S.a].visit : -1, vb = S.epochs[S.b] && S.epochs[S.b].kind === 'spx' ? S.epochs[S.b].visit : -1;
  let ids = S.pkg.man.visits.map((_, i) => i);
  if (ids.length > 8) { const keep = new Set([va, vb]); for (let k = 0; k < 6; k++) keep.add(Math.round(k * (ids.length - 1) / 5)); ids = ids.filter(i => keep.has(i)); }
  const visits = ids.map(i => ({ role: i === va ? 'a' : i === vb ? 'b' : null, pts: bin(pts.filter(p => p.v === i), 20) }));
  const sorted = mean.map(m => m[1]).sort((a, b) => a - b);
  return { n: pts.length, mean, visits, peak: sorted.length ? sorted[sorted.length - 1] : 0 };
}
function vrSnap(xi, eta) {
  const c = E.centroid(allFrame(), S.grid, xi, eta);
  return c && c.snr > 6 && Math.hypot(c.xi - xi, c.eta - eta) < 12 ? [c.xi, c.eta] : null;
}
function vrTunnel() {
  const man = S.pkg.man, ast = man.astrometry, wi = S.epochs.findIndex(e => e.kind === 'wise');
  if (!ast || !(Math.hypot(ast.pmra, ast.pmdec) > 0)) return { why: 'noAst' };
  if (wi < 0 || !S.pkg.wise) return { why: 'noWise' };
  const lam = wiseBandFor(S.lam) ? S.lam : (man.bands.W2s || [4.0, 5.03]);
  const saved = S.lam;
  S.lam = lam;
  try {
    const band = wiseBandFor(lam);
    if (!band) return { why: 'noWise' };
    let li = -1;
    S.epochs.forEach((ep, i) => { if (ep.kind === 'spx' && E.select(S.pkg, { visit: ep.visit, lam }).length >= 3) li = i; });
    if (li < 0) return { why: 'noData' };
    const from = E.apparentXiEta(ast, S.epochs[wi].mjd, man.center), to = E.apparentXiEta(ast, S.epochs[li].mjd, man.center);
    const half = S.grid.n * S.grid.scale / 2 - 6;
    if ([from, to].some(p => Math.max(Math.abs(p[0]), Math.abs(p[1])) > half)) return { why: 'offPlate' };
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 15) return { why: 'short' };
    const fw = wiseFrame(band), fl = E.frame(S.pkg, S.grid, S.epochs[li].visit, lam);
    if (!fw || !fl) return { why: 'noData' };
    const L = limits([fw, fl]);
    return { a: grayCanvas(fw, L.meds[0], L.lo, L.hi, false), b: grayCanvas(fl, L.meds[1], L.lo, L.hi, false), from, to, lam,
      y0: E.mjdToYear(S.epochs[wi].mjd), y1: E.mjdToYear(S.epochs[li].mjd), labelA: epochLabel(wi, true), labelB: epochLabel(li, true) };
  } finally {
    S.lam = saved;
  }
}
const VOICE_BINS = 16, VOICE_STARS = 10;
function vrSkyVoice() {
  const man = S.pkg.man, pkg = S.pkg, N = pkg.N, n2 = N * N, cube = pkg.cube;
  const l0 = Math.log(0.75), l1 = Math.log(5.0), binOf = lam => Math.min(VOICE_BINS - 1, Math.max(0, Math.floor((Math.log(lam) - l0) / (l1 - l0) * VOICE_BINS)));
  const lams = Array.from({ length: VOICE_BINS }, (_, b) => Math.exp(l0 + (b + 0.5) * (l1 - l0) / VOICE_BINS));
  const toUJy = e => e.omega / E.ARCSEC2_PER_SR * 1e12;
  const nv = man.visits.length, sum = Array.from({ length: nv }, () => new Float64Array(VOICE_BINS)), cnt = Array.from({ length: nv }, () => new Uint16Array(VOICE_BINS));
  for (const e of man.exposures) {
    if (e.ok === false || !(e.lam >= 0.75 && e.lam <= 5.0)) continue;
    let s = 0, k = 0;
    for (let p = e.i * n2, q = p + n2; p < q; p++) { const v = cube[p]; if (v === v) { s += v - e.bg; k++; } }
    if (k < 0.5 * n2) continue;
    const b = binOf(e.lam);
    sum[e.v][b] += s * n2 / k * toUJy(e); cnt[e.v][b]++;
  }
  const all = new Float64Array(VOICE_BINS), alln = new Uint16Array(VOICE_BINS);
  sum.forEach((row, v) => row.forEach((x, b) => { if (cnt[v][b]) { all[b] += x; alln[b] += cnt[v][b]; } }));
  const mean = Array.from(all, (x, b) => (alln[b] ? x / alln[b] : 0));
  const visits = man.visits.map((vis, v) => ({ mjd: vis.mjd, f: Array.from(sum[v], (x, b) => (cnt[v][b] ? x / cnt[v][b] : mean[b])) }))
    .sort((p, q) => p.mjd - q.mjd);
  const srcs = [...(man.ref_stars || [])].sort((p, q) => q.snr - p.snr).slice(0, VOICE_STARS).map(s => ({ xi: s.xi, eta: s.eta, track: null }));
  const ast = man.astrometry;
  if (ast) {
    const half = S.grid.n * S.grid.scale / 2 - 8, mid = 0.5 * (man.visits[0].mjd + man.visits[nv - 1].mjd), at = E.apparentXiEta(ast, mid, man.center);
    if (Math.max(Math.abs(at[0]), Math.abs(at[1])) < half) srcs.push({ xi: at[0], eta: at[1], track: mjd => E.apparentXiEta(ast, mjd, man.center), target: true });
  }
  const usable = man.exposures.filter(e => e.ok !== false && e.lam >= 0.75 && e.lam <= 5.0), step = Math.max(1, Math.ceil(usable.length / 160));
  const stars = [];
  for (const src of srcs) {
    const fb = new Float64Array(VOICE_BINS), nb = new Uint16Array(VOICE_BINS);
    for (let j = 0; j < usable.length; j += step) {
      const e = usable[j], [x, y] = src.track ? src.track(e.mjd) : [src.xi, src.eta], f = E.forcedFlux(pkg, e, x, y);
      if (f) { const b = binOf(e.lam); fb[b] += f.flux; nb[b]++; }
    }
    let sw = 0, swl = 0, tot = 0;
    for (let b = 0; b < VOICE_BINS; b++) if (nb[b]) { const v = fb[b] / nb[b]; if (v > 0) { sw += v; swl += v * Math.log(lams[b]); tot += v; } }
    if (sw > 0) stars.push({ xi: src.xi, eta: src.eta, lam: Math.exp(swl / sw), flux: tot, target: !!src.target });
  }
  return { lams, visits, stars, field: S.grid.n * S.grid.scale };
}
function vrPair(extra = {}) {
  const fa = epochFrame(S.a), fb = epochFrame(S.b); if (!fa || !fb) return null;
  const L = limits([fa, fb]), man = S.pkg.man, ast = man.astrometry;
  return {
    a: grayCanvas(fa, L.meds[0], L.lo, L.hi, false), b: grayCanvas(fb, L.meds[1], L.lo, L.hi, false),
    labelA: epochLabel(S.a), labelB: epochLabel(S.b), field: S.grid.n * S.grid.scale,
    years: (S.epochs[S.b].mjd - S.epochs[S.a].mjd) / 365.25, axis: S.axis, lang: S.lang,
    center: man.center, sky: 'sky/spherex_dr1_4.57um_icrs_4096.jpg',
    target: ast && ast.plx ? { name: man.name, plx: ast.plx, pm: Math.hypot(ast.pmra, ast.pmdec), at: E.apparentXiEta(ast, 0.5 * (S.epochs[S.a].mjd + S.epochs[S.b].mjd), man.center) } : null,
    ...vrTunnelFields(), spectrumAt: vrSpectrum, snap: vrSnap, skyVoice: vrSkyVoiceOnce,
    channels: S.channels || null, targets: S.exp ? [] : vrTargets(), onOpenField: vrOpen, worldline: S.exp ? null : vrWorldline(), ...extra,
  };
}
function vrTunnelFields() {
  if (S.exp) return { tunnel: null, tunnelWhy: 'exp' };
  const t = vrTunnel();
  return t && !t.why ? { tunnel: t, tunnelWhy: null } : { tunnel: null, tunnelWhy: t ? t.why : 'noData' };
}
const VOICE = new WeakMap();
function vrSkyVoiceOnce() {
  if (!VOICE.has(S.pkg)) { let v = null; try { v = vrSkyVoice(); } catch (err) { console.warn('sky voice:', err); } VOICE.set(S.pkg, v); }
  return VOICE.get(S.pkg);
}
function vrTargets() {
  return Object.entries(S.index || {}).filter(([slug, f]) => slug !== S.slug && f.center && !/_h\d+$/.test(slug))
    .map(([slug, f]) => ({ slug, name: f.name, kind: f.kind, ra: f.center[0], dec: f.center[1], group: f.group }));
}
async function vrOpen(slug) {
  if (!await openField(slug)) return;
  await S.anReady;
  vrSkyVoiceOnce();
  const h = VR || PV, pair = vrPair(); if (h && h.setPair && pair) h.setPair(pair);
}
async function runLimit() {
  const box = $('limitOut'), pair = spxPair(1);
  if (!pair) { box.innerHTML = `<p class="hint">${t('limitNeed')}</p>`; return; }
  const ea = S.epochs[pair.a], eb = S.epochs[pair.b], lam = `${S.lam[0].toFixed(2)}–${S.lam[1].toFixed(2)}`;
  const m = await busy('limitRun', 'limitOut', 'limitBusy', 'limit', pair, { seed: 1 });
  if (!m) return;
  const years = Math.abs(eb.mjd - ea.mjd) / 365.25, top = m.cells[m.cells.length - 1];
  let h = (pair.auto ? `<p class="hint">${pairNote(pair)}</p>` : '') + (m.level
    ? `<p>${t('limitResult', { a: epochLabel(pair.a, true), b: epochLabel(pair.b, true), lam, flux: m.level.flux.toFixed(0), shift: m.shift, rate: (m.shift / years).toFixed(0), found: m.level.found, n: m.level.n })}</p>`
    : `<p>${t('limitNone', { flux: top.flux.toFixed(0), found: top.found, n: top.n })}</p>`);
  h += `<p>${m.false_peaks ? t('limitCands', { c: m.false_peaks }) : t('limitClear')}</p>`;
  h += '<p class="note">' + m.cells.map(c => t('limitRow', { flux: c.flux.toFixed(0), found: c.found, n: c.n })).join(' · ') + '</p>';
  box.innerHTML = h;
  window.__limit = m;
}
let SOUND = null;
async function toggleListen() {
  const btn = $('listen');
  if (SOUND) { SOUND.stop(); return; }
  const man = S.pkg.man, probe = S.probe || (S.follow && man.astrometry ? { xi: 0, eta: 0 } : null);
  const data = probe ? vrSpectrum(probe.xi, probe.eta, trackFor(probe)) : null;
  if (!data) { notice(t('listenNone')); return; }
  const { play } = await import('./sonify.js');
  const snd = play(data.mean); if (!snd) return;
  SOUND = snd;
  const tick = setInterval(() => { btn.textContent = t('listenStop', { lam: snd.lam().toFixed(1) }); }, 100);
  snd.done.then(() => { clearInterval(tick); SOUND = null; btn.textContent = t('listen'); });
}
function loadAnalysis(slug) {
  S.an = null;
  const has = ((S.index[slug] && S.index[slug].extras) || []).includes('analysis'), gen = S.gen;
  S.anFetch = !has ? Promise.resolve(null) : fetch(`data/${slug}/analysis.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  S.anReady = S.anFetch.then(d => { if (S.gen === gen) S.an = d; });
}
function vrWorldline() {
  const an = S.an, ast = S.pkg.man.astrometry; if (!ast) return null;
  const which = an && an.fits ? ['WISE + SPHEREx', 'SPHEREx only', 'WISE only'].find(k => an.fits[k]) : null, f = which && an.fits[which];
  const eps = an ? [...(an.wise_epochs || []), ...(an.spherex_epochs || [])] : [];
  if (!f || !(f.plx > 0) || eps.length < 3) return vrWorldlineCatalogue(ast);
  const yr = e => E.mjdToYear(e.mjd), ys = eps.map(yr), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  const lin = y => [f.xi0 + f.pm_xi * (y - f.t_ref), f.eta0 + f.pm_eta * (y - f.t_ref)];
  const n = Math.max(200, Math.round((y1 - y0) * 40)), model = [];
  for (let i = 0; i <= n; i++) {
    const y = y0 + (y1 - y0) * i / n, [pa, pd] = E.parallaxFactors(ast.ra, ast.dec, 51544.5 + (y - 2000) * 365.25), l = lin(y);
    model.push([y, l[0] + f.plx * pa, l[1] + f.plx * pd, f.plx * pa, f.plx * pd]);
  }
  return { name: S.pkg.man.name, y0, y1, plx: f.plx, e_plx: f.e_plx, pm: [f.pm_xi, f.pm_eta], model,
    eps: eps.map(e => { const l = lin(yr(e)); return { yr: yr(e), xi: e.xi, eta: e.eta, rxi: e.xi - l[0], reta: e.eta - l[1], exi: e.e_xi, eeta: e.e_eta, spx: e.src === 'SPHEREx' }; }), source: 'measured' };
}
function vrWorldlineCatalogue(ast) {
  const pm = Math.hypot(ast.pmra, ast.pmdec);
  if (!(pm > 0) && !(ast.plx > 0)) return null;
  const ys = S.epochs.map(ep => E.mjdToYear(ep.mjd));
  let y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  if (y1 - y0 < 2) y1 = y0 + 2;
  const centre = S.pkg.man.center, n = Math.max(200, Math.round((y1 - y0) * 40)), model = [];
  for (let i = 0; i <= n; i++) {
    const y = y0 + (y1 - y0) * i / n, mjd = 51544.5 + (y - 2000) * 365.25;
    const full = E.apparentXiEta(ast, mjd, centre), [pa, pd] = ast.plx > 0 ? E.parallaxFactors(ast.ra, ast.dec, mjd) : [0, 0];
    model.push([y, full[0], full[1], (ast.plx || 0) * pa, (ast.plx || 0) * pd]);
  }
  return { name: S.pkg.man.name, y0, y1, plx: ast.plx > 0 ? ast.plx : 0, e_plx: null, pm: [ast.pmra, ast.pmdec], model, eps: [], source: 'catalogue' };
}
async function loadChannels() {
  try { const j = await (await fetch('sky/channels/index.json')).json(); S.channels = { base: 'sky/channels/', frame: j.frame, list: j.channels }; } catch (err) { S.channels = null; }
}
let PV = null;
async function previewVR() {
  if (PV) { PV.end(); PV = null; return; }
  await S.anReady;
  vrSkyVoiceOnce();
  import('./skysound.js').then(m => m.prepare()).catch(() => {});
  const pair = vrPair(); if (!pair) return;
  try { const vr = await import('./vr.js'); PV = await vr.preview(pair); } catch (err) { PV = null; notice(t('vrFailed', { msg: err.message })); }
}
async function toggleVR() {
  if (VR) { VR.end(); return; }
  fetch('api/log?m=' + encodeURIComponent('--- VR button pressed: ' + navigator.userAgent.match(/Chrome\/[0-9.]+|Edg\/[0-9.]+|Firefox\/[0-9.]+/)), { keepalive: true }).catch(() => {});
  const anGen = S.gen, anLate = !await Promise.race([S.anReady.then(() => true), new Promise(r => setTimeout(() => r(false), 400))]);
  vrSkyVoiceOnce();
  import('./skysound.js').then(m => m.prepare()).catch(() => {});
  const pair = vrPair(S.exp ? { blink: S.mode === 'blink', status: $('expStatus').textContent } : {});
  if (!pair) return;
  try {
    const vr = await import('./vr.js');
    VR = await vr.enter({ ...pair, onPick: (xi, eta) => { if (!S.exp) return false; expAnswer({ xi, eta }, 'click'); return true; }, onNone: () => { if (!S.exp) return false; expAnswer(null, 'none'); return true; } });
    const h = VR, watch = setInterval(() => {
      const s = h.stats(), n = $('notice'), mine = n.dataset.vr === '1';
      if (s.frames > 120 && s.poses === 0) { notice(t('vrNoPose')); n.dataset.vr = '1'; } else if (mine && s.poses > 0) { notice(''); n.dataset.vr = ''; }
    }, 1500);
    VR.session.addEventListener('end', () => { clearInterval(watch); VR = null; $('enterVR').textContent = t('enterVR'); if ($('notice').dataset.vr === '1') { notice(''); $('notice').dataset.vr = ''; } });
    $('enterVR').textContent = t('leaveVR');
    if (anLate) S.anReady.then(() => { if (VR === h && S.gen === anGen && !S.exp) { const p = vrPair(); if (p) VR.setPair(p); } });
  } catch (err) { VR = null; notice(t('vrFailed', { msg: err.message })); }
}

function syncURL() {
  const q = new URLSearchParams();
  q.set('t', S.slug); if (S.band && S.pkg.man.bands[S.band]) q.set('band', S.band); else q.set('lam', S.lam.map(x => x.toFixed(2)).join('-'));
  q.set('a', S.a); q.set('b', S.b); q.set('mode', S.mode);
  if (S.neg) q.set('neg', '1'); if (S.cold) q.set('cold', '1');
  if (S.probe && !S.probe.target) { q.set('x', S.probe.xi.toFixed(1)); q.set('y', S.probe.eta.toFixed(1)); }
  if (S.fov) q.set('fov', String(S.fov));
  if (S.entered) { q.set('ra', S.entered.ra.toFixed(6)); q.set('dec', S.entered.dec.toFixed(6)); }
  if (document.body.classList.contains('embed')) q.set('embed', '1');
  if (!$('expSec').hidden) q.set('exp', '1');
  q.set('lang', S.lang);
  history.replaceState(null, '', '?' + q.toString());
}
function setTimer() {
  clearInterval(S.timer); S.timer = null;
  if (S.mode === 'blink' && S.playing) S.timer = setInterval(() => { S.phase ^= 1; S.frameIdx++; drawPlate(); }, 1000 / S.rate);
}
function refresh(heavy = true) {
  document.querySelectorAll('.modes [role="tab"]').forEach(b => {
    const on = b.dataset.mode === S.mode;
    b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
    if (on) $('platePanel').setAttribute('aria-labelledby', b.id);
  });
  $('blinkCtl').hidden = S.mode !== 'blink'; $('stereoCtl').hidden = S.mode !== 'stereo' && !S.exp;
  $('modeHelp').textContent = t('help_' + S.mode);
  document.querySelectorAll('[data-stereo]').forEach(b => b.setAttribute('aria-pressed', b.dataset.stereo === S.stereo));
  $('play').textContent = t(S.playing ? 'pause' : 'play');
  $('neg').checked = S.neg; $('cold').checked = S.cold; $('marks').checked = S.marks; $('follow').checked = S.follow; $('movie').checked = S.movie;
  $('axisOut').textContent = `${S.axis}°`;
  if (!S.pkg) return;
  if (S.mode === 'stereo') checkVR();
  $('cold').disabled = !coldAvailable();
  $('coldNote').textContent = coldWhy(); $('coldNote').hidden = !$('coldNote').textContent;
  $('follow').disabled = !S.pkg.man.astrometry;
  drawPlate(); drawSampling(); renderEpochs(); renderBands(); renderFov();
  if (heavy) { drawSpectrum(); renderMeasure(); renderProv(); syncURL(); }
  trimCache();
  setTimer();
}
function plateLabel() { $('plate').setAttribute('aria-label', t(S.exp ? 'plateLabelExp' : 'plateLabel')); }
function applyStrings() {
  document.documentElement.lang = S.lang;
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-tt]').forEach(el => { el.title = t(el.dataset.tt); });
  document.querySelectorAll('[data-ta]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.ta)); });
  plateLabel();
  mountSite('index.html');
  document.title = t('title');
}
function notice(msg) { const n = $('notice'); n.hidden = !msg; n.textContent = msg || ''; }

async function openField(slug, opts = {}) {
  const gen = ++S.gen;
  notice(t('loading'));
  let pkg;
  try { pkg = await E.loadPackage(slug); } catch (err) { if (gen === S.gen) notice(t('loadFailed', { slug })); return false; }
  if (gen !== S.gen) return false;
  stopJobs(); $('limitOut').innerHTML = ''; $('expMachineOut').innerHTML = '';
  S.pkg = pkg;
  const man = S.pkg.man;
  S.slug = slug; S.fov = opts.fov || null; setGrid(); buildEpochs(); loadAnalysis(slug);
  S.band = opts.lam ? null : (Object.hasOwn(man.bands, opts.band || '') ? opts.band : man.default_band);
  S.lam = opts.lam || man.bands[S.band] || [0.73, 5.03];
  S.cold = !!opts.cold && coldAvailable() && Object.hasOwn(man.bands, 'W2s');
  if (S.cold) { S.band = 'W2s'; S.lam = man.bands.W2s; }
  const last = S.epochs.length - 1, isEpoch = v => Number.isInteger(v) && v >= 0 && v <= last;
  const full = S.epochs.map((_, i) => i).filter(i => S.epochs[i].kind === 'wise' ? !!wiseBandFor(S.lam) : E.select(S.pkg, { visit: S.epochs[i].visit, lam: S.lam }).length >= 3);
  S.a = isEpoch(opts.a) ? opts.a : (full.length ? full[0] : 0); S.b = isEpoch(opts.b) ? opts.b : (full.length ? full[full.length - 1] : last);
  S.movie = opts.movie ?? man.visits.length > 6; S.frameIdx = 0;
  const half = S.grid.n * S.grid.scale / 2, p = opts.probe;
  S.probe = p && Number.isFinite(p.xi) && Number.isFinite(p.eta) && Math.max(Math.abs(p.xi), Math.abs(p.eta)) <= half ? p : null;
  S.entered = opts.entered || null; S.follow = false; S.kb = null;
  if (!S.probe && man.astrometry) { const [xi, eta] = E.apparentXiEta(man.astrometry, man.visits[man.visits.length - 1].mjd, man.center); S.probe = { xi, eta, target: true }; }
  document.querySelectorAll('#targets button').forEach(b => b.setAttribute('aria-current', b.dataset.slug === slug));
  $('ydwarfs').value = man.group === 'ydwarf' ? slug : '';
  const fx = man.fetch;
  notice(opts.notice || (fx && fx.listed > fx.asked ? t('thinned', { listed: fx.listed, kept: fx.asked }) : ''));
  refresh();
  loadFindings();
  return true;
}
async function loadFindings() {
  const seq = ++S.findSeq, slug = S.slug, man = S.pkg.man, lang = S.lang, sec = $('findingsSec');
  sec.hidden = true;
  const { renderFindings } = await import('./findings.js');
  const width = $('prov').getBoundingClientRect().width || $('measure').getBoundingClientRect().width;
  const any = await renderFindings(slug, $('findings'), lang, man, (S.index[slug] && S.index[slug].extras) || [],
    { analysis: S.anFetch, current: () => seq === S.findSeq, cssWidth: width });
  if (any !== null && seq === S.findSeq) sec.hidden = !any;
}

function nearestField(ra, dec) {
  let best = null;
  for (const [slug, f] of Object.entries(S.index)) {
    const [xi, eta] = E.tanProject(ra, dec, f.center[0], f.center[1]), d = Math.max(Math.abs(xi), Math.abs(eta));
    if (d < (f.fov ? f.fov * 30 - 8 : 120) && (!best || d < best.d)) best = { slug, d, xi, eta };
  }
  return best;
}
async function goTo(text) {
  const name = text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [slug, f] of Object.entries(S.index)) {
    if (name && (slug === name || f.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(name))) return openField(slug);
  }
  const c = E.parseCoords(text);
  if (!c || !(c.ra >= 0 && c.ra < 360 && Math.abs(c.dec) <= 90)) return notice(t('badCoords'));
  const hit = nearestField(c.ra, c.dec);
  if (hit) {
    if (!await openField(hit.slug, { probe: { xi: hit.xi, eta: hit.eta }, entered: c })) return;
    const ast = S.pkg.man.astrometry;
    if (ast) {
      const [ax, ay] = E.tanProject(ast.ra, ast.dec, S.pkg.man.center[0], S.pkg.man.center[1]);
      if (Math.hypot(ax - hit.xi, ay - hit.eta) < 6) {
        const mjd = S.pkg.man.visits[S.pkg.man.visits.length - 1].mjd, [nx, ny] = E.apparentXiEta(ast, mjd, S.pkg.man.center);
        notice(t('staleCoord', { epoch: Math.floor(ast.epoch), d: Math.hypot(nx - hit.xi, ny - hit.eta).toFixed(0), rate: Math.hypot(ast.pmra, ast.pmdec).toFixed(1), now: S.epochs[S.epochs.length - 1].from.slice(0, 4) }));
        S.probe = { xi: nx, eta: ny, target: true }; refresh();
      }
    }
    return;
  }
  notice(t('building', { ra: c.ra.toFixed(4), dec: c.dec.toFixed(4) }));
  return buildAndOpen(`api/build?ra=${c.ra}&dec=${c.dec}`, { entered: c, probe: { xi: 0, eta: 0 } });
}
async function buildAndOpen(url, opts) {
  let job;
  try { job = await (await fetch(url)).json(); if (!job.job) throw new Error('no job'); } catch (err) { notice(t('noServer')); return false; }
  for (;;) {
    await new Promise(r => setTimeout(r, 1200));
    let st;
    try { st = await (await fetch(`api/status?job=${job.job}`)).json(); } catch (err) { notice(t('noServer')); return false; }
    if (st.state === 'done') {
      S.index = await (await fetch('data/index.json', { cache: 'no-store' })).json(); renderTargets();
      await openField(st.slug, opts);
      return true;
    }
    if (st.state === 'error') { notice(t(st.code === 'empty' ? 'errEmpty' : st.code === 'archive' ? 'errArchive' : 'buildFailed', { msg: st.error })); return false; }
    notice(st.state === 'listing' ? t('buildListing')
      : t('buildProgress', { done: st.done, total: st.total, mb: (st.mb || 0).toFixed(1), est: st.est_mb })
        + (st.listed > st.total ? ' ' + t('thinned', { listed: st.listed, kept: st.total }) : '')
        + (st.incomplete && st.incomplete.length ? ' ' + t('incomplete', { c: st.incomplete.join(', ') }) : ''));
  }
}

const WIDE_HALF = 40;
function setGrid() {
  const man = S.pkg.man, full = man.grid.n * man.grid.scale;
  S.grid = S.fov && S.fov * 60 < full - man.grid.scale ? E.gridForFov(S.fov * 60, man.grid.scale, man.grid.n) : fullGrid();
  if (S.grid.n === man.grid.n) S.fov = null;
}
function renderFov() {
  const sel = $('fov'), man = S.pkg.man, full = man.native.n * man.native.scale / 60;
  sel.innerHTML = '';
  const add = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.append(o); };
  const steps = [1, 2, 3, 4, 6].filter(f => f < full - 0.3);
  if (S.fov && !steps.includes(S.fov)) steps.push(S.fov);
  for (const f of steps.sort((p, q) => p - q)) add(String(f), `${f}′`);
  add('full', t('fovFull', { f: full.toFixed(1) }));
  if (full < 7.5) add('wide', t('fovWide', { f: ((2 * WIDE_HALF + 1) * man.native.scale / 60).toFixed(1) }));
  sel.value = S.fov ? String(S.fov) : 'full';
}
async function openWide() {
  const man = S.pkg.man, c = man.center, keep = { band: S.band, lam: S.band ? undefined : S.lam, entered: S.entered };
  for (const [slug, f] of Object.entries(S.index)) {
    if (f.fov && f.fov > man.grid.n * man.grid.scale / 60 + 0.5 && Math.hypot(...E.tanProject(f.center[0], f.center[1], c[0], c[1])) < 1) return openField(slug, keep);
  }
  const base = S.slug.replace(/_h[0-9]+$/, ''), named = /^f_/.test(base) ? '' : `&t=${encodeURIComponent(base)}`;
  notice(t('buildListing'));
  if (!await buildAndOpen(`api/build?ra=${c[0]}&dec=${c[1]}&half=${WIDE_HALF}${named}`, keep)) renderFov();
}
function checkVR() {
  const b = $('enterVR');
  if (!(navigator.xr && navigator.xr.isSessionSupported)) { b.disabled = true; b.title = t('vrMissing'); return; }
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { b.disabled = !ok; b.title = ok ? '' : t('vrMissing'); }).catch(() => { b.disabled = true; b.title = t('vrMissing'); });
}
function renderTargets() {
  const nav = $('targets'); nav.innerHTML = '';
  const ys = Object.entries(S.index).filter(([, f]) => f.group === 'ydwarf').sort((p, q) => p[1].name.localeCompare(q[1].name));
  const sel = $('ydwarfs'); $('yBox').hidden = !ys.length; sel.innerHTML = '';
  const first = document.createElement('option'); first.value = ''; first.textContent = t('yPick', { n: ys.length }); sel.append(first);
  for (const [slug, f] of ys) { const o = document.createElement('option'); o.value = slug; o.textContent = `${f.name} · ${f.kind}`; sel.append(o); }
  sel.value = S.slug && S.index[S.slug] && S.index[S.slug].group === 'ydwarf' ? S.slug : '';
  sel.onchange = () => { if (sel.value) openField(sel.value); };
  for (const [slug, f] of Object.entries(S.index)) {
    if (f.group === 'ydwarf') continue;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.slug = slug; b.textContent = f.name + (f.fov > 5.5 ? ` · ${f.fov.toFixed(1)}′` : '');
    b.title = f.kind || '';
    b.setAttribute('aria-current', slug === S.slug); b.onclick = () => openField(slug); nav.append(b);
  }
}

async function init() {
  applyStrings(); wireSampling();
  const q = new URLSearchParams(location.search);
  if (q.get('embed') === '1') document.body.classList.add('embed');
  document.querySelectorAll('[data-stereo]').forEach(b => b.onclick = () => { S.stereo = b.dataset.stereo; refresh(); });
  $('play').onclick = () => { S.playing = !S.playing; refresh(false); };
  $('rate').oninput = ev => { S.rate = +ev.target.value; setTimer(); };
  $('movie').onchange = ev => { S.movie = ev.target.checked; S.frameIdx = 0; refresh(false); };
  $('axis').oninput = ev => { S.axis = +ev.target.value; $('axisOut').textContent = `${S.axis}°`; drawPlate(); };
  $('neg').onchange = ev => { S.neg = ev.target.checked; refresh(); };
  $('cold').onchange = ev => { S.cold = ev.target.checked; if (S.cold) { S.band = 'W2s'; S.lam = S.pkg.man.bands.W2s; } refresh(); };
  $('marks').onchange = ev => { S.marks = ev.target.checked; refresh(false); };
  $('fov').onchange = ev => {
    const v = ev.target.value;
    if (v === 'wide') return openWide();
    S.fov = v === 'full' ? null : +v; setGrid(); refresh();
  };
  $('follow').onchange = ev => { S.follow = ev.target.checked; drawSpectrum(); };
  $('listen').onclick = toggleListen; $('limitRun').onclick = runLimit;
  fetch('data/benchmark.json').then(r => (r.ok ? r.json() : null)).then(b => {
    S.bench = b; if (!b) return;
    const m = b.scan[b.threshold.toFixed(1)], n = $('benchNote');
    n.textContent = t('benchNote', { of: m.of, caught: m.caught, rate: (100 * m.random_rate).toFixed(1), per: m.false_per_field.toFixed(1) }); n.hidden = false;
  }).catch(() => {});
  $('goto').onsubmit = ev => { ev.preventDefault(); goTo($('coords').value); };
  $('plate').addEventListener('click', ev => {
    if (!S.pkg || (S.mode === 'stereo' && !S.exp)) return;
    const r = ev.target.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * PL.size, y = (ev.clientY - r.top) / r.height * PL.size;
    const w = PL.size - 2 * PL.m, f = w / (S.grid.n * S.grid.scale);
    if (S.exp) {
      if (S.mode === 'stereo' && S.stereo === 'side') {
        const hw = w / 2 - 6, top = PL.m + w / 4, left = x < PL.m + w / 2 ? PL.m : PL.m + w / 2 + 6, g = hw / (S.grid.n * S.grid.scale);
        if (x < left || x > left + hw || y < top || y > top + hw) return;
        return expAnswer({ xi: (left + hw / 2 - x) / g, eta: (top + hw / 2 - y) / g }, 'click');
      }
      if (x < PL.m || y < PL.m || x > PL.size - PL.m || y > PL.size - PL.m) return;
      return expAnswer({ xi: (PL.size / 2 - x) / f, eta: (PL.size / 2 - y) / f }, 'click');
    }
    if (x < PL.m || y < PL.m || x > PL.size - PL.m || y > PL.size - PL.m) return;
    S.kbOn = false;
    placeProbe((PL.size / 2 - x) / f, (PL.size / 2 - y) / f);
  });
  wirePlateKeys();
  wireModeTabs();
  let rz = null;
  const redraw = () => { clearTimeout(rz); rz = setTimeout(() => { if (S.pkg) { drawPlate(); drawSampling(); drawSpectrum(); } }, 150); };
  addEventListener('resize', redraw);
  document.querySelectorAll('details.grp').forEach(d => d.addEventListener('toggle', () => { if (d.open) redraw(); }));
  $('enterVR').onclick = toggleVR; $('previewVR').onclick = previewVR;
  if (q.get('exp') === '1') {
    $('expSec').hidden = false;
    $('expStart').onclick = expStart; $('expMachine').onclick = expMachine;
    $('expNone').onclick = () => expAnswer(null, 'none');
    $('expStop').onclick = () => { if (S.exp) expFinish(); };
    $('expSave').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(expStored(), null, 1)], { type: 'application/json' }));
      a.download = 'ektos-experiment.json'; a.click(); URL.revokeObjectURL(a.href);
    };
    let armed = 0;
    $('expClear').onclick = () => { if (Date.now() - armed < 3000) { localStorage.removeItem('ektos-exp'); armed = 0; $('expClear').textContent = t('expClear'); expRender(); } else { armed = Date.now(); $('expClear').textContent = t('expClearSure'); } };
    expRender();
  }
  checkVR();

  try { S.index = await (await fetch('data/index.json', { cache: 'no-store' })).json(); } catch (err) { S.index = {}; }
  loadChannels();
  renderTargets();
  const slugs = Object.keys(S.index);
  if (!slugs.length) return notice(t('noData'));
  const P = readParams(q);
  S.mode = P.mode; S.neg = P.neg;
  if (P.coords) return goTo(P.coords);
  const slug = Object.hasOwn(S.index, P.t || '') ? P.t : (S.index.wise0855 ? 'wise0855' : slugs[0]);
  await openField(slug, { band: P.band, lam: P.lam, a: P.a, b: P.b, cold: P.cold, fov: P.fov, probe: P.probe, notice: P.badCoords ? t('badCoords') : undefined });
  if (q.get('vr') === 'preview') previewVR();
}
function readParams(q) {
  const str = k => { const v = q.get(k); return v === null || v.trim() === '' ? undefined : v.trim(); };
  const num = k => { const v = str(k); if (v === undefined || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return undefined; return +v; };
  const idx = k => { const v = str(k); return v !== undefined && /^\d{1,4}$/.test(v) ? +v : undefined; };
  const P = { t: str('t'), band: str('band'), a: idx('a'), b: idx('b'), neg: q.get('neg') === '1', cold: q.get('cold') === '1' };
  P.mode = ['blink', 'stereo', 'diff', 'sum'].includes(q.get('mode')) ? q.get('mode') : 'blink';
  const lm = (str('lam') || '').match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (lm) { const lo = Math.max(LAM_MIN, +lm[1]), hi = Math.min(LAM_MAX, +lm[2]); if (hi - lo >= 0.03) P.lam = [lo, hi]; }
  const fov = num('fov'); if (fov >= 1 && fov <= 60) P.fov = fov;
  const x = num('x'), y = num('y'); if (x !== undefined && y !== undefined) P.probe = { xi: x, eta: y };
  const ra = str('ra'), dec = str('dec');
  if (ra && dec && !P.t) {
    const c = E.parseCoords(`${ra} ${dec}`);
    if (c && c.ra >= 0 && c.ra < 360 && Math.abs(c.dec) <= 90) P.coords = `${ra} ${dec}`; else P.badCoords = true;
  }
  return P;
}
function placeProbe(xi, eta) {
  S.probe = { xi, eta }; S.follow = false; S.kb = { xi, eta };
  $('measureSec').open = true; $('specSec').open = true;
  refresh();
}
function wirePlateKeys() {
  const cv = $('plate'), DIRS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const cursor = () => S.kb || (!S.exp && S.probe ? { xi: S.probe.xi, eta: S.probe.eta } : { xi: 0, eta: 0 });
  cv.addEventListener('keydown', ev => {
    if (!S.pkg || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === ' ') { ev.preventDefault(); S.phase ^= 1; S.playing = false; refresh(false); return; }
    const off = S.mode === 'stereo' && !S.exp;
    if (DIRS[ev.key]) {
      ev.preventDefault(); if (off) return;
      const c = cursor(), d = DIRS[ev.key], step = S.grid.scale * (ev.shiftKey ? 5 : 1), lim = S.grid.n * S.grid.scale / 2 - S.grid.scale / 2;
      const clampL = v => Math.max(-lim, Math.min(lim, v));
      S.kb = { xi: clampL(c.xi + d[0] * step), eta: clampL(c.eta + d[1] * step) }; S.kbOn = true;
      drawPlate();
    } else if (ev.key === 'Enter') {
      ev.preventDefault(); if (off) return;
      const c = cursor(); S.kbOn = true;
      if (S.exp) expAnswer({ xi: c.xi, eta: c.eta }, 'click'); else placeProbe(c.xi, c.eta);
    } else if ((ev.key === 'n' || ev.key === 'N') && S.exp) {
      ev.preventDefault(); expAnswer(null, 'none');
    }
  });
  cv.addEventListener('blur', () => { if (S.kbOn) { S.kbOn = false; drawPlate(); } });
}
function wireModeTabs() {
  const tabs = [...document.querySelectorAll('.modes [role="tab"]')];
  tabs.forEach(b => { b.onclick = () => { S.mode = b.dataset.mode; refresh(); }; });
  $('modes').addEventListener('keydown', ev => {
    const i = tabs.findIndex(b => b.dataset.mode === S.mode), n = tabs.length;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1 + n, Home: 0, End: n - 1 }[ev.key];
    if (j === undefined) return;
    ev.preventDefault();
    const b = tabs[j % n]; S.mode = b.dataset.mode; refresh(); b.focus();
  });
}
init();
