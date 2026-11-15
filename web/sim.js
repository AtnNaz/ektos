import { initStaticPage } from './site.js';
import * as P from './physics.js';

const lang = initStaticPage('sim.html');
const $ = id => document.getElementById(id);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = {
  ink: cssv('--ink'), soft: cssv('--ink-soft'), faint: cssv('--ink-faint'), rule: cssv('--rule'), ruleS: cssv('--rule-strong'),
  sig: cssv('--signal'), deep: cssv('--deep'), lift: cssv('--lift'), red: cssv('--epoch-a'), blue: cssv('--epoch-b'), good: cssv('--good'),
};
const FONT = '"IBM Plex Sans", system-ui, sans-serif';
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace(/^-(?=\d)/, '−').replace(/^−(0\.?0*)$/, '$1') : '—');
const sci = x => {
  if (!Number.isFinite(x) || x <= 0) return '—';
  if (x >= 0.01 && x < 1e5) return num(x, x < 1 ? 3 : x < 100 ? 2 : 0);
  const e = Math.floor(Math.log10(x)), m = x / 10 ** e;
  return `${num(m, 2)}×10${String(e).replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`;
};
const ang = asec => (Math.abs(asec) >= 3600 ? `${num(asec / 3600, 2)}°` : Math.abs(asec) >= 60 ? `${num(asec / 60, 2)}′` : Math.abs(asec) >= 1 ? `${num(asec, 2)}″` : `${num(asec * 1000, 1)} mas`);
const fmtRA = ra => { const h = ra / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), s = (m - mm) * 60; return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${s.toFixed(1).padStart(4, '0')}s`; };
const fmtDec = d => { const s = d < 0 ? '−' : '+', a = Math.abs(d), dd = Math.floor(a), m = (a - dd) * 60, mm = Math.floor(m), ss = (m - mm) * 60; return `${s}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${ss.toFixed(0).padStart(2, '0')}″`; };
const isoDay = m => P.dateOfMjd(m).toISOString().slice(0, 10);

const MJD_MIN = P.STANDISH_RANGE[0], MJD_MAX = P.STANDISH_RANGE[1];
const S = {
  mjd: P.mjdOfDate(new Date()), playing: true, rate: 1, dir: 1,
  target: 'planetx', scale: 'log', yaw: -0.9, pitch: 0.55, extent: { log: 900, lin: 36 },
  eyaw: 0.6, epitch: 0.35, span: 1095.75,
};
const X = { a: 500, e: 0.1, i: 15, node: 100, peri: 150, M0: 30, mjd0: 61041, R: 2.5, p: 0.3, tInt: 40 };
const BD = { T: 285, R: 1.0 };
let LIMIT_UJY = 275, FOV = [5.02, 8.3], ORB = null, REF = null, MEAS = null, PNT = null;

const TARGETS = [{ id: 'planetx', name: 'Planet X', kind: 'x' }];
P.PLANETS.forEach((p, i) => { if (p.id !== 'earth') TARGETS.push({ id: p.id, name: p[lang], kind: 'planet', i }); });
TARGETS.push({ id: 'wise0855', name: 'WISE 0855−0714', kind: 'star', ast: null });
TARGETS.push({ id: 'barnard', name: "Barnard's star", kind: 'star', ast: null });
const tgt = () => TARGETS.find(t => t.id === S.target);
const posFn = t => (t.kind === 'x' ? m => P.bodyXYZ(X, m) : t.kind === 'planet' ? m => P.planetXYZ(t.i, m) : null);

function skyOf(t, m) {
  if (t.kind === 'star') {
    const [dx, dy] = P.starOffset(t.ast, m);
    const d0 = t.ast.dec * P.D2R, ra = t.ast.ra + dx / 3600 / Math.cos(d0), dec = t.ast.dec + dy / 3600;
    return { ra, dec, delta: Infinity, tau: 0, v: P.unit(ra, dec) };
  }
  const { v, tau } = P.apparent(posFn(t), m), [ra, dec] = P.radec(v);
  return { ra, dec, delta: P.norm(v), tau, v };
}

function fit(cv) {
  if (!cv._h) cv._h = +cv.getAttribute('height');
  const dpr = Math.min(2, window.devicePixelRatio || 1), cw = cv.getBoundingClientRect().width;
  const ch = Math.max(260, Math.round(cv._h * Math.min(1, cw / 900)));
  const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cv.style.height = `${ch}px`; }
  const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0);
  return { c, w, h, dpr };
}
function text(c, s, x, y, { col = C.soft, size = 11, align = 'left', base = 'alphabetic', dpr = 1, weight = 400 } = {}) {
  c.font = `${weight} ${size * dpr}px ${FONT}`; c.fillStyle = col; c.textAlign = align; c.textBaseline = base; c.fillText(s, x, y);
}
function drag(cv, onMove) {
  let last = null;
  cv.addEventListener('pointerdown', e => { last = [e.clientX, e.clientY, e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (!last) return; onMove(e.clientX - last[0], e.clientY - last[1]); last[0] = e.clientX; last[1] = e.clientY; dirty = true; });
  cv.addEventListener('pointerup', e => { const moved = last && Math.hypot(e.clientX - last[2], e.clientY - last[3]); last = null; if (moved < 4 && cv._click) cv._click(e); });
}

const cv1 = $('cv1');
let paths = null, pathsAt = null, hits = [];
function rebuildPaths() {
  paths = P.PLANETS.map((p, i) => P.planetPath(i, S.mjd, 256));
  paths.push(P.orbitPath(X.a, X.e, X.i, X.node, X.peri, 512));
  pathsAt = S.mjd;
}
const radial = r => (S.scale === 'log' ? Math.log10(1 + r / 0.2) : r);
function view1(w, h) {
  const k = Math.min(w, h) * 0.46 / radial(S.extent[S.scale]);
  const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
  return v => {
    let [x, y, z] = P.eqToEcl(v);
    const r = Math.hypot(x, y, z);
    if (r > 0) { const s = radial(r) / r; x *= s; y *= s; z *= s; }
    const x1 = cy * x - sy * y, y1 = sy * x + cy * y;
    const y2 = cp * y1 - sp * z, z2 = sp * y1 + cp * z;
    return [w / 2 + x1 * k, h / 2 - y2 * k, z2];
  };
}
function draw1() {
  const { c, w, h, dpr } = fit(cv1);
  c.fillStyle = C.deep; c.fillRect(0, 0, w, h);
  if (!paths || Math.abs(S.mjd - pathsAt) > 365) rebuildPaths();
  const pr = view1(w, h);
  const rings = S.scale === 'log' ? [1, 10, 100, 1000] : [1, 5, 10, 20, 30];
  c.lineWidth = dpr;
  for (const R of rings) {
    if (R > S.extent[S.scale] * 1.6) continue;
    c.beginPath();
    for (let k = 0; k <= 128; k++) { const a = 2 * Math.PI * k / 128, q = pr(P.eclToEq([R * Math.cos(a), R * Math.sin(a), 0])); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
    c.strokeStyle = 'rgba(232,236,244,0.06)'; c.stroke();
    const q = pr(P.eclToEq([R, 0, 0]));
    text(c, `${R} AU`, q[0] + 4 * dpr, q[1] - 4 * dpr, { col: C.faint, size: 10, dpr });
  }
  const o = pr([0, 0, 0]), g = pr(P.eclToEq([radial(S.extent[S.scale]) > 0 ? S.extent[S.scale] * 0.9 : 1, 0, 0]));
  c.setLineDash([2 * dpr, 4 * dpr]); c.strokeStyle = 'rgba(232,236,244,0.10)'; c.beginPath(); c.moveTo(o[0], o[1]); c.lineTo(g[0], g[1]); c.stroke(); c.setLineDash([]);
  text(c, '♈︎', g[0] + 4 * dpr, g[1] + 4 * dpr, { col: C.faint, size: 11, dpr });
  paths.forEach((pts, i) => {
    const sel = (i === paths.length - 1 && S.target === 'planetx') || (P.PLANETS[i] && P.PLANETS[i].id === S.target);
    c.beginPath();
    pts.forEach((v, k) => { const q = pr(v); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
    c.strokeStyle = sel ? 'rgba(233,180,76,0.55)' : i === 2 ? 'rgba(91,181,255,0.35)' : 'rgba(232,236,244,0.16)';
    c.lineWidth = (sel ? 1.4 : 1) * dpr; c.stroke();
  });
  hits = [];
  const earth = P.earthXYZ(S.mjd);
  const bodies = P.PLANETS.map((p, i) => ({ id: p.id, name: p[lang], v: P.planetXYZ(i, S.mjd) }));
  bodies.push({ id: 'planetx', name: 'Planet X', v: P.bodyXYZ(X, S.mjd) });
  const t = tgt(), qe = pr(earth);
  {
    let far;
    if (t.kind === 'star') { const s = skyOf(t, S.mjd); far = P.unit(s.ra, s.dec).map((u, k) => earth[k] + u * S.extent[S.scale] * 3); }
    else far = bodies.find(b => b.id === t.id).v;
    const qf = pr(far);
    c.setLineDash([4 * dpr, 4 * dpr]); c.strokeStyle = 'rgba(233,180,76,0.6)'; c.lineWidth = dpr;
    c.beginPath(); c.moveTo(qe[0], qe[1]); c.lineTo(qf[0], qf[1]); c.stroke(); c.setLineDash([]);
    if (t.kind === 'star') text(c, `→ ${t.name}`, Math.min(w - 8 * dpr, Math.max(8 * dpr, qf[0])), Math.min(h - 8 * dpr, Math.max(14 * dpr, qf[1])), { col: C.sig, size: 11, dpr, align: qf[0] > w / 2 ? 'right' : 'left' });
  }
  c.beginPath(); c.arc(o[0], o[1], 5 * dpr, 0, 2 * Math.PI); c.fillStyle = C.ink; c.fill();
  text(c, 'Sun', o[0] + 8 * dpr, o[1] + 4 * dpr, { col: C.soft, size: 11, dpr });
  bodies.sort((a, b) => pr(a.v)[2] - pr(b.v)[2]);
  for (const b of bodies) {
    const q = pr(b.v), sel = b.id === S.target, isE = b.id === 'earth';
    c.beginPath(); c.arc(q[0], q[1], (sel ? 4.5 : 3) * dpr, 0, 2 * Math.PI);
    c.fillStyle = sel ? C.sig : isE ? C.blue : C.ink; c.fill();
    text(c, b.name, q[0] + 7 * dpr, q[1] - 6 * dpr, { col: sel ? C.sig : isE ? C.blue : C.soft, size: 11, dpr });
    hits.push({ id: b.id === 'earth' ? null : b.id, x: q[0], y: q[1] });
  }
  text(c, S.scale === 'log' ? 'distance: log(1 + r / 0.2 au)' : 'distance: linear', 12 * dpr, h - 12 * dpr, { col: C.faint, size: 10, dpr });
}
drag(cv1, (dx, dy) => { S.yaw += dx * 0.006; S.pitch = Math.max(0, Math.min(1.5, S.pitch + dy * 0.006)); });
cv1.addEventListener('wheel', e => { e.preventDefault(); const k = S.scale; S.extent[k] = Math.max(k === 'log' ? 0.6 : 0.5, Math.min(k === 'log' ? 3000 : 2000, S.extent[k] * Math.exp(e.deltaY * 0.0012))); dirty = true; }, { passive: false });
cv1._click = e => {
  const r = cv1.getBoundingClientRect(), dpr = cv1.width / r.width, x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
  let best = null, bd = 16 * dpr;
  for (const hh of hits) { const d = Math.hypot(hh.x - x, hh.y - y); if (hh.id && d < bd) { bd = d; best = hh.id; } }
  if (best) choose(best);
};

function out1() {
  const t = tgt(), s = skyOf(t, S.mjd), el = P.elongation(s.v, S.mjd), can = P.spherexCanSee(el);
  $('selName').textContent = t.name;
  const rows = [];
  if (t.kind !== 'star') {
    const p = posFn(t)(S.mjd), r = P.norm(p), a = t.kind === 'x' ? X.a : P.planetElements(t.i, S.mjd)[0];
    rows.push(['From the Sun', `${num(r, r < 10 ? 3 : 1)} AU`]);
    rows.push(['From the Earth', `${num(s.delta, s.delta < 10 ? 3 : 1)} AU`]);
    rows.push(['Light time', s.tau < 1 ? `${num(s.tau * 1440, 1)} ${'min'}` : `${num(s.tau, 2)} ${'d'}`]);
    rows.push(['Speed (vis-viva)', `${num(P.visViva(r, a), 2)} km/s`]);
    rows.push(['One orbit', `${num(P.periodYears(a), P.periodYears(a) < 10 ? 2 : 0)} ${'yr'}`]);
    if (s.delta > 5) rows.push(['Annual parallax', ang(206264.806 / s.delta)]);
  } else {
    const a = t.ast;
    rows.push(['Distance', `${num(1 / a.plx, 2)} pc · ${num(3.26156 / a.plx, 2)} ${'ly'}`]);
    rows.push(['Parallax', ang(a.plx)]);
    rows.push(['Proper motion', `${num(Math.hypot(a.pmra, a.pmdec), 3)}″/${'yr'}`]);
  }
  rows.push(['RA', fmtRA(s.ra)], ['Dec', fmtDec(s.dec)]);
  rows.push(['Angle from the Sun', `${num(el, 1)}°`]);
  rows.push(['Can SPHEREx look', can ? 'yes' : 'no', can ? 'yes' : 'no']);
  $('out1').innerHTML = rows.map(([a, b, cl]) => `<dt>${a}</dt><dd${cl ? ` class="${cl}"` : ''}>${b}</dd>`).join('');
  $('note1').textContent = t.kind === 'planet' && (S.mjd < MJD_MIN || S.mjd > MJD_MAX) ? 'The date is outside the orbit table\'s range.' :
    t.kind === 'star' ? 'The star is carried to today by its catalogue proper motion and parallax (off the frame, far away).' : '';
}

const XS = [
  ['a', 'Semi-major axis', 50, 1500, 1, v => `${v} AU`],
  ['e', 'Eccentricity', 0, 0.9, 0.01, v => num(v, 2)],
  ['i', 'Inclination', 0, 90, 0.5, v => `${num(v, 1)}°`],
  ['node', 'Node longitude', 0, 360, 1, v => `${v}°`],
  ['peri', 'Arg. of perihelion', 0, 360, 1, v => `${v}°`],
  ['M0', 'Mean anomaly', 0, 360, 1, v => `${v}°`],
  ['R', 'Radius', 0.5, 10, 0.1, v => `${num(v, 1)} R⊕`],
  ['p', 'Albedo', 0.05, 0.9, 0.01, v => num(v, 2)],
  ['tInt', 'Internal heat', 0, 120, 1, v => `${v} K`],
];
$('xsl').innerHTML = `<h3>${'Orbit'}</h3>` + XS.map(([k, n, lo, hi, st], j) =>
  `${j === 6 ? `<h3>${'Body'}</h3>` : ''}<label class="sl"><span>${n}</span><input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${st}" value="${X[k]}"><output id="xo_${k}"></output></label>`).join('')
  + `<p class="note">${'The mean anomaly is for 2026-01-01. The albedo is used both for reflection and for heating. Internal heat is the temperature the body\'s own heat would give; Neptune\'s measured effective temperature is 59 K. The default 40 K is only an example.'}</p>`;
