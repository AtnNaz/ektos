import * as E from './engine.js';

const INK = '#E8ECF4', SOFT = '#9BA5B8', RULE = 'rgba(232,236,244,0.22)', BRASS = '#E9B44C', GLASS = '#0A0E18';
const TXT = {
  en: {
    astro: 'Motion and distance', astroNote: 'Each point is one date. Take away the straight motion of the object and a small wobble is left that repeats every year. This wobble gives the distance. Light points are WISE, amber points are SPHEREx, the curve is the wobble we measured.',
    pm: 'Motion per year', plx: 'Wobble (parallax)', dist: 'Distance', lit: 'published', fitWS: 'WISE + SPHEREx', noPlx: 'Model without wobble', chi: 'Fit (χ²)',
    pred: 'Blind test: did the WISE data alone predict where SPHEREx finds the object?', deb: 'stars removed', bl: 'stars not removed', obsPred: 'measured − predicted',
    cand: 'Is there a cold object here?', candNote: 'Lines are empty points of sky (the control). The amber marker is the target. Rings are the points on the other side of the nearby stars.',
    bandFlux: 'Brightness', excess: 'Extra light at 4.4–5.0 µm', controls: 'empty points', asLarge: 'of them are this bright', pEmp: 'chance of a coincidence', scatter: 'Crowding noise', to: '→',
    varT: 'Change in brightness', varNote: 'The brightness of the star over time, worked out from all colours together. Faint points are a control star in the same field.',
    period: 'Period', days: 'd',
    amp: 'From brightest to faintest', sat: 'The centre of the star is too bright, so its edges were measured', core: 'Exposures measured', ctrl: 'Change in the control star', mag: 'mag',
  },
};

async function get(url) { try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
let K = 1;
const FS = base => Math.max(base, Math.ceil(11 * K));
function axes(ctx, W, H, L, R, T, B) { ctx.fillStyle = GLASS; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H - B); ctx.lineTo(W - R, H - B); ctx.stroke(); }
const row = (k, v, big) => `<tr><td>${k}</td><td${big ? ' class="big"' : ''}>${v}</td></tr>`;
const pm = (v, e, d = 3) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)} ± ${e.toFixed(d)}`;

function drawParallax(an, man) {
  const f = an.fits['WISE + SPHEREx'] || an.fits['SPHEREx only'] || an.fits['WISE only']; if (!f) return null;
  const W = 760, H = 300, L = 70, R = 14, T = 16, B = 40, c = canvas(W, H), ctx = c.getContext('2d');
  axes(ctx, W, H, L, R, T, B);
  const eps = [...an.wise_epochs, ...an.spherex_epochs], yr = e => E.mjdToYear(e.mjd);
  const y0 = Math.floor(Math.min(...eps.map(yr))) - 0.3, y1 = Math.ceil(Math.max(...eps.map(yr))) + 0.3, lim = 1.5;
  const X = y => L + (y - y0) / (y1 - y0) * (W - L - R), Y = v => T + (lim - v) / (2 * lim) * (H - T - B);
  ctx.strokeStyle = RULE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(W - R, Y(0)); ctx.stroke();
  ctx.fillStyle = SOFT; ctx.font = `450 ${FS(15)}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(y0 / 2) * 2; y <= y1; y += 2) ctx.fillText(String(y), X(y), H - B + 16);
  ctx.textAlign = 'right'; for (const v of [-1, 0, 1]) ctx.fillText(`${v > 0 ? '+' : ''}${v}″`, L - 8, Y(v));
  const ast = man.astrometry;
  ctx.strokeStyle = BRASS; ctx.lineWidth = 1.6; ctx.beginPath();
  for (let i = 0; i <= 900; i++) { const y = y0 + (y1 - y0) * i / 900, mjd = 51544.5 + (y - 2000) * 365.25, v = f.plx * E.parallaxFactors(ast.ra, ast.dec, mjd)[0]; i ? ctx.lineTo(X(y), Y(v)) : ctx.moveTo(X(y), Y(v)); }
  ctx.stroke();
  for (const e of eps) {
    const v = e.xi - (f.xi0 + f.pm_xi * (yr(e) - f.t_ref)), x = X(yr(e)), spx = e.src === 'SPHEREx';
    ctx.strokeStyle = ctx.fillStyle = spx ? BRASS : INK; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, Y(Math.min(lim, v + e.e_xi))); ctx.lineTo(x, Y(Math.max(-lim, v - e.e_xi))); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, Y(Math.max(-lim, Math.min(lim, v))), spx ? 5 : 3.5, 0, 2 * Math.PI); ctx.fill();
  }
  return c;
}

function drawControls(cd) {
  const b = cd.colour_excess && cd.colour_excess.bands && cd.colour_excess.bands['4.4-5.0']; if (!b) return null;
  const c44 = b.c, val = bins => (bins['4.4-5.0'] && bins['2.4-3.8']) ? bins['4.4-5.0'].flux - c44 * bins['2.4-3.8'].flux : null;
  const ctrl = cd.random.map(r => val(r.bins)).filter(v => v !== null), tgt = val(cd.bins), mir = cd.mirrors.map(m => val(m.bins)).filter(v => v !== null);
  const all = [...ctrl, tgt, ...mir], lo = Math.min(...all), hi = Math.max(...all), pad = 0.08 * (hi - lo);
  const W = 760, H = 150, L = 20, R = 20, c = canvas(W, H), ctx = c.getContext('2d'), X = v => L + (v - lo + pad) / (hi - lo + 2 * pad) * (W - L - R), y = 70;
  ctx.fillStyle = GLASS; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(L, y + 28); ctx.lineTo(W - R, y + 28); ctx.stroke();
  ctx.strokeStyle = 'rgba(232,236,244,0.5)'; ctx.lineWidth = 1.3;
  for (const v of ctrl) { ctx.beginPath(); ctx.moveTo(X(v), y - 22); ctx.lineTo(X(v), y + 22); ctx.stroke(); }
  ctx.strokeStyle = INK; ctx.lineWidth = 2; for (const v of mir) { ctx.beginPath(); ctx.arc(X(v), y, 9, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.fillStyle = BRASS; ctx.beginPath(); ctx.moveTo(X(tgt), y - 34); ctx.lineTo(X(tgt) - 11, y - 54); ctx.lineTo(X(tgt) + 11, y - 54); ctx.closePath(); ctx.fill();
  ctx.fillRect(X(tgt) - 1.5, y - 34, 3, 62);
  ctx.fillStyle = SOFT; ctx.font = `450 ${FS(15)}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center';
  const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 3)));
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step * (hi - lo > 6 * step ? 2 : 1)) ctx.fillText(String(Math.round(v)), X(v), y + 48);
  ctx.textAlign = 'right'; ctx.fillText('µJy', W - R, y + 68);
  return c;
}

function drawLightCurve(vr) {
  const lc = vr.light_curve, W = 760, H = 300, L = 70, R = 14, T = 16, B = 40, c = canvas(W, H), ctx = c.getContext('2d');
  axes(ctx, W, H, L, R, T, B);
  const all = [...lc.dmag, ...(vr.control ? vr.control.dmag : [])], lim = Math.max(0.3, ...all.map(Math.abs)) * 1.2;
  const y0 = Math.min(...lc.year) - 0.05, y1 = Math.max(...lc.year) + 0.05;
  const X = y => L + (y - y0) / (y1 - y0) * (W - L - R), Y = v => T + (lim - v) / (2 * lim) * (H - T - B);
  ctx.strokeStyle = RULE; ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(W - R, Y(0)); ctx.stroke();
  ctx.fillStyle = SOFT; ctx.font = `450 ${FS(15)}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(y0 * 4) / 4; y <= y1; y += 0.25) ctx.fillText(y.toFixed(2), X(y), H - B + 16);
  ctx.textAlign = 'right'; const st = lim > 1 ? 0.5 : 0.2;
  for (let v = -Math.floor(lim / st) * st; v <= lim; v += st) ctx.fillText(`${v > 0 ? '+' : ''}${v.toFixed(1)}`, L - 8, Y(v));
  const pts = (ys, ms, es, col, r) => ys.forEach((y, i) => { ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(y), Y(ms[i] + es[i])); ctx.lineTo(X(y), Y(ms[i] - es[i])); ctx.stroke(); ctx.beginPath(); ctx.arc(X(y), Y(ms[i]), r, 0, 2 * Math.PI); ctx.fill(); });
  if (vr.control) pts(vr.control.year, vr.control.dmag, vr.control.e_dmag, 'rgba(155,165,184,0.5)', 3);
  pts(lc.year, lc.dmag, lc.e_dmag, INK, 4.2);
  return c;
}