for (const inp of $('xsl').querySelectorAll('input')) {
  const k = inp.dataset.k, f = XS.find(x => x[0] === k)[5];
  const show = () => { $(`xo_${k}`).textContent = f(X[k]); };
  show();
  inp.addEventListener('input', () => { X[k] = +inp.value; show(); if (['a', 'e', 'i', 'node', 'peri'].includes(k)) paths = null; dirty = true; trackDirty = true; });
}
function out2() {
  const p = P.bodyXYZ(X, S.mjd), r = P.norm(p), { v, tau } = P.apparent(m => P.bodyXYZ(X, m), S.mjd), d = P.norm(v);
  const T = P.tBody(r, X.p, X.tInt), R = X.R * P.R_EARTH;
  const alpha = Math.acos(Math.max(-1, Math.min(1, P.dot(p, v) / r / d)));
  const fl = lam => P.reflectedUJy(lam, X.p, R, r, d * P.AU_KM, alpha) + P.thermalUJy(lam, T, R, d * P.AU_KM);
  const f46 = band(fl, 4.0, 5.0), fV = P.reflectedUJy(0.55, X.p, R, r, d * P.AU_KM, alpha);
  const rows = [
    ['Perihelion / aphelion', `${num(X.a * (1 - X.e), 0)} / ${num(X.a * (1 + X.e), 0)} AU`],
    ['One orbit', `${num(P.periodYears(X.a), 0)} ${'yr'}`],
    ['Speed', `${num(P.visViva(r, X.a), 3)} km/s`],
    ['Light time', `${num(tau * 24, 1)} ${'h'}`],
    ['Equilibrium temp.', `${num(P.tEq(r, X.p), 1)} K`],
    ['Temperature', `${num(T, 1)} K`],
    ['In visible light (0.55 µm)', `AB ${num(P.abMag(fV), 1)}`],
    ['4–5 µm flux', `${sci(f46)} µJy`],
    ['Fraction of the limit', f46 >= LIMIT_UJY ? `${num(f46 / LIMIT_UJY, 1)}×` : `1 / ${sci(LIMIT_UJY / f46)}`],
    ['Would SPHEREx see it', f46 >= LIMIT_UJY ? 'above the limit' : 'no, far too faint', f46 >= LIMIT_UJY ? 'yes' : 'no'],
  ];
  $('out2').innerHTML = rows.map(([a, b, cl]) => `<dt>${a}</dt><dd${cl ? ` class="${cl}"` : ''}>${b}</dd>`).join('');
}
function band(f, lo, hi, n = 40) { let s = 0; for (let k = 0; k < n; k++) s += f(lo + (k + 0.5) * (hi - lo) / n); return s / n; }

const cv3 = $('cv3');
let track = null, trackDirty = true, trackKey = '';
function buildTrack() {
  const t = tgt(), N = 700, m0 = S.mjd - S.span / 2, c0 = skyOf(t, S.mjd);
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const m = m0 + S.span * k / N, s = skyOf(t, m), dir = P.unit(s.ra, s.dec);
    const cz = P.dot(dir, P.unit(c0.ra, c0.dec));
    const [xi, eta] = cz > 0.5 ? P.tangent(s.ra, s.dec, c0.ra, c0.dec) : [NaN, NaN];
    pts.push({ m, xi, eta, see: P.spherexCanSee(P.elongation(s.v, m)) });
  }
  const wins = []; let st = -1;
  pts.forEach((p, k) => { if (p.see && st < 0) st = k; if ((!p.see || k === N) && st >= 0) { const e = p.see ? k : k - 1; wins.push(pts[Math.round((st + e) / 2)]); st = -1; } });
  track = { pts, wins, c0 };
  trackKey = `${S.target}|${S.span}|${Math.round(S.mjd * (S.span < 100 ? 4 : 1))}`;
}
function draw3() {
  const { c, w, h, dpr } = fit(cv3);
  c.fillStyle = C.deep; c.fillRect(0, 0, w, h);
  const key = `${S.target}|${S.span}|${Math.round(S.mjd * (S.span < 100 ? 4 : 1))}`;
  if (trackDirty || key !== trackKey) { buildTrack(); trackDirty = false; }
  const { pts, wins } = track, ok = pts.filter(p => Number.isFinite(p.xi));
  let ext = 1;
  for (const p of ok) ext = Math.max(ext, Math.abs(p.xi), Math.abs(p.eta));
  ext *= 1.18;
  const k = Math.min(w, h) / 2 / ext, X0 = w / 2, Y0 = h / 2, q = p => [X0 - p.xi * k, Y0 - p.eta * k];
  c.strokeStyle = C.rule; c.lineWidth = dpr; c.beginPath(); c.moveTo(0, Y0); c.lineTo(w, Y0); c.moveTo(X0, 0); c.lineTo(X0, h); c.stroke();
  FOV.forEach((f, j) => {
    const half = f * 60 / 2 * k;
    if (half > Math.max(w, h)) return;
    c.setLineDash(j ? [3 * dpr, 4 * dpr] : []); c.strokeStyle = 'rgba(232,236,244,0.28)'; c.strokeRect(X0 - half, Y0 - half, 2 * half, 2 * half); c.setLineDash([]);
    text(c, `${num(f, 1)}′`, X0 + half - 4 * dpr, Y0 - half + 13 * dpr, { col: C.faint, size: 10, dpr, align: 'right' });
  });
  for (const pass of [0, 1]) {
    c.beginPath(); let on = false;
    for (const p of pts) {
      if (!Number.isFinite(p.xi) || (pass && !p.see)) { on = false; continue; }
      const [x, y] = q(p); on ? c.lineTo(x, y) : c.moveTo(x, y); on = true;
    }
    c.strokeStyle = pass ? C.ink : 'rgba(232,236,244,0.25)'; c.lineWidth = (pass ? 2.6 : 1) * dpr; c.stroke();
  }
  wins.forEach(p => { if (!Number.isFinite(p.xi)) return; const [x, y] = q(p); c.beginPath(); c.arc(x, y, 3 * dpr, 0, 2 * Math.PI); c.fillStyle = C.ink; c.fill(); text(c, isoDay(p.m).slice(0, 7), x + 6 * dpr, y + 12 * dpr, { col: C.faint, size: 10, dpr }); });
  c.beginPath(); c.arc(X0, Y0, 5 * dpr, 0, 2 * Math.PI); c.fillStyle = C.sig; c.fill();
  text(c, 'N', 16 * dpr, 20 * dpr, { col: C.soft, size: 11, dpr, align: 'center' });
  text(c, 'E', 34 * dpr, 38 * dpr, { col: C.soft, size: 11, dpr, align: 'center' });
  c.strokeStyle = C.soft; c.beginPath(); c.moveTo(16 * dpr, 34 * dpr); c.lineTo(16 * dpr, 24 * dpr); c.moveTo(16 * dpr, 34 * dpr); c.lineTo(28 * dpr, 34 * dpr); c.stroke();
  const nice = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 18000, 36000, 72000];
  const bar = nice.find(v => v * k > w * 0.12) || nice[nice.length - 1];
  c.strokeStyle = C.soft; c.beginPath(); c.moveTo(w - 14 * dpr - bar * k, h - 16 * dpr); c.lineTo(w - 14 * dpr, h - 16 * dpr); c.stroke();
  text(c, ang(bar), w - 14 * dpr - bar * k / 2, h - 22 * dpr, { col: C.soft, size: 10, dpr, align: 'center' });
}
function out3() {
  if (!track) return;
  const { wins } = track, t = tgt();
  const shifts = [];
  for (let k = 1; k < wins.length; k++) if (Number.isFinite(wins[k].xi) && Number.isFinite(wins[k - 1].xi)) shifts.push(Math.hypot(wins[k].xi - wins[k - 1].xi, wins[k].eta - wins[k - 1].eta));
  const med = shifts.length ? shifts.slice().sort((a, b) => a - b)[shifts.length >> 1] : NaN;
  const seeFrac = track.pts.filter(p => p.see).length / track.pts.length;
  const rows = [
    ['Windows SPHEREx can look', `${wins.length}`],
    ['Days it can look', `%${num(100 * seeFrac, 0)}`],
    ['Shift between windows', Number.isFinite(med) ? ang(med) : '—'],
    ['Shift / 5.0′ plate', Number.isFinite(med) ? num(med / (FOV[0] * 60), 2) : '—'],
  ];
  const leaves = Number.isFinite(med) && med > FOV[0] * 60 / 2;
  rows.push(['Stays on the plate', Number.isFinite(med) ? (leaves ? 'no, it leaves' : 'yes') : '—', Number.isFinite(med) ? (leaves ? 'no' : 'yes') : '']);
  $('out3').innerHTML = rows.map(([a, b, cl]) => `<dt>${a}</dt><dd${cl ? ` class="${cl}"` : ''}>${b}</dd>`).join('');
  $('note3').textContent = t.kind === 'planet' && S.span > 400 ? 'Planets travel far across the sky; the 60-day span reads better. Points more than 60° from the centre are not drawn.'
    : t.id === 'planetx' ? 'The shift comes from the Earth moving along its orbit (parallax); the body\'s own motion is small next to it.' : '';
}