export async function renderFindings(slug, box, lang, man, extras = [], { analysis = null, current = () => true, cssWidth = 0 } = {}) {
  const L = TXT[lang] || TXT.en, out = document.createDocumentFragment();
  const load = n => !extras.includes(n) ? null : n === 'analysis' && analysis ? analysis : get(`data/${slug}/${n}.json`);
  const [an, cd, vr] = await Promise.all(['analysis', 'candidate', 'variable'].map(load));
  if (!current()) return null;
  K = cssWidth > 0 ? 760 / cssWidth : 1;
  const add = (title, note, cv, html) => {
    const d = document.createElement('div'); d.className = 'finding';
    d.innerHTML = `<h3>${title}</h3>`; if (cv) d.append(cv);
    if (note) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = note; d.append(p); }
    if (html) { const t = document.createElement('div'); t.className = 'measure'; t.innerHTML = html; d.append(t); }
    out.append(d);
  };
  if (an && an.fits && man.astrometry) {
    const which = ['WISE + SPHEREx', 'SPHEREx only', 'WISE only'].find(k => an.fits[k]);
    const f = which && an.fits[which], lit = an.literature;
    const np = an.fits[which === 'SPHEREx only' ? 'SPHEREx only, no parallax' : 'WISE only, no parallax'];
    if (f) {
      let h = '<table>' + row(`${L.pm} α`, `${pm(f.pm_xi, f.e_pm_xi)} ″/yr  (${L.lit} ${lit.pmra >= 0 ? '+' : '−'}${Math.abs(lit.pmra).toFixed(3)})`)
        + row(`${L.pm} δ`, `${pm(f.pm_eta, f.e_pm_eta)} ″/yr  (${L.lit} ${lit.pmdec >= 0 ? '+' : '−'}${Math.abs(lit.pmdec).toFixed(3)})`);
      if (f.plx !== undefined) h += row(L.plx, `${f.plx.toFixed(3)} ± ${f.e_plx.toFixed(3)}″  (${L.lit} ${lit.plx.toFixed(3)})`, true) + row(L.dist, `${(1 / f.plx).toFixed(2)} pc`, true);
      h += row(`${L.chi}, ${which}`, `${f.chi2.toFixed(0)} / ${f.dof}`);
      if (np) h += row(`${L.chi}, ${L.noPlx}`, `${np.chi2.toFixed(0)} / ${np.dof}`);
      h += '</table>';
      if (an.prediction_test && an.prediction_test.length) {
        h += `<p class="hint" style="margin-top:.6rem">${L.pred}</p><table>`;
        for (const p of an.prediction_test) h += row(`${E.mjdToYear(p.mjd).toFixed(2)}, ${p.set === 'deblended' ? L.deb : L.bl}`, `${pm(p.d_xi, p.s_xi, 2)}″, ${pm(p.d_eta, p.s_eta, 2)}″`);
        h += '</table>';
      }
      add(L.astro, L.astroNote, f.plx !== undefined ? drawParallax(an, man) : null, h);
    }
  }
  if (cd && cd.bins) {
    let h = '<table>';
    for (const [n, b] of Object.entries(cd.bins)) if (b) h += row(`${L.bandFlux} ${n} µm`, `${b.flux >= 0 ? '+' : '−'}${Math.abs(b.flux).toFixed(0)} ± ${b.err.toFixed(0)} µJy`);
    const ce = cd.colour_excess, b = ce && ce.bands && ce.bands['4.4-5.0'];
    if (b) h += row(L.excess, `${b.excess >= 0 ? '+' : '−'}${Math.abs(b.excess).toFixed(0)} µJy`, true) + row(L.scatter, `${b.raw_sigma.toFixed(0)} ${L.to} ${b.sigma.toFixed(0)} µJy`)
      + row(`${ce.n_controls} ${L.controls}`, `${b.n_as_large} ${L.asLarge}`);
    if (ce && ce.matched) h += row(L.pEmp, ce.matched.p_empirical.toFixed(3), true);
    add(L.cand, L.candNote, drawControls(cd), h + '</table>');
  }
  if (vr && vr.light_curve) {
    const per = vr.period ? row(L.period, `${vr.period.best_d.toFixed(0)} (${vr.period.lo_d.toFixed(0)}–${vr.period.hi_d.toFixed(0)}) ${L.days}; ${L.lit} ${vr.period.published_d}`, true) : '';
    const h = '<table>' + per + row(L.amp, `${(vr.period ? vr.period.amp_mag : vr.amplitude_mag).toFixed(2)} ${L.mag}`, true) + (vr.control ? row(L.ctrl, `${vr.control.range_mag.toFixed(2)} ${L.mag}`) : '')
      + row(vr.aperture === 'wings' ? L.sat : L.core, `${vr.n_used} / ${vr.n_all}`) + '</table>';
    add(L.varT, L.varNote, drawLightCurve(vr), h);
  }
  const any = out.children.length > 0;
  box.replaceChildren(out);
  return any;
}