const cv4 = $('cv4');
function spectrumOf(t) {
  if (t.kind === 'star') {
    if (t.id !== 'wise0855') return null;
    const d = (1 / t.ast.plx) * P.PC_AU * P.AU_KM, R = BD.R * P.R_JUP;
    return { refl: () => 0, therm: lam => P.thermalUJy(lam, BD.T, R, d), T: BD.T };
  }
  const p = posFn(t)(S.mjd), r = P.norm(p), { v } = P.apparent(posFn(t), S.mjd), d = P.norm(v) * P.AU_KM;
  const alpha = Math.acos(Math.max(-1, Math.min(1, P.dot(p, v) / r / P.norm(v))));
  const R = t.kind === 'x' ? X.R * P.R_EARTH : P.PLANETS[t.i].R, alb = t.kind === 'x' ? X.p : P.PLANETS[t.i].p;
  const T = t.kind === 'x' ? P.tBody(r, X.p, X.tInt) : P.tEq(r, 0.3);
  return { refl: lam => P.reflectedUJy(lam, alb, R, r, d, alpha), therm: lam => P.thermalUJy(lam, T, R, d), T, alpha };
}
function draw4() {
  const { c, w, h, dpr } = fit(cv4);
  c.fillStyle = C.deep; c.fillRect(0, 0, w, h);
  const t = tgt(), sp = spectrumOf(t);
  const ml = 46 * dpr, mr = 14 * dpr, mt = 14 * dpr, mb = 30 * dpr;
  const xl = lam => ml + (lam - 0.75) / 4.25 * (w - ml - mr);
  if (!sp) { text(c, 'No light model for this body.', w / 2, h / 2, { col: C.faint, size: 12, dpr, align: 'center' }); return; }
  const N = 300, lam = Array.from({ length: N + 1 }, (_, k) => 0.75 + 4.25 * k / N);
  const R = lam.map(sp.refl), T = lam.map(sp.therm), S2 = lam.map((_, k) => R[k] + T[k]);
  let hi = Math.max(...S2, LIMIT_UJY * 3);
  if (t.id === 'wise0855' && MEAS) hi = Math.max(hi, ...MEAS.map(b => b.f + b.e));
  const top = Math.ceil(Math.log10(hi) + 0.2), bot = top - 9;
  const yl = f => mt + (top - Math.log10(Math.max(f, 10 ** (bot - 1)))) / (top - bot) * (h - mt - mb);
  c.lineWidth = dpr;
  for (let e = bot; e <= top; e++) {
    const y = yl(10 ** e); c.strokeStyle = C.rule; c.beginPath(); c.moveTo(ml, y); c.lineTo(w - mr, y); c.stroke();
    if ((top - e) % 2 === 0) text(c, `10${String(e).replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`, ml - 6 * dpr, y + 4 * dpr, { col: C.faint, size: 10, dpr, align: 'right' });
  }
  for (const l of [1, 2, 3, 4, 5]) { const x = xl(l); text(c, `${l}${l === 5 ? ' µm' : ''}`, x, h - 10 * dpr, { col: C.faint, size: 10, dpr, align: l === 5 ? 'right' : 'center' }); }
  text(c, 'µJy', ml + 6 * dpr, mt + 14 * dpr, { col: C.faint, size: 10, dpr });
  for (const [a, b] of [[3.0, 3.8], [4.0, 5.0]]) { c.fillStyle = 'rgba(232,236,244,0.035)'; c.fillRect(xl(a), mt, xl(b) - xl(a), h - mt - mb); }
  c.strokeStyle = C.red; c.lineWidth = 1.2 * dpr; c.beginPath(); c.moveTo(xl(4.0), yl(LIMIT_UJY)); c.lineTo(xl(5.0), yl(LIMIT_UJY)); c.stroke();
  text(c, `${'limit'} ${LIMIT_UJY} µJy`, xl(4.0) - 6 * dpr, yl(LIMIT_UJY) + 4 * dpr, { col: C.red, size: 10, dpr, align: 'right' });
  const line = (arr, dash, col, wd) => {
    c.setLineDash(dash.map(v => v * dpr)); c.strokeStyle = col; c.lineWidth = wd * dpr; c.beginPath(); let on = false;
    arr.forEach((f, k) => { if (!(f > 10 ** (bot - 1))) { on = false; return; } const x = xl(lam[k]), y = yl(f); on ? c.lineTo(x, y) : c.moveTo(x, y); on = true; });
    c.stroke(); c.setLineDash([]);
  };
  line(R, [5, 4], C.soft, 1); line(T, [1.5, 3], C.soft, 1.2); line(S2, [], C.sig, 1.8);
  if (t.id === 'wise0855' && MEAS) for (const b of MEAS) {
    const x0 = xl(b.lo), x1 = xl(b.hi), y = yl(Math.max(b.f, 1e-9));
    if (b.f <= 0) continue;
    c.strokeStyle = C.ink; c.lineWidth = dpr; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.moveTo((x0 + x1) / 2, yl(b.f - b.e)); c.lineTo((x0 + x1) / 2, yl(b.f + b.e)); c.stroke();
    c.fillStyle = C.ink; c.fillRect((x0 + x1) / 2 - 3.5 * dpr, y - 3.5 * dpr, 7 * dpr, 7 * dpr);
  }
}
function brightnessT(t, f, lo, hi) {
  const d = (1 / t.ast.plx) * P.PC_AU * P.AU_KM, R = BD.R * P.R_JUP;
  let a = 50, b = 3000;
  for (let k = 0; k < 60; k++) { const m = (a + b) / 2; band(l => P.thermalUJy(l, m, R, d), lo, hi) < f ? (a = m) : (b = m); }
  return (a + b) / 2;
}
function out4() {
  const t = tgt(), sp = spectrumOf(t);
  $('bdsl').innerHTML = '';
  if (!sp) { $('out4').innerHTML = ''; $('note4').textContent = 'This page has no light model for Barnard\'s star; Ektos uses it only for position.'; return; }
  const r46 = sp.refl(4.6), t46 = sp.therm(4.6), b = band(l => sp.refl(l) + sp.therm(l), 4.0, 5.0);
  const rows = [
    ['Reflected', `${sci(r46)} µJy`], ['Thermal', `${sci(t46)} µJy`], ['Total', `${sci(r46 + t46)} µJy`],
    ['4–5 µm mean', `${sci(b)} µJy · AB ${num(P.abMag(b), 1)}`],
    ['Temperature used', `${num(sp.T, 1)} K`],
  ];
  if (t.id === 'wise0855' && MEAS) {
    const m = MEAS.find(x => x.lo === 4.4), mod = band(sp.therm, 4.4, 5.0);
    rows.push(['Measured 4.4–5.0 µm', `${num(m.f, 0)} ± ${num(m.e, 0)} µJy`]);
    rows.push(['Measured / model', `${num(m.f / mod, 1)}×`, m.f / mod > 1.5 || m.f / mod < 0.67 ? 'no' : 'yes']);
    rows.push(['Temperature that fits', `${num(brightnessT(t, m.f, 4.4, 5.0), 0)} K`]);
    $('bdsl').innerHTML = `<h3>${'Blackbody'}</h3>`
      + `<label class="sl"><span>${'Temperature'}</span><input type="range" id="bdT" min="150" max="900" step="5" value="${BD.T}"><output>${BD.T} K</output></label>`
      + `<label class="sl"><span>${'Radius'}</span><input type="range" id="bdR" min="0.6" max="1.4" step="0.01" value="${BD.R}"><output>${num(BD.R, 2)} R♃</output></label>`;
    $('bdT').oninput = e => { BD.T = +e.target.value; dirty = true; e.target.nextElementSibling.textContent = `${BD.T} K`; };
    $('bdR').oninput = e => { BD.R = +e.target.value; dirty = true; e.target.nextElementSibling.textContent = `${num(BD.R, 2)} R♃`; };
    $('note4').textContent = 'In Y dwarfs, 4–5 µm is a window where light escapes from deeper, hotter layers. So a blackbody at the effective temperature badly underpredicts the flux. The squares are the SPHEREx flux Ektos measured for this object.';
  } else {
    $('note4').textContent = t.kind === 'planet' ? 'For planets the albedo is the visible-light value, taken here as the same at every wavelength. Methane planets are much darker than this at 3–5 µm.'
      : 'Planet X\'s 4–5 µm light is almost all reflected sunlight; its own heat only shows above about 150 K.';
  }
  $('out4').innerHTML = rows.map(([a, bb, cl]) => `<dt>${a}</dt><dd${cl ? ` class="${cl}"` : ''}>${bb}</dd>`).join('');
}

const cv5 = $('cv5');
function spxNode(m) { return P.meanSunLon(m) + (ORB ? ORB.node_minus_mean_sun_deg : P.SPX_ORBIT.nodeSun); }
function spxPhase(m) {
  const a = ORB ? ORB.a_km : P.SPX_ORBIT.a, inc = ORB ? ORB.inc_deg : P.SPX_ORBIT.inc;
  const Tm = P.orbitPeriodMin(a);
  let near = null;
  if (ORB) { let bd = Infinity; for (const p of ORB.pos) { const d = Math.abs(p[0] - m); if (d < bd) { bd = d; near = p; } } }
  const m0 = near ? near[0] : 61041, u0 = near ? P.argLat(near.slice(1), inc, spxNode(near[0])) : 0;
  return { u: (u0 + 360 * (m - m0) * 1440 / Tm) % 360, a, inc, Tm, gap: near ? Math.abs(near[0] - m) : Infinity };
}
function inShadow(p, sun) { const s = P.dot(p, sun); return s < 0 && P.norm(p.map((v, k) => v - s * sun[k])) < P.R_EARTH_EQ; }
function sunDir(m) { const e = P.earthXYZ(m), n = P.norm(e); return e.map(v => -v / n); }
function draw5() {
  const { c, w, h, dpr } = fit(cv5);
  c.fillStyle = C.deep; c.fillRect(0, 0, w, h);
  const ph = spxPhase(S.mjd), node = spxNode(S.mjd), sun = sunDir(S.mjd);
  const RE = P.R_EARTH_EQ, k = Math.min(w, h) * 0.40 / ph.a;
  const cy = Math.cos(S.eyaw), sy = Math.sin(S.eyaw), cp = Math.cos(S.epitch), sp = Math.sin(S.epitch);
  const pr = v => { const x1 = cy * v[0] + sy * v[1], y1 = -sy * v[0] + cy * v[1]; return [x1, cp * v[2] - sp * y1, sp * v[2] + cp * y1]; };
  const X0 = w / 2, Y0 = h / 2, scr = v => { const q = pr(v); return [X0 + q[0] * k, Y0 - q[1] * k, q[2]]; };
  const s = pr(sun), Rp = RE * k;
  c.beginPath(); c.arc(X0, Y0, Rp, 0, 2 * Math.PI); c.fillStyle = '#0E1322'; c.fill();
  {
    const th = Math.atan2(-s[1], s[0]), sz = s[2] / Math.hypot(s[0], s[1], s[2]);
    c.save(); c.translate(X0, Y0); c.rotate(th);
    c.beginPath(); c.arc(0, 0, Rp, -Math.PI / 2, Math.PI / 2, false);
    c.ellipse(0, 0, Rp * Math.abs(sz), Rp, 0, Math.PI / 2, -Math.PI / 2, sz < 0);
    c.fillStyle = '#3A4866'; c.fill(); c.restore();
  }
  c.beginPath(); c.arc(X0, Y0, Rp, 0, 2 * Math.PI); c.strokeStyle = C.ruleS; c.lineWidth = dpr; c.stroke();
  const ring = (fn, n, col, wd, front) => {
    c.beginPath(); let on = false;
    for (let j = 0; j <= n; j++) {
      const v = fn(2 * Math.PI * j / n), q = scr(v), behind = q[2] < 0 && Math.hypot(q[0] - X0, q[1] - Y0) < Rp;
      if (front !== undefined && behind === front) { on = false; continue; }
      on ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); on = true;
    }
    c.strokeStyle = col; c.lineWidth = wd * dpr; c.stroke();
  };
  ring(a => [RE * Math.cos(a), RE * Math.sin(a), 0], 128, 'rgba(232,236,244,0.18)', 1, true);
  const np = scr([0, 0, RE * 1.12]); text(c, 'N', np[0], np[1], { col: C.faint, size: 10, dpr, align: 'center' });
  const orb = u => P.orbitPoint(ph.a, ph.inc, node, u * P.R2D);
  ring(orb, 256, 'rgba(232,236,244,0.12)', 1, false);
  ring(orb, 256, 'rgba(232,236,244,0.45)', 1.2, true);
  if (ORB) for (const p of ORB.pos) {
    if (Math.abs(p[0] - S.mjd) > 1) continue;
    const q = scr(p.slice(1)), behind = q[2] < 0 && Math.hypot(q[0] - X0, q[1] - Y0) < Rp;
    c.beginPath(); c.arc(q[0], q[1], 4.5 * dpr, 0, 2 * Math.PI); c.strokeStyle = behind ? 'rgba(232,236,244,0.3)' : C.ink; c.lineWidth = 1.4 * dpr; c.stroke();
  }
  const sl = Math.hypot(s[0], s[1]) || 1, ux = s[0] / sl, uy = -s[1] / sl;
  const reach = Math.min(...[ux > 0 ? (w - X0 - 40 * dpr) / ux : ux < 0 ? (X0 - 40 * dpr) / -ux : Infinity, uy > 0 ? (h - Y0 - 20 * dpr) / uy : uy < 0 ? (Y0 - 20 * dpr) / -uy : Infinity]);
  const sa = [X0 + ux * Math.min(reach - 30 * dpr, Rp * 1.5), Y0 + uy * Math.min(reach - 30 * dpr, Rp * 1.5)], sb = [X0 + ux * reach, Y0 + uy * reach];
  c.strokeStyle = C.soft; c.lineWidth = dpr; c.beginPath(); c.moveTo(sa[0], sa[1]); c.lineTo(sb[0], sb[1]); c.stroke();
  text(c, `${'Sun'} →`, sb[0], sb[1] - 6 * dpr, { col: C.soft, size: 10, dpr, align: 'center' });
  const pos = orb(ph.u * P.D2R), q = scr(pos), hid = q[2] < 0 && Math.hypot(q[0] - X0, q[1] - Y0) < Rp;
  c.beginPath(); c.arc(q[0], q[1], 4.5 * dpr, 0, 2 * Math.PI); c.fillStyle = hid ? 'rgba(233,180,76,0.35)' : C.sig; c.fill();
  text(c, 'SPHEREx', q[0] + 8 * dpr, q[1] - 6 * dpr, { col: hid ? C.faint : C.sig, size: 11, dpr });
}
drag(cv5, (dx, dy) => { S.eyaw += dx * 0.008; S.epitch = Math.max(-1.5, Math.min(1.5, S.epitch + dy * 0.008)); });
let shadowCache = { key: '', v: 0 };
function out5() {
  const ph = spxPhase(S.mjd), node = spxNode(S.mjd), sun = sunDir(S.mjd), pos = P.orbitPoint(ph.a, ph.inc, node, ph.u);
  const key = Math.floor(S.mjd);
  if (shadowCache.key !== key) {
    let n = 0; for (let j = 0; j < 720; j++) if (inShadow(P.orbitPoint(ph.a, ph.inc, node, j / 2), sun)) n++;
    shadowCache = { key, v: n / 720 };
  }
  const ltm = Math.round((((node - P.meanSunLon(S.mjd)) / 15 + 12 + 48) % 24) * 60) % 1440, hh = Math.floor(ltm / 60), mm = ltm % 60;
  const rows = [
    ['Height (measured)', `${num(ph.a - P.R_EARTH_EQ, 0)} km`],
    ['One orbit, Kepler III', `${num(ph.Tm, 2)} ${'min'}`],
    ['Orbits a day', num(1440 / ph.Tm, 2)],
    ['Speed', `${num(Math.sqrt(P.GM_EARTH / ph.a), 2)} km/s`],
    ['Inclination (measured)', `${num(ph.inc, 2)}°`],
    ['Inclination, J2 sun-synchronous', `${num(P.sunSyncInclination(ph.a), 2)}°`],
    ['Node turns by', `${num(P.nodeRateDegPerDay(ph.a, ph.inc), 4)}°/${'d'}`],
    ['Local time of ascending node', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`],
    ['Right now', inShadow(pos, sun) ? 'in the Earth\'s shadow' : 'in sunlight'],
    ['Share of today\'s orbit in shadow', `%${num(100 * shadowCache.v, 1)}`],
  ];
  $('out5').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('note5').textContent = !ORB ? '' : ph.gap > 2 ? `No real position near this date (the nearest is ${num(ph.gap, 0)} days away). Real positions span ${isoDay(ORB.pos[0][0])} to ${isoDay(ORB.pos[ORB.pos.length - 1][0])}.`
    : 'The spacecraft\'s place on the orbit is tied to the nearest real position and runs on from there by Kepler III.';
}

function checks() {
  const rows = [];
  const add = (name, sim, ref, ok, ctl) => rows.push(`<tr><td>${name}</td><td>${sim}</td><td>${ref}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'holds' : 'fails'}</td></tr>${ctl ? `<tr class="ctl"><td>${'control'}</td><td colspan="3">${ctl}</td></tr>` : ''}`);
  if (REF) {
    const worst = P.PLANETS.map((p, i) => Math.max(...REF.rows.map(r => { const a = P.planetXYZ(i, r.mjd), b = r.helio[p.id]; return Math.acos(Math.min(1, P.dot(a, b) / P.norm(a) / P.norm(b))) * P.R2D * 3600; })));
    const inner = Math.max(...worst.slice(0, 4)), outer = Math.max(...worst.slice(4));
    const late = (() => { const r = REF.rows[4], a = P.planetXYZ(2, r.mjd + 1), b = r.helio.earth; return Math.acos(P.dot(a, b) / P.norm(a) / P.norm(b)) * P.R2D * 3600; })();
    add('Planet positions, 6 dates (1900–2049)', `${'worst'}: ${'inner'} ${num(inner, 0)}″, ${'outer'} ${num(outer, 0)}″`, 'astropy 8.0.2 built-in ephemeris (ERFA)', inner < 120 && outer < 1200,
      `With the Earth one day late the difference is ${num(late, 0)}″.`);
  }
  { let res = 0; for (let k = 0; k < 20000; k++) { const e = Math.random() * 0.995, M = (Math.random() * 2 - 1) * Math.PI, E = P.solveKepler(M, e); res = Math.max(res, Math.abs(E - e * Math.sin(E) - M)); }
    add('Kepler\'s equation, 20000 random orbits', `${'worst residual'} ${res.toExponential(1)} rad`, 'E − e sin E = M', res < 1e-12); }
  { const Y = P.periodYears(P.PLANETS[2].el[0]) * 365.25; add('The Earth\'s year, Kepler III', `${num(Y, 3)} ${'d'}`, 'sidereal year 365.256 d', Math.abs(Y - 365.256) < 0.01); }
  { const s = P.solarConstant(); add('Solar constant, 5772 K blackbody', `${num(s, 1)} W/m²`, 'measured 1360.8 ± 0.5 W/m² (Kopp & Lean 2011)', Math.abs(s - 1360.8) < 5); }
  { const F = P.reflectedUJy(0.55, 0.442, 24622, 30.07, 29.07 * P.AU_KM, 0); add('Neptune\'s brightness at opposition', `AB ${num(P.abMag(F), 2)}`, 'published V ≈ 7.8', Math.abs(P.abMag(F) - 7.8) < 0.3); }
  if (ORB) {
    const T = P.orbitPeriodMin(ORB.a_km), i = P.sunSyncInclination(ORB.a_km);
    add('SPHEREx orbit, Kepler III', `${num(T, 2)} ${'min'}`, `measured from angular rate ${num(ORB.period_min, 2)} min (Python)`, Math.abs(T - ORB.period_min) < 0.3);
    add('SPHEREx inclination, J2 sun-synchronous', `${num(i, 2)}°`, `measured ${num(ORB.inc_deg, 2)}° (Python)`, Math.abs(i - ORB.inc_deg) < 0.2);
    const oop = (nodeOff) => { const v = ORB.pos.map(([m, x, y, z]) => Math.asin(Math.abs(P.dot(P.orbitNormal(ORB.inc_deg, P.meanSunLon(m) + nodeOff), [x, y, z])) / P.norm([x, y, z])) * P.R2D).sort((a, b) => a - b); return v[v.length >> 1]; };
    add(`Model orbital plane, ${ORB.pos.length} real positions`, `${'median distance from plane'} ${num(oop(ORB.node_minus_mean_sun_deg), 2)}°`, 'the spacecraft\'s real positions', oop(ORB.node_minus_mean_sun_deg) < 1,
      `With the node turned 90° the distance becomes ${num(oop(ORB.node_minus_mean_sun_deg + 90), 1)}°.`);
  }
  if (PNT) {
    const el = f => f.mjd.map(m => P.elongation(P.unit(f.center[0], f.center[1]), m));
    const pct = (v, q) => { const s = [...v].sort((a, b) => a - b); const i = q * (s.length - 1), k = Math.floor(i); return s[k] + (s[Math.min(k + 1, s.length - 1)] - s[k]) * (i - k); };
    const train = PNT.fields.filter((f, i) => i % 2 === 0).flatMap(el), lo = pct(train, 0.01), hi = pct(train, 0.99);
    const test = PNT.fields.filter((f, i) => i % 2 === 1), inWin = e => e >= lo && e <= hi;
    const share = list => list.filter(inWin).length / list.length;
    const held = share(test.flatMap(el)), moved = share(test.flatMap(f => el({ ...f, mjd: f.mjd.map(m => m + 91) })));
    const py = PNT.python, nTest = test.reduce((s, f) => s + f.mjd.length, 0);
    add(`Pointing rule: the window from ${PNT.fields.length / 2} fields, on the other ${test.length}`,
      `window ${num(lo, 1)}–${num(hi, 1)}°; ${num(100 * held, 1)} % of ${nTest} exposures inside`,
      `Python (astropy Sun): ${num(py.window[0], 1)}–${num(py.window[1], 1)}°, ${num(100 * py.held_out_inside, 1)} %`,
      held > 0.97 && moved < 0.7 && Math.abs(lo - py.window[0]) < 0.5 && Math.abs(hi - py.window[1]) < 0.5,
      `With the same dates moved by 91 days, ${num(100 * moved, 1)} % fall inside (Python ${num(100 * py.control_inside, 1)} %).`);
    const wf = PNT.fields.find(f => f.slug === 'wise0855');
    if (wf) {
      const other = PNT.fields.filter(f => !f.slug.startsWith('wise0855')).flatMap(el), lo2 = pct(other, 0.01), hi2 = pct(other, 0.99);
      const ms = [...wf.mjd].sort((a, b) => a - b), groups = [[ms[0]]];
      for (let k = 1; k < ms.length; k++) (ms[k] - ms[k - 1] > 60 ? groups.push([ms[k]]) : groups[groups.length - 1].push(ms[k]));
      const vis = groups.map(v => v.reduce((a, b) => a + b, 0) / v.length);
      const ev = vis.map(m => P.elongation(P.unit(wf.center[0], wf.center[1]), m));
      add('WISE 0855\'s visits, in a window built without it', ev.map(e => `${num(e, 1)}°`).join(', '),
        `window of the other ${PNT.fields.length - 2} fields ${num(lo2, 1)}–${num(hi2, 1)}°`, ev.every(e => e >= lo2 && e <= hi2));
    }
  }
  {
    const x = { a: 500, e: 0, i: 0, node: 0, peri: 0, M0: 0, mjd0: 61041 }; let lo = 1e9, hi = -1e9, r0 = null;
    for (let m = 61041; m < 61041 + 365.25; m += 2) { const { v } = P.apparent(mm => P.bodyXYZ(x, mm), m), [ra, dec] = P.radec(v); r0 = r0 || [ra, dec]; const [xi] = P.tangent(ra, dec, r0[0], r0[1]); lo = Math.min(lo, xi); hi = Math.max(hi, xi); }
    add('One year\'s path of a body at 500 au', `${num((hi - lo) / 60, 1)}′`, 'parallax: 2 × 206265″ / 500 = 13.75′; the body\'s own 1.9′ a year changes the range a little', Math.abs((hi - lo) / 60 - 13.75) < 0.95);
  }
  const w = TARGETS.find(t => t.id === 'wise0855');
  if (w && w.ast && MEAS) {
    const d = (1 / w.ast.plx) * P.PC_AU * P.AU_KM, mod = band(l => P.thermalUJy(l, 285, P.R_JUP, d), 4.4, 5.0), m = MEAS.find(x => x.lo === 4.4);
    add('WISE 0855 4.4–5 µm, 285 K blackbody', `${num(mod, 0)} µJy`, `measured by Ektos ${num(m.f, 0)} ± ${num(m.e, 0)} µJy`, Math.abs(mod - m.f) < 3 * m.e,
      `The blackbody underpredicts by ${num(m.f / mod, 0)}×; this is the model's limit, shown in the light panel.`);
  }
  $('chk').innerHTML = rows.join('');
}

$('pick').innerHTML = TARGETS.map(t => `<button type="button" data-id="${t.id}">${t.name}</button>`).join('');
for (const b of $('pick').querySelectorAll('button')) b.onclick = () => choose(b.dataset.id);
function choose(id) {
  S.target = id; trackDirty = true; dirty = true;
  for (const b of $('pick').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  const t = tgt();
  if (t.kind === 'planet' && S.span > 400) setSpan(60);
  else if (t.kind !== 'planet' && S.span < 100) setSpan(1095.75);
}
function setSpan(v) { S.span = v; trackDirty = true; dirty = true; for (const b of $('span').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.v === v)); }
for (const b of $('span').querySelectorAll('button')) b.onclick = () => setSpan(+b.dataset.v);
for (const b of $('scale').querySelectorAll('button')) b.onclick = () => { S.scale = b.dataset.v; dirty = true; for (const x of $('scale').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b)); };
$('scale').querySelector('[data-v="log"]').setAttribute('aria-pressed', 'true');
$('play').onclick = () => { S.playing = !S.playing; $('play').textContent = S.playing ? '❚❚' : '▶'; $('play').setAttribute('aria-pressed', String(S.playing)); };
$('back').onclick = () => { S.dir = -1; S.playing = true; $('play').textContent = '❚❚'; };
$('fwd').onclick = () => { S.dir = 1; S.playing = true; $('play').textContent = '❚❚'; };
$('rate').onchange = e => { S.rate = +e.target.value; };
$('today').onclick = () => { S.mjd = P.mjdOfDate(new Date()); dirty = true; trackDirty = true; };
$('date').onchange = e => { const d = new Date(`${e.target.value}T00:00:00Z`); if (!isNaN(d)) { S.mjd = P.mjdOfDate(d); dirty = true; trackDirty = true; } };

let dirty = true, last = performance.now(), slow = 0;
const visible = new Set();
const io = new IntersectionObserver(es => { for (const e of es) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id); dirty = true; });
for (const id of ['cv1', 'cv3', 'cv4', 'cv5']) io.observe($(id));
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.playing) { S.mjd += S.dir * S.rate * dt; dirty = true; }
  if (S.mjd < MJD_MIN) { S.mjd = MJD_MIN; S.playing = false; }
  if (S.mjd > MJD_MAX) { S.mjd = MJD_MAX; S.playing = false; }
  if (dirty) {
    dirty = false;
    const d = P.dateOfMjd(S.mjd);
    $('now').textContent = d.toISOString().slice(0, 16).replace('T', ' ');
    if (document.activeElement !== $('date')) $('date').value = d.toISOString().slice(0, 10);
    const edge = S.mjd <= MJD_MIN + 1 || S.mjd >= MJD_MAX - 1;
    $('warn').hidden = !edge; $('warn').textContent = edge ? 'The orbit table is valid for 1800–2050.' : '';
    if (visible.has('cv1')) draw1();
    if (visible.has('cv3')) draw3();
    if (visible.has('cv4')) draw4();
    if (visible.has('cv5')) draw5();
    if (now - slow > 200) { slow = now; out1(); out2(); out3(); out4(); out5(); }
  }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => { dirty = true; });

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }
{
  const names = ['data/wise0855/manifest.json', 'data/barnard/manifest.json', 'data/wise0855/candidate.json',
    'data/spherex_orbit.json', 'data/sim_ref.json', 'data/index.json', 'data/spherex_pointing.json'];
  const got = await Promise.allSettled(names.map(getJSON));
  const [w, b, cand, orb, ref, idx, pnt] = got.map(g => (g.status === 'fulfilled' ? g.value : null));
  const missing = names.filter((n, i) => got[i].status !== 'fulfilled');
  if (missing.length) console.warn('sim: data missing', missing);
  const W = TARGETS.find(t => t.id === 'wise0855');
  if (w && W) { W.ast = w.astrometry; W.visits = w.visits; }
  const B = TARGETS.find(t => t.id === 'barnard');
  if (b && B) B.ast = b.astrometry;
  if (cand && cand.bins) MEAS = Object.entries(cand.bins).filter(([, v]) => v).map(([k, v]) => { const [lo, hi] = k.split('-').map(Number); return { lo, hi, f: v.flux, e: v.err }; });
  ORB = orb; REF = ref; PNT = pnt;
  if (idx) FOV = [idx.wise0855 ? idx.wise0855.fov : 5.02, idx.wise0855_h40 ? idx.wise0855_h40.fov : 8.3];
  let gone = false;
  for (const id of ['wise0855', 'barnard']) { const i = TARGETS.findIndex(t => t.id === id); if (i >= 0 && !TARGETS[i].ast) { TARGETS.splice(i, 1); gone = true; } }
  if (gone) {
    $('pick').innerHTML = TARGETS.map(t => `<button type="button" data-id="${t.id}">${t.name}</button>`).join('');
    for (const bb of $('pick').querySelectorAll('button')) bb.onclick = () => choose(bb.dataset.id);
  }
}
choose('planetx'); setSpan(1095.75);
checks();
window.__sim = { S, X, P, choose, setSpan, checks };
requestAnimationFrame(frame);
