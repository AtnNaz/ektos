import * as THREE from './vendor/three.module.min.js';
import { createSkySound } from './skysound.js';

const PLATE = 1.6, DIST = 2.0, EYE_H = 1.5, IPD = 0.063, SKY_R = 70;
const C = { ink: '#E8ECF4', soft: '#9BA5B8', faint: '#717B91', panel: '#080B13', lift: '#121828', signal: '#E9B44C', a: '#FF6F5E', b: '#5BB5FF' };
const FONT = '"IBM Plex Sans", sans-serif';
const BANDS = [[1.4, 'H₂O'], [1.9, 'H₂O'], [2.7, 'H₂O'], [3.3, 'CH₄'], [4.6, 'CO']];

const T0 = performance.now();
function log(...msg) {
  const line = `${((performance.now() - T0) / 1000).toFixed(2)}s ${msg.join(' ')}`;
  (window.__vrlog = window.__vrlog || []).push(line);
  console.info('[ektos-vr]', line);
  try { fetch('api/log?m=' + encodeURIComponent(line), { keepalive: true }).catch(() => {}); } catch (e) {  }
}
function gpuName(gl) {
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; } catch (e) { return 'unknown'; }
}

const TXT = {
  en: {
    left: 'LEFT EYE', right: 'RIGHT EYE', both: 'BOTH EYES',
    guide0: 'Put the ring on the source that moved; slide the pad up or down until the ring sits at its depth.',
    read: 'Shift {d}″ (horizontal part) · direction {pa}° · {r}″/yr',
    state: 'Mode: {mode} · Axis {axis}° · Plate {fov}′, the sky magnified {mag}×',
    stereo: 'Stereo', blink: 'Blink', swapped: 'eyes swapped',
    menu: 'MENU', menuHint: 'Point at a button and pull the trigger',
    bMode: 'Stereo / Blink', bModeSub: 'One date for each eye, or the two dates in turn.',
    bSwap: 'Swap eyes', bSwapSub: 'Depth should flip. If it does, the effect is real.',
    bSpec: 'Spectrum trace', bSpecSub: 'The light of the source under the ring, colour by colour.',
    bSound: 'Listen to the spectrum', bSoundSub: 'Short waves are high notes; more light is louder.', bSoundOff: 'Turn the spectrum trace on first.',
    bMeas: 'Measurement line', bMeasSub: 'Depth of the ring: shift, speed, distance.',
    bWorld: 'World line', bWorldSub: 'The measured path against time. The wobble gives the distance.', bWorldOff: 'This field has no catalogue motion.',
    bWorldSubCat: 'The catalogue path against time (not measured here).',
    wWobble: 'wobble', wMotion: 'motion',
    bTunnel: 'Time tunnel', bTunnelSub: 'The walk from 2010 to now. For presentations only.', bTunnelOff: 'Not available in this field.',
    tunWhy: { noAst: 'This field has no catalogue motion.', noWise: 'This field has no 2010 WISE frame.', offPlate: 'The object’s 2010 or present place is off the plate.',
      short: 'The object moved less than 15″ in 16 years.', noData: 'Not enough exposures at 4–5 µm.', exp: 'Off while a test runs.' },
    bSky: 'Sound of the sky', bSkySub: 'The light on the plate as sound, quietly behind.', bSkyOff: 'No sound could be made for this field.',
    g4Sky: 'The sound behind is the plate’s light. The long tone is all the light on the plate: pitch is wavelength, loudness is light. The chimes are the brightest sources, from where they are on the plate. Not a measurement.',
    bChan: 'Sky colour', bChanSub: 'Hold the trigger and drag along the bar.', bChanOff: 'The channel images were not found.',
    bTargets: 'Targets on the sky', bTargetsSub: 'Rings are the other fields. Point and pull the trigger to open one.',
    bCentre: 'Bring to me', bCentreSub: 'Moves everything to where you are looking.',
    bExit: 'Leave VR', bExitSub: 'Back to the page.',
    opening: 'Opening {name}…',
    worldWobble: '{name}: yearly wobble {plx}″ ± {e}″, so {d} pc. Each loop is one year.',
    worldMotion: '{name}: moves {pm}″ each year. Axes: time, east, north.',
    worldLegend: 'Light: WISE · amber: SPHEREx · curve: the fitted model',
    worldWobbleCat: '{name}: catalogue yearly wobble {plx}″, so {d} pc. Not measured here.',
    worldMotionCat: '{name}: moves {pm}″ each year in the catalogue. Not measured here.',
    worldLegendCat: 'Curve: catalogue path · no positions measured in this field',
    gTitle: 'WHAT YOU ARE LOOKING AT',
    g1: 'The plate in the middle is a small patch of sky. Your left eye sees date A, your right eye sees date B.',
    g2: 'Stars that stayed put are in the same place for both eyes and stay on the flat plate. A source that moved floats in front of or behind it.',
    g1Swap: 'Eyes swapped: your left eye sees date B, your right eye sees date A. The depth should flip too.',
    g1Blink: 'Blink: both eyes see the same picture, and dates A and B take turns. A source that moved jumps on the spot.',
    g1Tunnel: 'Time tunnel: the plate changes from 2010 to now while the amber arrow draws the path of the object.',
    g3: 'The sky behind is real: the SPHEREx {lam} µm all-sky map. The plate is the direction right behind it, magnified.',
    g3None: 'The sky map behind could not be loaded, so the sphere is empty. The plate is still real data.',
    cTitle: 'CONTROLS',
    c1: 'Point: the ring moves', c2: 'Trigger: press a button / pin the ring to a source', c3: 'Pad left-right: turn the plate',
    c4: 'Pad up-down: depth of the ring', c5: 'Press the pad: bring to me', c6: 'Grip: stereo ↔ blink',
    c2Exp: 'Trigger: “it is here”, the source under the ring moved', c3Exp: 'Pad left-right: off during the test', c6Exp: 'Grip: “nothing moved”',
    expHelp: 'Point the ring at the source that moved and pull the trigger. If nothing moved, squeeze the grip.',
    specTitle: 'Spectrum · {n} exposures · peak {peak} · first date at the back, last in front', specNone: 'No measurable source under the ring',
    specBands: 'Blue lines: where water, methane and CO are known to absorb light',
    measDist: '{name}: {pc} pc (from the catalogue) · speed across the sky {v} km/s',
    tunnelRun: '{y} · WISE 2010 → SPHEREx · the streaks around are decoration, not data',
    tunnelEnd: '{d}″ in {yrs} years · {r}″/yr (catalogue track)',
    preview: 'Preview without a headset: left eye only (A). Mouse: point and click · right-drag: look · arrow keys: turn / depth · B: other eye · G: blink · Esc: close',
    close: 'Close', yr: 'yr',
  },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const langOf = () => 'en';
const targetName = t => t.name || '';
const targetKind = t => t.kind || '';

function upscale(src, size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, size, size);
  return c;
}
function texture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return t;
}
function panel(w, h, pw, ph, opts = {}) {
  const canvas = document.createElement('canvas'); canvas.width = pw; canvas.height = ph;
  const tex = texture(canvas);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: !!opts.transparent, depthWrite: !opts.transparent }));
  return { mesh, canvas, ctx: canvas.getContext('2d'), tex, w, h, pw, ph, done() { tex.needsUpdate = true; } };
}
function wrap(ctx, text, x, y, maxW, lineH) {
  let line = '';
  for (const word of String(text).split(' ')) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = word; } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}
const fmtFlux = f => (Math.abs(f) >= 1000 ? `${(f / 1000).toFixed(f >= 1e5 ? 0 : 1)} mJy` : `${f.toFixed(0)} µJy`);

function skyGeometry(radius, nRa = 96, nDec = 48) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nDec; j++) {
    const dec = (-90 + 180 * j / nDec) * Math.PI / 180;
    for (let i = 0; i <= nRa; i++) {
      const ra = (-180 + 360 * i / nRa) * Math.PI / 180;
      pos.push(-radius * Math.cos(dec) * Math.sin(ra), radius * Math.sin(dec), -radius * Math.cos(dec) * Math.cos(ra));
      uv.push(0.5 - (-180 + 360 * i / nRa) / 360, j / nDec);
    }
  }
  for (let j = 0; j < nDec; j++) for (let i = 0; i < nRa; i++) {
    const a = j * (nRa + 1) + i, b = a + 1, c = a + nRa + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const GAL = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]];
function inFrame(frame, raDeg, decDeg) {
  if (frame !== 'galactic') return [raDeg, decDeg];
  const a = raDeg * Math.PI / 180, d = decDeg * Math.PI / 180, v = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g = GAL.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  return [Math.atan2(g[1], g[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, g[2]))) * 180 / Math.PI];
}
function onSphere(lonDeg, latDeg) {
  const a = lonDeg * Math.PI / 180, d = latDeg * Math.PI / 180;
  return new THREE.Vector3(-Math.cos(d) * Math.sin(a), Math.sin(d), -Math.cos(d) * Math.cos(a));
}
function skyRotation(raDeg, decDeg, frame = 'icrs') {
  const f = onSphere(...inFrame(frame, raDeg, decDeg));
  const up = onSphere(...inFrame(frame, raDeg, Math.min(89.9999, decDeg + 0.01)));
  const n = up.sub(f.clone().multiplyScalar(up.dot(f))).normalize();
  const r = new THREE.Vector3().crossVectors(f, n);
  return new THREE.Matrix4().set(r.x, r.y, r.z, 0, n.x, n.y, n.z, 0, -f.x, -f.y, -f.z, 0, 0, 0, 0, 1);
}

function buildScene(opts) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020308);
  const root = new THREE.Group(); root.position.set(0, EYE_H, 0); scene.add(root);
  let cur = opts, arcsecPerM = opts.field / PLATE, lang = langOf(opts), L = TXT[lang];
  const st = { axis: opts.axis || 0, disp: 0, mx: 0, my: 0, swapped: false, blink: !!opts.blink, phase: 0, blinkT: 0,
    spec: false, meas: false, tunnel: null, pinned: 0, hover: '', specAt: null, dirty: true, menuDirty: true,
    world: null, chan: -1, targets: true, hoverT: -1, hoverTs: '', opening: null, slew: 0,
    chanDrag: null, chanPend: -1, chanRest: 0, sky: true };
  const world = { scene, root, st, requestExit: false, requestCentre: false };
  let disposed = false, clock = 0;
  let skySnd = null;
  let skyState = opts.sky ? 'loading' : 'none';

  const sky = new THREE.Mesh(skyGeometry(SKY_R), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, depthWrite: false }));
  sky.renderOrder = -10; root.add(sky);
  const marks = new THREE.Group(); root.add(marks);
  const qSky = new THREE.Quaternion(), qMarks = new THREE.Quaternion(), qInv = new THREE.Quaternion();
  let skyFrame = 'icrs', centre = opts.center || null;
  function aimSky(instant) {
    if (!centre) return;
    qSky.setFromRotationMatrix(skyRotation(centre[0], centre[1], skyFrame));
    qMarks.setFromRotationMatrix(skyRotation(centre[0], centre[1], 'icrs'));
    if (instant) { sky.quaternion.copy(qSky); marks.quaternion.copy(qMarks); st.slew = 0; } else st.slew = 2.2;
  }
  aimSky(true);
  if (opts.sky) {
    new THREE.TextureLoader().load(opts.sky, tex => {
      if (disposed) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      if (sky.material.map) { tex.dispose(); skyState = 'ok'; return; }
      sky.material.map = tex; sky.material.color.set(0x6f778a); sky.material.needsUpdate = true;
      skyState = 'ok'; st.dirty = true;
      log('sky map loaded', tex.image.width + 'x' + tex.image.height);
    }, undefined, () => { skyState = 'failed'; st.dirty = true; log('sky map not loaded'); });
  }

  let texA = texture(upscale(opts.a)), texB = texture(upscale(opts.b));
  const geo = new THREE.PlaneGeometry(PLATE, PLATE);
  const plate = new THREE.Group(); plate.position.set(0, 0, -DIST); root.add(plate);
  const matL = new THREE.MeshBasicMaterial({ map: texA }), matR = new THREE.MeshBasicMaterial({ map: texB });
  const left = new THREE.Mesh(geo, matL), right = new THREE.Mesh(geo, matR);
  left.layers.set(1); right.layers.set(2); plate.add(left, right);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(PLATE + 0.03, PLATE + 0.03)), new THREE.LineBasicMaterial({ color: 0xe9b44c }));
  edge.position.set(0, 0, -DIST); root.add(edge);

  const ringGeo = new THREE.RingGeometry(0.035, 0.040, 48), ringMat = new THREE.MeshBasicMaterial({ color: 0xe9b44c });
  const markL = new THREE.Mesh(ringGeo, ringMat), markR = new THREE.Mesh(ringGeo, ringMat);
  markL.layers.set(1); markR.layers.set(2); root.add(markL, markR);

  const info = panel(1.6, 0.42, 1600, 420);
  info.mesh.position.set(0, -1.2, -1.76); info.mesh.rotation.x = -0.62; root.add(info.mesh);
  const mag = () => Math.round((2 * Math.atan(PLATE / 2 / DIST)) / (cur.field / 206265));
  function markSky() {
    const th = st.axis * Math.PI / 180, x = st.mx * Math.cos(th) - st.my * Math.sin(th), y = st.mx * Math.sin(th) + st.my * Math.cos(th);
    return [-x * arcsecPerM, y * arcsecPerM];
  }
  function shiftOfMark() {
    const d = st.disp * arcsecPerM * (st.swapped ? -1 : 1), th = st.axis * Math.PI / 180;
    let pa = Math.atan2(-Math.cos(th), Math.sin(th)) * 180 / Math.PI; if (d < 0) pa += 180;
    return { d: Math.abs(d), pa: (pa % 360 + 360) % 360, rate: cur.years ? Math.abs(d) / Math.abs(cur.years) : null };
  }
  let infoKey = '', infoFixed = '', infoAt = -1e9, infoPending = false;
  function drawInfo() {
    const rows = [];
    if (st.tunnel) rows.push([86, L.both, '', C.ink, `${cur.tunnel.labelA}  →  ${cur.tunnel.labelB}`]);
    else if (st.blink) rows.push([86, L.both, st.phase ? 'B' : 'A', st.phase ? C.b : C.a, st.phase ? cur.labelB : cur.labelA]);
    else rows.push([56, L.left, st.swapped ? 'B' : 'A', st.swapped ? C.b : C.a, st.swapped ? cur.labelB : cur.labelA], [116, L.right, st.swapped ? 'A' : 'B', st.swapped ? C.a : C.b, st.swapped ? cur.labelA : cur.labelB]);
    let msg, numeric = false;
    if (cur.status) msg = cur.status;
    else if (st.opening) msg = fill(L.opening, { name: st.opening });
    else if (st.tunnel) {
      const T = cur.tunnel, p = tunnelProgress(); numeric = p < 1;
      msg = p < 1 ? fill(L.tunnelRun, { y: (T.y0 + (T.y1 - T.y0) * p).toFixed(1) })
        : fill(L.tunnelEnd, { yrs: (T.y1 - T.y0).toFixed(1), d: Math.hypot(T.to[0] - T.from[0], T.to[1] - T.from[1]).toFixed(0), r: (Math.hypot(T.to[0] - T.from[0], T.to[1] - T.from[1]) / (T.y1 - T.y0)).toFixed(2) });
    } else if (Math.abs(st.disp) > 0.0015) { const s = shiftOfMark(); numeric = true; msg = fill(L.read, { d: s.d.toFixed(1), pa: s.pa.toFixed(0), r: s.rate === null ? '—' : s.rate.toFixed(2) }); }
    else msg = L.guide0;
    const mode = st.tunnel ? L.bTunnel : (st.blink ? L.blink : L.stereo) + (st.swapped ? ` (${L.swapped})` : '');
    const foot = cur.status ? L.expHelp : fill(L.state, { mode, axis: st.axis.toFixed(0), fov: (cur.field / 60).toFixed(1), mag: mag() });
    const fixed = JSON.stringify(rows) + (numeric ? '' : msg) + mode, key = fixed + msg + foot;
    infoPending = false;
    if (key === infoKey) return;
    if (fixed === infoFixed && clock - infoAt < 0.1) { infoPending = true; return; }
    infoKey = key; infoFixed = fixed; infoAt = clock;
    const c = info.ctx; c.fillStyle = C.panel; c.fillRect(0, 0, 1600, 420);
    c.strokeStyle = 'rgba(232,236,244,0.25)'; c.lineWidth = 2; c.strokeRect(1, 1, 1598, 418);
    c.textBaseline = 'middle';
    for (const [y, tag, letter, col, text] of rows) {
      c.font = `400 26px ${FONT}`; c.fillStyle = C.faint; c.fillText(tag, 36, y);
      c.font = `600 44px ${FONT}`; c.fillStyle = col; c.fillText(letter, 200, y);
      c.font = `500 40px ${FONT}`; c.fillText(text, 262, y);
    }
    c.fillStyle = 'rgba(232,236,244,0.18)'; c.fillRect(36, 160, 1528, 2);
    c.font = `500 36px ${FONT}`; c.fillStyle = C.signal;
    wrap(c, msg, 36, 212, 1528, 46);
    c.font = `400 28px ${FONT}`; c.fillStyle = C.soft;
    c.fillText(foot, 36, 372);
    info.done();
  }

  const MENU_W = 700, MENU_H = 1256, HEAD = 96, ROW = 96;
  const menu = panel(0.74, 0.74 * MENU_H / MENU_W, MENU_W, MENU_H);
  menu.mesh.position.set(-1.27, -0.06, -1.66); menu.mesh.rotation.y = 0.5; root.add(menu.mesh);
  const chanList = () => (cur.channels && cur.channels.list) || [];
  const buttons = () => [
    { id: 'mode', label: L.bMode, sub: L.bModeSub, value: st.blink ? L.blink : L.stereo, off: !!cur.status || !!st.tunnel },
    { id: 'swap', label: L.bSwap, sub: L.bSwapSub, on: st.swapped, off: !!cur.status || !!st.tunnel },
    { id: 'spec', label: L.bSpec, sub: L.bSpecSub, on: st.spec, off: !!cur.status || !cur.spectrumAt },
    { id: 'sound', label: L.bSound, sub: st.spec ? L.bSoundSub : L.bSoundOff, on: !!sound, off: !!cur.status || !st.spec || !lastSpec },
    { id: 'meas', label: L.bMeas, sub: L.bMeasSub, on: st.meas, off: !!cur.status },
    { id: 'world', label: L.bWorld, sub: !cur.worldline ? L.bWorldOff : cur.worldline.source === 'catalogue' ? L.bWorldSubCat : L.bWorldSub, value: st.world === 'wobble' ? L.wWobble : st.world === 'motion' ? L.wMotion : null, on: cur.worldline ? !!st.world : undefined, off: !!cur.status || !cur.worldline },
    { id: 'tunnel', label: L.bTunnel, sub: cur.tunnel ? L.bTunnelSub : (L.tunWhy[cur.tunnelWhy] || L.bTunnelOff), on: !!st.tunnel, off: !!cur.status || !cur.tunnel },
    { id: 'chan', label: L.bChan, sub: chanList().length ? L.bChanSub : L.bChanOff, value: chanList().length ? `${chanLam().toFixed(2)} µm` : null, bar: chanList().length > 0, off: !chanList().length },
    { id: 'sky', label: L.bSky, sub: skySnd === false ? L.bSkyOff : L.bSkySub, on: st.sky && skySnd !== false, off: skySnd === false },
    { id: 'targets', label: L.bTargets, sub: L.bTargetsSub, on: st.targets, off: !!cur.status || !(cur.targets && cur.targets.length) },
    { id: 'centre', label: L.bCentre, sub: L.bCentreSub },
    { id: 'exit', label: L.bExit, sub: L.bExitSub },
  ];
  const LAM_LO = 0.75, LAM_HI = 5.0, BAR_X0 = 34, BAR_X1 = MENU_W - 34;
  const chanLam = () => { const l = chanList(); return st.chanPend >= 0 ? l[st.chanPend].lam : st.chan >= 0 ? l[st.chan].lam : 4.57; };
  let hoverRows = [];
  function drawMenu() {
    const c = menu.ctx; c.fillStyle = C.panel; c.fillRect(0, 0, MENU_W, MENU_H);
    c.strokeStyle = 'rgba(232,236,244,0.25)'; c.lineWidth = 2; c.strokeRect(1, 1, MENU_W - 2, MENU_H - 2);
    c.textBaseline = 'middle';
    c.font = `400 24px ${FONT}`; c.fillStyle = C.signal; c.fillText(L.menu, 34, 40);
    c.fillStyle = C.faint; c.fillText(L.menuHint, 34, 72);
    buttons().forEach((b, i) => {
      const y = HEAD + i * ROW, hot = hoverRows.includes(i) && !b.off;
      c.fillStyle = hot ? C.lift : C.panel; c.fillRect(2, y, MENU_W - 4, ROW);
      c.fillStyle = 'rgba(232,236,244,0.16)'; c.fillRect(34, y, MENU_W - 68, 2);
      if (hot) { c.fillStyle = C.signal; c.fillRect(2, y, 8, ROW); }
      c.font = `500 36px ${FONT}`; c.fillStyle = b.off ? C.faint : C.ink; c.fillText(b.label, 34, y + 34);
      if (b.bar && !b.off) {
        const f = (chanLam() - LAM_LO) / (LAM_HI - LAM_LO), x = BAR_X0 + f * (BAR_X1 - BAR_X0), dragging = st.chanDrag !== null;
        c.fillStyle = 'rgba(232,236,244,0.16)'; c.fillRect(BAR_X0, y + 64, BAR_X1 - BAR_X0, 12);
        c.fillStyle = C.signal; c.globalAlpha = dragging ? 1 : 0.8; c.fillRect(BAR_X0, y + 64, x - BAR_X0, 12); c.globalAlpha = 1;
        c.beginPath(); c.arc(x, y + 70, dragging ? 16 : 13, 0, Math.PI * 2); c.fillStyle = C.ink; c.fill();
        c.lineWidth = 3; c.strokeStyle = C.signal; c.stroke();
      } else { c.font = `400 23px ${FONT}`; c.fillStyle = b.off ? C.faint : C.soft; c.fillText(b.sub, 34, y + 71, MENU_W - 68); }
      if (b.value) { c.font = `500 27px ${FONT}`; c.fillStyle = b.off ? C.faint : C.signal; c.textAlign = 'right'; c.fillText(b.value, MENU_W - 34, y + 38); c.textAlign = 'left'; }
      else if (b.on !== undefined) {
        c.strokeStyle = b.off ? C.faint : b.on ? C.signal : C.soft; c.lineWidth = 3; c.strokeRect(MENU_W - 72, y + 20, 36, 36);
        if (b.on) { c.fillStyle = C.signal; c.fillRect(MENU_W - 65, y + 27, 22, 22); }
      }
    });
    menu.done();
  }

  const guide = panel(0.74, 0.74 * MENU_H / MENU_W, MENU_W, MENU_H);
  guide.mesh.position.set(1.27, -0.06, -1.66); guide.mesh.rotation.y = -0.5; root.add(guide.mesh);
  let guideKey = '';
  function drawGuide() {
    const list = chanList(), lam = st.chan >= 0 && list[st.chan] ? list[st.chan].lam : 4.57, exp = !!cur.status;
    const about = [st.tunnel ? L.g1Tunnel : st.blink ? L.g1Blink : st.swapped ? L.g1Swap : L.g1, L.g2,
      skyState === 'failed' && st.chan < 0 ? L.g3None : fill(L.g3, { lam: lam.toFixed(2) }), ...(st.sky && skySnd ? [L.g4Sky] : [])];
    const ctl = [L.c1, exp ? L.c2Exp : L.c2, exp ? L.c3Exp : L.c3, L.c4, L.c5, exp ? L.c6Exp : L.c6];
    const key = [L.gTitle, ...about, L.cTitle, ...ctl].join('\n');
    if (key === guideKey) return;
    guideKey = key;
    const c = guide.ctx; c.fillStyle = C.panel; c.fillRect(0, 0, MENU_W, MENU_H);
    c.strokeStyle = 'rgba(232,236,244,0.25)'; c.lineWidth = 2; c.strokeRect(1, 1, MENU_W - 2, MENU_H - 2);
    c.textBaseline = 'middle';
    let y = 46;
    c.font = `400 24px ${FONT}`; c.fillStyle = C.signal; c.fillText(L.gTitle, 34, y); y += 56;
    c.font = `400 31px ${FONT}`; c.fillStyle = C.ink;
    for (const t of about) y = wrap(c, t, 34, y, MENU_W - 68, 40) + 22;
    y += 14; c.fillStyle = 'rgba(232,236,244,0.16)'; c.fillRect(34, y - 20, MENU_W - 68, 2); y += 22;
    c.font = `400 24px ${FONT}`; c.fillStyle = C.signal; c.fillText(L.cTitle, 34, y); y += 54;
    c.font = `400 30px ${FONT}`; c.fillStyle = C.soft;
    for (const t of ctl) y = wrap(c, t, 34, y, MENU_W - 68, 38) + 12;
    guide.done();
  }
  drawGuide();

  const SW = 1.3, SH = 0.36, SD = 0.26, LAM0 = 0.7, LAM1 = 5.1;
  const spec = new THREE.Group(); spec.position.set(0, -0.99, -1.66); spec.visible = false; root.add(spec);
  const specLines = new THREE.Group(); spec.add(specLines);
  const specBase = panel(SW, SW * 110 / 1300, 1300, 110, { transparent: true });
  specBase.mesh.position.set(0, -SW * 110 / 1300 / 2 - 0.004, -SD + 0.004); spec.add(specBase.mesh);
  const sx = lam => (lam - LAM0) / (LAM1 - LAM0) * SW - SW / 2;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const specLine = (group, pts, color, opacity = 1, seg = false) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    const o = seg ? new THREE.LineSegments(g, m) : new THREE.Line(g, m); group.add(o); return o;
  };
  {
    const box = new THREE.Group(), x0 = -SW / 2, x1 = SW / 2; spec.add(box);
    specLine(box, [V(x0, 0, 0), V(x1, 0, 0), V(x1, 0, 0), V(x1, 0, -SD), V(x1, 0, -SD), V(x0, 0, -SD), V(x0, 0, -SD), V(x0, 0, 0),
      V(x0, 0, -SD), V(x0, SH, -SD), V(x1, 0, -SD), V(x1, SH, -SD), V(x0, SH, -SD), V(x1, SH, -SD), V(x0, SH / 2, -SD), V(x1, SH / 2, -SD)], 0x626c82, 0.7, true);
    for (const [lam, name] of BANDS) {
      specLine(box, [V(sx(lam), 0, 0), V(sx(lam), 0, -SD), V(sx(lam), 0, -SD), V(sx(lam), SH, -SD)], 0x5bb5ff, 0.45, true);
      const tag = panel(0.13, 0.05, 260, 100, { transparent: true });
      tag.ctx.font = `500 54px ${FONT}`; tag.ctx.fillStyle = C.b; tag.ctx.textAlign = 'center'; tag.ctx.textBaseline = 'middle'; tag.ctx.fillText(name, 130, 52); tag.done();
      tag.mesh.position.set(sx(lam), SH + 0.035, -SD); box.add(tag.mesh);
    }
  }
  function clearSpec() { for (const o of [...specLines.children]) { o.geometry.dispose(); o.material.dispose(); specLines.remove(o); } }
  let lastSpec = null, specShown = false, specTitleKey = '', sound = null;
  function setSpectrum(data) {
    const ok = !!(data && data.mean && data.mean.length > 6 && data.peak > 0);
    const title = ok ? fill(L.specTitle, { n: data.n, peak: fmtFlux(data.peak) }) : L.specNone;
    if (title + L.specBands !== specTitleKey) {
      specTitleKey = title + L.specBands;
      const c = specBase.ctx; c.clearRect(0, 0, 1300, 110); c.textBaseline = 'middle'; c.textAlign = 'center';
      c.font = `400 26px ${FONT}`; c.fillStyle = C.soft;
      for (let l = 1; l <= 5; l++) c.fillText(`${l} µm`, (sx(l) + SW / 2) / SW * 1300, 22);
      c.textAlign = 'left'; c.font = `400 24px ${FONT}`;
      c.fillStyle = ok ? C.ink : C.faint; c.fillText(title, 0, 64);
      c.fillStyle = C.faint; c.fillText(L.specBands, 0, 96);
      specBase.done();
    }
    if (specShown && data === lastSpec) return;
    if (!data !== !lastSpec) st.menuDirty = true;
    lastSpec = data; specShown = true;
    clearSpec();
    if (!ok) return;
    const sy = f => Math.max(-0.04, Math.min(1.12, f / data.peak)) * SH;
    const nv = data.visits.length;
    data.visits.forEach((v, i) => {
      if (v.pts.length < 3) return;
      const z = nv > 1 ? -SD + SD * i / (nv - 1) : -SD / 2;
      specLine(specLines, v.pts.map(([lam, f]) => V(sx(lam), sy(f), z)), v.role === 'a' ? 0xff6f5e : v.role === 'b' ? 0x5bb5ff : 0x9ba5b8, v.role ? 1 : 0.55);
    });
    const front = 0.03, mean = data.mean.map(([lam, f]) => V(sx(lam), sy(f), front));
    specLine(specLines, mean, 0xe9b44c);
    const drops = []; for (const p of mean) drops.push(V(p.x, 0, front), p);
    specLine(specLines, drops, 0xe9b44c, 0.28, true);
  }
  const specCache = [], SPEC_CACHE_N = 24;
  const REST_M = 0.012, specRest = { x: 0, y: 0, t: 0, done: false };

  const meas = new THREE.Group(); meas.visible = false; root.add(meas);
  const measGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const measLine = new THREE.Line(measGeo, new THREE.LineBasicMaterial({ color: 0xe9b44c, depthTest: false }));
  const measDot = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.018, 32), new THREE.MeshBasicMaterial({ color: 0xe9b44c, side: THREE.DoubleSide, depthTest: false }));
  const measTag = panel(0.9, 0.9 * 230 / 900, 900, 230, { transparent: true });
  measTag.mesh.material.depthTest = false;
  for (const m of [measLine, measDot, measTag.mesh]) m.renderOrder = 20;
  meas.add(measLine, measDot, measTag.mesh);
  let measKey = '';
  function moveLine(geo, a, b) {
    const p = geo.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  const measFrom = new THREE.Vector3(), measTo = new THREE.Vector3();
  function updateMeas() {
    const show = st.meas && !st.tunnel && !st.blink && Math.abs(st.disp) > 0.0015;
    meas.visible = show; if (!show) return;
    const d = Math.max(-0.2, Math.min(IPD * 0.85, st.disp)), far = DIST * IPD / (IPD - d), k = far / DIST;
    const p = measTo.set(st.mx * k, st.my * k, -far);
    moveLine(measGeo, measFrom.set(st.mx, st.my, -DIST), p);
    measDot.position.copy(p);
    measTag.mesh.position.set(p.x + (st.mx > 0 ? -0.52 : 0.52) * k, p.y + 0.17 * k, p.z); measTag.mesh.scale.setScalar(k);
    const s = shiftOfMark(), [xi, eta] = markSky(), T = cur.target;
    const near = T && T.plx > 0 && Math.hypot(xi - T.at[0], eta - T.at[1]) < 18;
    const key = `${s.d.toFixed(1)}|${s.pa.toFixed(0)}|${near}`;
    if (key === measKey) return; measKey = key;
    const c = measTag.ctx; c.clearRect(0, 0, 900, 230);
    c.fillStyle = 'rgba(8,11,19,0.82)'; c.fillRect(0, 0, 900, 230); c.fillStyle = C.signal; c.fillRect(0, 0, 6, 230);
    c.textBaseline = 'middle'; c.font = `500 46px ${FONT}`; c.fillStyle = C.ink;
    c.fillText(`${s.d.toFixed(1)}″ · ${s.rate === null ? '—' : s.rate.toFixed(2)}″/${L.yr} · ${s.pa.toFixed(0)}°`, 30, 56);
    if (near) {
      c.font = `400 32px ${FONT}`; c.fillStyle = C.soft;
      wrap(c, fill(L.measDist, { name: T.name, pc: (1 / T.plx).toFixed(2), v: (4.74 * T.pm / T.plx).toFixed(0) }), 30, 124, 850, 42);
    }
    measTag.done();
  }

  const tunnel = new THREE.Group(); tunnel.visible = false; root.add(tunnel);
  let tunQuadA = null, tunQuadB = null, tunTexA = null, tunTexB = null, tunTrack = null, tunHead = null, tunTag = null;
  const N_STREAK = 380, streakPos = new Float32Array(N_STREAK * 6), streakSeed = [];
  for (let i = 0; i < N_STREAK; i++) { const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 5.5; streakSeed.push([Math.cos(a) * r, Math.sin(a) * r, -45 + Math.random() * 50]); }
  const streakGeo = new THREE.BufferGeometry(); streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: 0xaecbff, transparent: true, opacity: 0 }));
  streaks.frustumCulled = false; tunnel.add(streaks);
  const TUN = { hold: 1.2, run: 7.0 };
  function tunnelProgress() { return st.tunnel ? Math.max(0, Math.min(1, (st.tunnel.t - TUN.hold) / TUN.run)) : 0; }
  function startTunnel() {
    const T = cur.tunnel; if (!T) return;
    tunTexA = texture(upscale(T.a)); tunTexB = texture(upscale(T.b));
    tunQuadA = new THREE.Mesh(new THREE.PlaneGeometry(PLATE, PLATE), new THREE.MeshBasicMaterial({ map: tunTexA }));
    tunQuadB = new THREE.Mesh(new THREE.PlaneGeometry(PLATE, PLATE), new THREE.MeshBasicMaterial({ map: tunTexB, transparent: true, opacity: 0 }));
    tunQuadA.position.set(0, 0, -DIST + 0.001); tunQuadB.position.set(0, 0, -DIST + 0.002);
    tunTrack = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe9b44c }));
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([0.05, 0, 0, -0.03, 0.028, 0, -0.03, -0.028, 0], 3));
    tunHead = new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: 0xe9b44c, side: THREE.DoubleSide }));
    tunTag = panel(0.34, 0.085, 480, 120, { transparent: true });
    tunnel.add(tunQuadA, tunQuadB, tunTrack, tunHead, tunTag.mesh);
    st.tunnel = { t: 0, year: '' }; st.axis = 0; st.blink = false;
    tunnel.visible = true; left.visible = right.visible = false; markL.visible = markR.visible = false;
    st.dirty = st.menuDirty = true;
  }
  function stopTunnel() {
    for (const o of [tunQuadA, tunQuadB, tunTrack, tunHead, tunTag && tunTag.mesh]) if (o) { tunnel.remove(o); o.geometry.dispose(); o.material.dispose(); }
    for (const t of [tunTexA, tunTexB, tunTag && tunTag.tex]) if (t) t.dispose();
    tunQuadA = tunQuadB = tunTrack = tunHead = tunTag = tunTexA = tunTexB = null;
    st.tunnel = null; tunnel.visible = false; left.visible = right.visible = true; markL.visible = markR.visible = true;
    st.dirty = st.menuDirty = true;
  }
  function stepTunnel(dt) {
    const T = cur.tunnel, s = st.tunnel; s.t += dt;
    const p = tunnelProgress(), e = p * p * (3 - 2 * p), speed = Math.sin(Math.PI * p) ** 1.3 * 30;
    tunQuadB.material.opacity = e;
    const P = q => new THREE.Vector3(-q[0] / arcsecPerM, q[1] / arcsecPerM, -DIST + 0.012);
    const a = P(T.from), b = P(T.to), c = a.clone().lerp(b, e);
    moveLine(tunTrack.geometry, a, c);
    tunHead.position.copy(c); tunHead.rotation.z = Math.atan2(b.y - a.y, b.x - a.x); tunHead.visible = p > 0.01;
    const year = (T.y0 + (T.y1 - T.y0) * e).toFixed(0);
    if (year !== s.year) {
      s.year = year; const x = tunTag.ctx; x.clearRect(0, 0, 480, 120); x.font = `500 80px ${FONT}`; x.fillStyle = C.signal; x.textBaseline = 'middle'; x.fillText(year, 8, 62); tunTag.done();
      st.dirty = true;
    }
    tunTag.mesh.position.set(c.x + 0.2, c.y + 0.12, -DIST + 0.02);
    streaks.material.opacity = Math.min(0.75, speed / 30);
    for (let i = 0; i < N_STREAK; i++) {
      const q = streakSeed[i]; q[2] += speed * dt; if (q[2] > 6) q[2] -= 51;
      const len = 0.05 + speed * 0.045;
      streakPos.set([q[0], q[1], q[2], q[0], q[1], q[2] - len], i * 6);
    }
    streakGeo.attributes.position.needsUpdate = true;
    if (p >= 1 && !s.done) { s.done = true; st.dirty = true; }
  }

  const loader = new THREE.TextureLoader(), chanFail = new Map(), CHAN_TRIES = 3;
  let chanBusy = false;
  const chanUrl = k => cur.channels.base + chanList()[k].file;
  const chanReady = k => { const f = chanFail.get(chanUrl(k)); return !f || (f.n < CHAN_TRIES && performance.now() >= f.until); };
  function setChannel(i) {
    const list = chanList(); if (!list.length || chanBusy) return false;
    const n = list.length, k = ((i % n) + n) % n, url = chanUrl(k);
    if (!chanReady(k)) return false;
    chanBusy = true;
    loader.load(url, tex => {
      chanBusy = false;
      if (disposed) { tex.dispose(); return; }
      chanFail.delete(url);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const old = sky.material.map; sky.material.map = tex; sky.material.color.set(0x6f778a); sky.material.needsUpdate = true;
      if (old) old.dispose();
      skyFrame = cur.channels.frame || 'icrs';
      if (centre) { qSky.setFromRotationMatrix(skyRotation(centre[0], centre[1], skyFrame)); sky.quaternion.copy(qSky); }
      st.chan = k; st.menuDirty = st.dirty = true;
      if (st.chanPend === k) st.chanPend = -1;
    }, undefined, () => {
      chanBusy = false;
      if (disposed) return;
      const g = chanFail.get(url) || { n: 0, until: 0 }; g.n++; g.until = performance.now() + 1000 * 2 ** g.n; chanFail.set(url, g);
      log('channel image not loaded:', list[k].file, `(failure ${g.n} of ${CHAN_TRIES})`);
      if (st.chanPend === k) { st.chanPend = -1; st.menuDirty = true; }
    });
    return true;
  }
  const nearestChan = lam => chanList().reduce((best, c, i, a) => (chanReady(i) && (best < 0 || Math.abs(c.lam - lam) < Math.abs(a[best].lam - lam)) ? i : best), -1);

  let targetList = [];
  const tagT = panel(15, 15 * 130 / 900, 900, 130, { transparent: true }); tagT.mesh.visible = false; root.add(tagT.mesh);
  function setTargets(list) {
    for (const t of targetList) { marks.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); }
    targetList = (list || []).map(t => ({ ...t, dir: onSphere(t.ra, t.dec) }));
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (const t of targetList) {
      t.mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.95, 40), new THREE.MeshBasicMaterial({ color: t.group === 'ydwarf' ? 0xe9b44c : 0xe8ecf4, side: THREE.DoubleSide }));
      t.mesh.position.copy(t.dir).multiplyScalar(SKY_R - 6);
      t.mesh.quaternion.setFromUnitVectors(zAxis, t.dir.clone().negate());
      marks.add(t.mesh);
    }
    st.hoverT = -1; st.hoverTs = ''; tagT.mesh.visible = false; marks.visible = st.targets && !cur.status;
  }
  function showTargetTag(i, all = i >= 0 ? [i] : []) {
    st.hoverT = i; st.hoverTs = all.join(',');
    targetList.forEach((t, j) => t.mesh.scale.setScalar(all.includes(j) ? 1.6 : 1));
    if (i < 0) { tagT.mesh.visible = false; return; }
    const t = targetList[i], c = tagT.ctx;
    c.clearRect(0, 0, 900, 130); c.fillStyle = 'rgba(8,11,19,0.86)'; c.fillRect(0, 0, 900, 130); c.fillStyle = C.signal; c.fillRect(0, 0, 8, 130);
    c.textBaseline = 'middle'; c.font = `500 52px ${FONT}`; c.fillStyle = C.ink; c.fillText(targetName(t, lang), 30, 44, 850);
    c.font = `400 34px ${FONT}`; c.fillStyle = C.soft; c.fillText(targetKind(t, lang), 30, 100, 850); tagT.done();
    const dir = t.dir.clone().applyQuaternion(marks.quaternion), z = dir.clone().negate();
    let x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    tagT.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    tagT.mesh.position.copy(dir).multiplyScalar(SKY_R - 9).addScaledVector(y, 3.2); tagT.mesh.visible = true;
  }
  setTargets(opts.targets);

  const worldG = new THREE.Group(); worldG.position.set(1.22, -0.05, -1.5); worldG.rotation.y = -0.5; worldG.visible = false; root.add(worldG);
  const WL = { w: 1.0, s: 0.5 };
  const worldLines = new THREE.Group(); worldG.add(worldLines);
  const worldTag = panel(1.0, 0.26, 1000, 260, { transparent: true }); worldTag.mesh.position.set(0, WL.s / 2 + 0.2, 0); worldG.add(worldTag.mesh);
  const worldAxis = panel(1.0, 0.07, 1000, 70, { transparent: true }); worldAxis.mesh.position.set(0, -WL.s / 2 - 0.05, WL.s / 2); worldG.add(worldAxis.mesh);
  function setWorld() {
    for (const o of [...worldLines.children]) { o.geometry.dispose(); o.material.dispose(); worldLines.remove(o); }
    const D = cur.worldline, mode = D ? st.world : null;
    worldG.visible = !!mode; guide.mesh.visible = !mode;
    if (!mode) return;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const add = (pts, color, opacity = 1, seg = false) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts), m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
      worldLines.add(seg ? new THREE.LineSegments(g, m) : new THREE.Line(g, m));
    };
    const X = yr => (yr - D.y0) / (D.y1 - D.y0) * WL.w - WL.w / 2;
    const wob = mode === 'wobble';
    let cx = 0, cy = 0;
    if (!wob) { const xs = D.model.map(m => m[1]), ys = D.model.map(m => m[2]); cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2; }
    const mv = m => (wob ? [m[3], m[4]] : [m[1] - cx, m[2] - cy]), ev = e => (wob ? [e.rxi, e.reta] : [e.xi - cx, e.eta - cy]);
    let R = 1e-6;
    for (const m of D.model) { const v = mv(m); R = Math.max(R, Math.abs(v[0]), Math.abs(v[1])); }
    for (const e of D.eps) { const v = ev(e); R = Math.max(R, Math.abs(v[0]) + (wob ? e.exi : 0), Math.abs(v[1]) + (wob ? e.eeta : 0)); }
    const k = WL.s / 2 / (R * 1.08), h = WL.s / 2, w = WL.w / 2;
    const box = [];
    for (const [y, z] of [[-h, -h], [-h, h], [h, -h], [h, h]]) box.push(V(-w, y, z), V(w, y, z));
    for (const x of [-w, w]) box.push(V(x, -h, -h), V(x, h, -h), V(x, h, -h), V(x, h, h), V(x, h, h), V(x, -h, h), V(x, -h, h), V(x, -h, -h));
    add(box, 0x626c82, 0.7, true);
    add([V(-w, 0, 0), V(w, 0, 0)], 0x626c82, 0.5);
    add(D.model.map(m => { const v = mv(m); return V(X(m[0]), v[1] * k, v[0] * k); }), 0xe9b44c);
    const wise = [], spx = [];
    for (const e of D.eps) {
      const v = ev(e), x = X(e.yr), y = v[1] * k, z = v[0] * k, ey = Math.max(e.eeta * k, 0.006), ez = Math.max(e.exi * k, 0.006);
      (e.spx ? spx : wise).push(V(x, y - ey, z), V(x, y + ey, z), V(x, y, z - ez), V(x, y, z + ez));
    }
    if (wise.length) add(wise, 0xe8ecf4, 1, true);
    if (spx.length) add(spx, 0xff9d3c, 1, true);
    const c = worldAxis.ctx; c.clearRect(0, 0, 1000, 70); c.font = `400 30px ${FONT}`; c.fillStyle = C.soft; c.textAlign = 'center'; c.textBaseline = 'middle';
    const step = D.y1 - D.y0 > 8 ? 4 : 1, ticks = [];
    for (let yr = Math.ceil(D.y0 / step) * step; yr <= D.y1; yr += step) { c.fillText(String(yr), (X(yr) + w) / WL.w * 1000, 36); ticks.push(V(X(yr), -h, h), V(X(yr), -h + 0.03, h)); }
    c.textAlign = 'left'; worldAxis.done();
    if (ticks.length) add(ticks, 0x9ba5b8, 1, true);
    const t = worldTag.ctx; t.clearRect(0, 0, 1000, 260); t.fillStyle = 'rgba(8,11,19,0.86)'; t.fillRect(0, 0, 1000, 260); t.fillStyle = C.signal; t.fillRect(0, 0, 8, 260);
    t.textBaseline = 'middle'; t.font = `500 40px ${FONT}`; t.fillStyle = C.ink;
    const cat = D.source === 'catalogue', pmv = Math.hypot(D.pm[0], D.pm[1]).toFixed(2);
    const line = wob ? (cat ? fill(L.worldWobbleCat, { name: D.name, plx: D.plx.toFixed(3), d: (1 / D.plx).toFixed(1) })
      : fill(L.worldWobble, { name: D.name, plx: D.plx.toFixed(2), e: D.e_plx.toFixed(2), d: (1 / D.plx).toFixed(1) }))
      : fill(cat ? L.worldMotionCat : L.worldMotion, { name: D.name, pm: pmv });
    const yEnd = wrap(t, line, 30, 52, 950, 50);
    t.font = `400 30px ${FONT}`; t.fillStyle = C.soft; t.fillText(cat ? L.worldLegendCat : L.worldLegend, 30, Math.max(yEnd + 6, 200)); worldTag.done();
  }

  const inv = new THREE.Matrix4(), o = new THREE.Vector3(), d = new THREE.Vector3();
  function onPanel(p, ptr) {
    p.mesh.updateMatrix(); inv.copy(p.mesh.matrix).invert();
    o.copy(ptr.origin).applyMatrix4(inv); d.copy(ptr.dir).transformDirection(inv);
    if (d.z > -1e-4) return null;
    const k = -o.z / d.z, x = o.x + k * d.x, y = o.y + k * d.y;
    return k < 0 ? null : { x, y, k, px: (x / p.w + 0.5) * p.pw, py: (0.5 - y / p.h) * p.ph };
  }
  function hitPanel(p, ptr) {
    const h = onPanel(p, ptr);
    if (!h || Math.abs(h.x) > p.w / 2 || Math.abs(h.y) > p.h / 2) return null;
    return [h.px, h.py, h.k];
  }
  function press(id, hx = 0) {
    log('menu:', id);
    if (id === 'sound') {
      if (sound) sound.stop();
      else if (lastSpec) import('./sonify.js').then(m => {
        if (disposed || !lastSpec) return;
        const snd = m.play(lastSpec.mean); if (!snd) return;
        sound = snd; st.menuDirty = true;
        snd.done.then(() => { if (sound === snd) sound = null; st.menuDirty = true; });
      }).catch(err => log('sound failed:', err && err.message));
    }
    else if (id === 'world') {
      const canWobble = !!(cur.worldline && cur.worldline.plx > 0);
      st.world = st.world === null ? (canWobble ? 'wobble' : 'motion') : st.world === 'wobble' ? 'motion' : null; setWorld();
    }
    else if (id === 'sky') { st.sky = !st.sky; if (skySnd) skySnd.setOn(st.sky); }
    else if (id === 'targets') { st.targets = !st.targets; marks.visible = st.targets; if (!st.targets) showTargetTag(-1); }
    if (id === 'mode') st.blink = !st.blink;
    else if (id === 'swap') st.swapped = !st.swapped;
    else if (id === 'spec') { st.spec = !st.spec; spec.visible = st.spec; if (st.spec) { spec.scale.y = 0.01; st.specAt = null; specRest.done = false; } }
    else if (id === 'meas') st.meas = !st.meas;
    else if (id === 'tunnel') { if (st.tunnel) stopTunnel(); else startTunnel(); }
    else if (id === 'centre') world.requestCentre = true;
    else if (id === 'exit') world.requestExit = true;
    st.dirty = st.menuDirty = true;
  }
  function refreshSpectrum(force) {
    if (!st.spec || !cur.spectrumAt) return;
    if (!force && specRest.done) return;
    specRest.done = true;
    let [xi, eta] = markSky(), snapped = false;
    if (cur.snap) { try { const s = cur.snap(xi, eta); if (s) { [xi, eta] = s; snapped = true; } } catch (err) { log('snap failed:', err && err.message); } }
    const tol = snapped ? 2 : 3, at = specCache.findIndex(e => e.snapped === snapped && Math.hypot(e.xi - xi, e.eta - eta) < tol);
    let entry;
    if (at >= 0) { entry = specCache[at]; specCache.splice(at, 1); }
    else {
      let data = null; try { data = cur.spectrumAt(xi, eta); } catch (err) { log('spectrum failed:', err && err.message); }
      entry = { xi, eta, snapped, data };
      if (specCache.length >= SPEC_CACHE_N) specCache.pop();
    }
    specCache.unshift(entry);
    st.specAt = [entry.xi, entry.eta];
    setSpectrum(entry.data);
  }

  const MARK_R = SKY_R - 6, HIT_DEG = 2.4;
  function skyReach(ptr) {
    const od = ptr.origin.dot(ptr.dir), c = ptr.origin.lengthSq() - MARK_R * MARK_R;
    return -od + Math.sqrt(Math.max(0, od * od - c));
  }
  const cursors = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.42, 24), new THREE.MeshBasicMaterial({ color: 0xe9b44c, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
    m.visible = false; m.renderOrder = 5; root.add(m); return m;
  });
  const ringAt = new THREE.Vector3(), toRing = new THREE.Vector3();

  const skyAt = new THREE.Vector3();
  function makeSky() {
    let voice = null;
    try { voice = cur.skyVoice ? cur.skyVoice() : null; } catch (err) { log('sky sound data failed:', err && err.message); }
    try { skySnd = createSkySound(voice) || false; } catch (err) { skySnd = false; log('sky sound failed:', err && err.message); }
    if (skySnd) skySnd.setOn(st.sky);
    st.menuDirty = true;
  }
  function skyPlace(head) {
    return s => {
      const half = cur.field / 2;
      if (Math.abs(s.xi) > half || Math.abs(s.eta) > half) return { x: 0, y: 0, z: -30 };
      const th = -st.axis * Math.PI / 180, px = -s.xi / arcsecPerM, py = s.eta / arcsecPerM;
      skyAt.set(px * Math.cos(th) - py * Math.sin(th), px * Math.sin(th) + py * Math.cos(th), -DIST);
      root.localToWorld(skyAt);
      if (head) skyAt.applyMatrix4(head.matrixWorldInverse);
      return { x: skyAt.x, y: skyAt.y, z: skyAt.z };
    };
  }

  world.frame = (dt, pointers, head = null) => {
    if (disposed) return;
    clock += dt;
    if (skySnd === null && clock > 0.3) makeSky();
    if (skySnd) { skySnd.setDuck(!!sound); skySnd.tick(dt, skyPlace(head)); }
    const rows = [], skyHovers = [], list = buttons();
    cursors.forEach(c => { c.visible = false; });
    st.pinned = Math.max(0, st.pinned - dt);
    for (const ptr of pointers) {
      const hit = hitPanel(menu, ptr), i = hit && hit[1] >= HEAD ? Math.floor((hit[1] - HEAD) / ROW) : -1;
      ptr.reach = hit ? hit[2] : 3;
      if (i >= 0 && i < list.length) {
        if (!rows.includes(i)) rows.push(i);
        if (ptr.trigger && !list[i].off) {
          if (list[i].id === 'chan') { st.chanDrag = ptr.id ?? pointers.indexOf(ptr); st.chanRest = 0; log('menu: chan drag'); }
          else press(list[i].id, hit[0]);
        }
      } else if (!st.tunnel && ptr.dir.z < -0.05) {
        const k = (-DIST - ptr.origin.z) / ptr.dir.z, x = ptr.origin.x + k * ptr.dir.x, y = ptr.origin.y + k * ptr.dir.y;
        if (Math.abs(x) < PLATE / 2 && Math.abs(y) < PLATE / 2) {
          if (st.pinned <= 0 || Math.hypot(x - st.mx, y - st.my) > 0.09) { st.mx = x; st.my = y; st.pinned = 0; }
          if (ptr.trigger) {
            const [xi, eta] = markSky();
            if (!(cur.onPick && cur.onPick(xi, eta))) {
              const s = cur.snap && cur.snap(xi, eta);
              if (s) { const th = -st.axis * Math.PI / 180, px = -s[0] / arcsecPerM, py = s[1] / arcsecPerM; st.mx = px * Math.cos(th) - py * Math.sin(th); st.my = px * Math.sin(th) + py * Math.cos(th); }
              st.pinned = 2.5; refreshSpectrum(true);
            }
          }
        }
      }
      const kPlate = ptr.dir.z < -0.05 ? (-DIST - ptr.origin.z) / ptr.dir.z : -1;
      const onPlate = kPlate > 0 && Math.abs(ptr.origin.x + kPlate * ptr.dir.x) < PLATE / 2 + 0.05 && Math.abs(ptr.origin.y + kPlate * ptr.dir.y) < PLATE / 2 + 0.05;
      const hg = guide.mesh.visible ? hitPanel(guide, ptr) : null, hi = hitPanel(info, ptr);
      if (!hit) ptr.reach = onPlate ? kPlate : hg ? hg[2] : hi ? hi[2] : skyReach(ptr);
      if (marks.visible && targetList.length && i < 0 && !onPlate && !hg && !hi) {
        let best = -1, bd = Math.cos(HIT_DEG * Math.PI / 180);
        targetList.forEach((t, j) => {
          ringAt.copy(t.dir).applyQuaternion(marks.quaternion).multiplyScalar(MARK_R);
          const c = toRing.subVectors(ringAt, ptr.origin).normalize().dot(ptr.dir);
          if (c > bd) { bd = c; best = j; }
        });
        if (best >= 0 && !skyHovers.includes(best)) skyHovers.push(best);
        const cu = cursors[pointers.indexOf(ptr) % 2];
        cu.position.copy(ptr.origin).addScaledVector(ptr.dir, ptr.reach - 0.5);
        cu.lookAt(ringAt.copy(ptr.origin).applyMatrix4(root.matrixWorld));
        cu.visible = true;
        if (best >= 0 && ptr.trigger && cur.onOpenField && !st.opening) {
          st.opening = targetName(targetList[best], lang); st.dirty = true; log('open field:', targetList[best].slug);
          Promise.resolve(cur.onOpenField(targetList[best].slug)).catch(err => log('open failed:', err && err.message)).finally(() => { st.opening = null; st.dirty = true; });
        }
      }
      if (st.chanDrag !== null && st.chanDrag === (ptr.id ?? pointers.indexOf(ptr))) {
        const h = onPanel(menu, ptr);
        if (h) {
          const f = Math.max(0, Math.min(1, (h.px - BAR_X0) / (BAR_X1 - BAR_X0)));
          const k = nearestChan(LAM_LO + f * (LAM_HI - LAM_LO));
          if (k >= 0 && k !== st.chanPend && k !== st.chan) { st.chanPend = k; st.chanRest = 0; st.menuDirty = true; }
          else if (k === st.chan && st.chanPend >= 0) { st.chanPend = -1; st.menuDirty = true; }
        }
        if (!ptr.held) { st.chanDrag = null; st.chanRest = 1; st.menuDirty = true; }
      }
      if (ptr.grip && !(cur.onNone && cur.onNone()) && !st.tunnel) { st.blink = !st.blink; st.dirty = st.menuDirty = true; }
      if (ptr.pad) world.requestCentre = true;
      const ax = ptr.ax || [0, 0];
      if (!st.tunnel) {
        if (!cur.status && Math.abs(ax[0]) > 0.25 && Math.abs(ax[0]) >= Math.abs(ax[1])) { st.axis = ((st.axis + ax[0] * 60 * dt + 540) % 360) - 180; st.dirty = true; }
        else if (Math.abs(ax[1]) > 0.25 && Math.abs(ax[1]) > Math.abs(ax[0])) {
          const disp = Math.max(-0.2, Math.min(0.2, st.disp - ax[1] * 0.03 * dt));
          if (disp !== st.disp) { st.disp = disp; st.dirty = true; }
        }
      }
    }
    const hoverKey = rows.join(',');
    if (hoverKey !== st.hover) { st.hover = hoverKey; hoverRows = rows; st.menuDirty = true; }
    if (st.chanDrag !== null && !pointers.some(q => (q.id ?? pointers.indexOf(q)) === st.chanDrag)) { st.chanDrag = null; st.chanRest = 1; }
    if (st.chanPend >= 0) {
      st.chanRest += dt;
      if (st.chanPend === st.chan) st.chanPend = -1;
      else if (st.chanRest > 0.3 && !chanBusy && !setChannel(st.chanPend)) { st.chanPend = -1; st.menuDirty = true; }
    }
    const skyKey = skyHovers.join(','), tagOn = skyHovers.includes(st.hoverT) ? st.hoverT : skyHovers.length ? skyHovers[0] : -1;
    if (skyKey !== st.hoverTs || tagOn !== st.hoverT) showTargetTag(tagOn, skyHovers);
    if (st.slew > 0) {
      st.slew -= dt; const e = Math.min(1, dt * 2.6);
      sky.quaternion.slerp(qSky, e); marks.quaternion.slerp(qMarks, e);
      if (st.slew <= 0) { sky.quaternion.copy(qSky); marks.quaternion.copy(qMarks); }
    }
    if (st.blink && !st.tunnel) { st.blinkT += dt; if (st.blinkT > 0.4) { st.blinkT = 0; st.phase ^= 1; st.dirty = true; } }
    if (st.tunnel) stepTunnel(dt);
    if (Math.hypot(st.mx - specRest.x, st.my - specRest.y) > REST_M) { specRest.x = st.mx; specRest.y = st.my; specRest.t = 0; specRest.done = false; }
    else specRest.t += dt;
    if (st.spec && !st.tunnel) { if (specRest.t > 0.45) refreshSpectrum(false); if (spec.scale.y < 1) spec.scale.y = Math.min(1, spec.scale.y + dt * 2.2); }
    if (st.dirty) {
      const a = st.swapped ? texB : texA, b = st.swapped ? texA : texB;
      matL.map = st.blink ? (st.phase ? b : a) : a; matR.map = st.blink ? (st.phase ? b : a) : b;
      plate.rotation.z = -st.axis * Math.PI / 180;
    }
    if (st.dirty || infoPending) drawInfo();
    if (st.dirty || st.menuDirty) drawGuide();
    st.dirty = false;
    if (st.menuDirty) { drawMenu(); st.menuDirty = false; }
    markL.position.set(st.mx - st.disp / 2, st.my, -DIST + 0.005);
    markR.position.set(st.mx + st.disp / 2, st.my, -DIST + 0.005);
    updateMeas();
  };

  world.setPair = next => {
    if (!next) return;
    if (st.tunnel) stopTunnel();
    if (next.a && next.b) { const oldA = texA, oldB = texB; texA = texture(upscale(next.a)); texB = texture(upscale(next.b)); oldA.dispose(); oldB.dispose(); }
    cur = { ...cur, ...next }; arcsecPerM = cur.field / PLATE;
    if (next.lang && TXT[next.lang] && next.lang !== lang) { lang = next.lang; L = TXT[lang]; measKey = ''; specTitleKey = ''; st.hoverTs = '-'; }
    st.swapped = false; st.blink = !!next.blink; st.phase = 0; st.disp = 0; st.specAt = null;
    if (cur.status) { st.axis = 0; st.spec = false; spec.visible = false; st.meas = false; st.world = null; }
    if (next.center && (!centre || next.center[0] !== centre[0] || next.center[1] !== centre[1])) {
      centre = next.center; aimSky(false);
      if (skySnd) skySnd.dispose();
      skySnd = null;
    }
    if (next.targets) setTargets(next.targets);
    marks.visible = st.targets && !cur.status;
    if (!cur.worldline) st.world = null;
    setWorld();
    specCache.length = 0; specRest.done = false;
    if (st.spec) setSpectrum(null);
    st.dirty = st.menuDirty = true;
  };
  world.parts = { menu: menu.mesh, info: info.mesh, guide: guide.mesh, spec, meas, tunnel, buttons, HEAD, ROW, MENU_H, MENU_W, markSky, sky, marks, worldG, skySound: () => skySnd,
    targets: () => targetList, skyFrame: () => skyFrame };
  world.dispose = () => {
    if (disposed) return;
    disposed = true;
    if (sound) { try { sound.stop(); } catch (err) {  } sound = null; }
    if (skySnd) { skySnd.dispose(); skySnd = false; }
    if (st.tunnel) stopTunnel();
    const geos = new Set(), mats = new Set(), texs = new Set([texA, texB]);
    scene.traverse(o => {
      if (o.geometry) geos.add(o.geometry);
      for (const m of [].concat(o.material || [])) { mats.add(m); for (const v of Object.values(m)) if (v && v.isTexture) texs.add(v); }
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of texs) t.dispose();
    specCache.length = 0; lastSpec = null; targetList = [];
    scene.clear();
  };
  return world;
}

async function fontsReady() {
  try { await Promise.all([400, 500, 600].map(w => document.fonts.load(`${w} 40px ${FONT}`))); } catch (e) {  }
}

export async function enter(opts) {
  if (!navigator.xr) throw new Error('WebXR unavailable');
  await fontsReady();
  log('enter: creating the WebGL renderer');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { xrCompatible: true, antialias: true, alpha: false, depth: true, stencil: true });
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  log('renderer ready on', gpuName(renderer.getContext()), '| xrCompatible', renderer.getContext().getContextAttributes().xrCompatible);
  renderer.setPixelRatio(1); renderer.setSize(640, 360, false);
  renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
  Object.assign(renderer.domElement.style, { position: 'fixed', right: '12px', bottom: '12px', width: '240px', height: '135px', zIndex: '50', border: '1px solid #E9B44C' });
  document.body.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(70, 640 / 360, 0.05, 200);
  camera.position.set(0, EYE_H, 0);
  const world = buildScene(opts), { scene, root } = world;

  const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]);
  const rayMat = new THREE.LineBasicMaterial({ color: 0x9ba5b8 });
  const ctrls = [0, 1].map(i => {
    const c = renderer.xr.getController(i); c.add(new THREE.Line(rayGeo, rayMat)); scene.add(c);
    c.userData.source = null;
    c.userData.onConnected = e => { c.userData.source = e.data || null; c.userData.fresh = true; log('controller', i, 'connected:', e.data && e.data.handedness, '| gamepad', !!(e.data && e.data.gamepad)); };
    c.userData.onDisconnected = e => { if (!e.data || c.userData.source === e.data) c.userData.source = null; log('controller', i, 'disconnected:', e.data && e.data.handedness); };
    c.addEventListener('connected', c.userData.onConnected); c.addEventListener('disconnected', c.userData.onDisconnected);
    return c;
  });
  const inv = new THREE.Matrix4(), fwd = new THREE.Vector3(), quat = new THREE.Quaternion();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    renderer.setAnimationLoop(null);
    for (const c of ctrls) { c.removeEventListener('connected', c.userData.onConnected); c.removeEventListener('disconnected', c.userData.onDisconnected); c.userData.source = null; }
    world.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  let session;
  try {
    log('scene built; requesting the immersive session');
    session = await navigator.xr.requestSession('immersive-vr');
    log('session granted; visibility', session.visibilityState, '| handing it to the renderer');
    session.addEventListener('visibilitychange', () => log('visibility', session.visibilityState));
    canvas.addEventListener('webglcontextlost', () => { if (!cleaned) log('WebGL context lost'); });
    const rsDesc = Object.getOwnPropertyDescriptor(XRSession.prototype, 'renderState');
    const hadLayers = session.renderState.layers !== undefined;
    if (hadLayers && rsDesc && rsDesc.get) {
      Object.defineProperty(session, 'renderState', {
        configurable: true,
        get() {
          const rs = rsDesc.get.call(session);
          return new Proxy(rs, { get(t, k) { if (k === 'layers') return undefined; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; } });
        },
      });
    }
    try { await renderer.xr.setSession(session); } finally { if (hadLayers) delete session.renderState; }
    const bl = renderer.xr.getBaseLayer();
    log('renderer has the session | layers API', hadLayers, '| classic XRWebGLLayer in use', !!(bl && bl.framebuffer), bl && bl.framebufferWidth ? bl.framebufferWidth + 'x' + bl.framebufferHeight : '');
  } catch (err) {
    log('failed:', err && err.message);
    if (session) { try { await session.end(); } catch (e) {  } }
    cleanup();
    throw err;
  }

  function place(pose) {
    const p = pose.transform.position, o = pose.transform.orientation;
    fwd.set(0, 0, -1).applyQuaternion(quat.set(o.x, o.y, o.z, o.w));
    root.position.set(p.x, p.y, p.z);
    root.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
    root.updateMatrixWorld(true);
  }

  const stat = { frames: 0, poses: 0, errors: 0, space: 'local' };
  let prev = performance.now(), nFrames = 0, nullRun = 0, fellBack = false, placed = false;
  const last = {};
  renderer.setAnimationLoop((time, frame) => {
    if (!frame) return;
    stat.frames = ++nFrames;
    try { step(frame); } catch (err) { if (stat.errors++ < 5) log('frame error:', err && (err.stack || err.message)); }
  });
  function step(frame) {
    const now = performance.now(), dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (nFrames === 1) log('first frame');
    const ref = renderer.xr.getReferenceSpace(), pose = ref ? frame.getViewerPose(ref) : null;
    if (pose) { nullRun = 0; if (++stat.poses === 1) log('first viewer pose at frame', nFrames, '| emulated position', pose.emulatedPosition); }
    else if (session.visibilityState === 'visible') nullRun++;
    if (!pose) {
      const bl = renderer.xr.getBaseLayer(), gl = renderer.getContext();
      if (bl && bl.framebuffer) { gl.bindFramebuffer(gl.FRAMEBUFFER, bl.framebuffer); gl.clearColor(0.02, 0.03, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT); renderer.resetState(); stat.empty = (stat.empty || 0) + 1; }
    }
    if (nullRun === 180 && !fellBack) {
      fellBack = true;
      log('no viewer pose in the', stat.space, 'space for 180 visible frames; trying the viewer space');
      session.requestReferenceSpace('viewer').then(s => { renderer.xr.setReferenceSpace(s); stat.space = 'viewer'; placed = false; log('viewer space in use'); })
        .catch(e => log('viewer space refused:', e && e.message));
    }
    if (nFrames === 90 || nFrames % 2700 === 0) log('frame', nFrames, '| poses', stat.poses, '| visibility', session.visibilityState, '| inputs', session.inputSources.length, '| placed', placed, '| space', stat.space);
    if (world.requestCentre) { placed = false; world.requestCentre = false; }
    if (!placed && pose) { place(pose); placed = true; log('plate placed at', root.position.toArray().map(v => v.toFixed(2)).join(',')); }
    if (world.requestExit) { world.requestExit = false; session.end(); return; }

    inv.copy(root.matrixWorld).invert();
    const pointers = [];
    ctrls.forEach((c, slot) => {
      const src = c.userData.source, gp = src && src.gamepad;
      if (!gp) return;
      let key = src.handedness === 'left' || src.handedness === 'right' ? src.handedness : 'none';
      if (pointers.some(p => p.id === key)) key += slot;
      const ax = gp.axes.length >= 4 && (Math.abs(gp.axes[2]) > 0.05 || Math.abs(gp.axes[3]) > 0.05) ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
      const trig = !!(gp.buttons[0] && gp.buttons[0].pressed), grip = !!(gp.buttons[1] && gp.buttons[1].pressed);
      const pad = (!!(gp.buttons[2] && gp.buttons[2].pressed) || !!(gp.buttons[3] && gp.buttons[3].pressed)) && Math.abs(ax[0]) < 0.25 && Math.abs(ax[1]) < 0.25;
      const was = c.userData.fresh ? { trig, grip, pad } : (last[key] || {});
      c.userData.fresh = false;
      last[key] = { trig, grip, pad };
      const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).applyMatrix4(inv);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld).transformDirection(inv);
      pointers.push({ id: key, origin, dir, ax, trigger: trig && !was.trig, held: trig, grip: grip && !was.grip, pad: pad && !was.pad, live: c.visible, ctrl: c });
    });
    try { world.frame(dt, pointers.filter(p => p.live), camera); } catch (err) { if (stat.errors++ < 5) log('scene error:', err && (err.stack || err.message)); }
    for (const p of pointers) if (p.ctrl && p.ctrl.children[0]) p.ctrl.children[0].scale.z = Math.max(0.2, (p.reach || 3) / 3);
    renderer.render(scene, camera);
  }

  session.addEventListener('end', () => { log('session ended after', nFrames, 'frames'); cleanup(); });
  return { session, setPair: world.setPair, end() { return session.end(); }, stats() { return { ...stat, visibility: session.visibilityState }; } };
}

export async function preview(opts) {
  const L = TXT[langOf(opts)];
  await fontsReady();
  const wrapEl = document.createElement('div');
  Object.assign(wrapEl.style, { position: 'fixed', inset: '0', zIndex: '60', background: '#020308' });
  const canvas = document.createElement('canvas'); Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', cursor: 'crosshair' });
  const bar = document.createElement('div');
  Object.assign(bar.style, { position: 'absolute', left: '0', right: '0', bottom: '0', padding: '10px 16px', display: 'flex', gap: '16px', alignItems: 'center', font: `400 13px ${FONT}`, color: C.soft, background: 'rgba(5,7,13,0.78)', borderTop: '1px solid rgba(232,236,244,0.13)' });
  const hint = document.createElement('span'); hint.textContent = L.preview; hint.style.flex = '1';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = L.close;
  bar.append(hint, close); wrapEl.append(canvas, bar); document.body.appendChild(wrapEl);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const camera = new THREE.PerspectiveCamera(64, 1, 0.05, 200);
  camera.layers.enable(1);
  const world = buildScene(opts), { scene, root } = world;
  root.position.set(0, 0, 0); root.updateMatrixWorld(true);
  camera.position.set(0, -0.12, 1.05);
  const look = { yaw: 0, pitch: -0.12 }, mouse = { x: 0, y: 0, in: false, down: false, held: false, drag: false }, keys = new Set();
  let grip = false, eye = 1, alive = true, prev = performance.now(), frames = 0;
  const size = () => { const w = wrapEl.clientWidth, h = wrapEl.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  size();
  const onMove = ev => {
    const r = canvas.getBoundingClientRect();
    if (mouse.drag) { look.yaw -= ev.movementX * 0.003; look.pitch = Math.max(-1.2, Math.min(1.2, look.pitch - ev.movementY * 0.003)); }
    mouse.x = (ev.clientX - r.left) / r.width * 2 - 1; mouse.y = -((ev.clientY - r.top) / r.height * 2 - 1); mouse.in = true;
  };
  const onDown = ev => { if (ev.button === 0) { mouse.down = true; mouse.held = true; } else mouse.drag = true; };
  const onUp = ev => { if (ev.button === 0) mouse.held = false; else mouse.drag = false; };
  const onKey = ev => {
    if (ev.key === 'Escape') return end();
    if (ev.key === 'g' || ev.key === 'G') grip = true;
    if (ev.key === 'b' || ev.key === 'B') { camera.layers.disable(eye); eye = eye === 1 ? 2 : 1; camera.layers.enable(eye); }
    if (ev.key.startsWith('Arrow')) { keys.add(ev.key); ev.preventDefault(); }
  };
  const onKeyUp = ev => keys.delete(ev.key);
  canvas.addEventListener('mousemove', onMove); canvas.addEventListener('mousedown', onDown); addEventListener('mouseup', onUp);
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  canvas.addEventListener('wheel', ev => { camera.fov = Math.max(25, Math.min(90, camera.fov + ev.deltaY * 0.03)); camera.updateProjectionMatrix(); ev.preventDefault(); }, { passive: false });
  addEventListener('keydown', onKey); addEventListener('keyup', onKeyUp); addEventListener('resize', size);
  close.onclick = () => end();

  function loop() {
    if (!alive) return;
    const now = performance.now(), dt = Math.min(0.1, (now - prev) / 1000); prev = now; frames++;
    camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ'); camera.updateMatrixWorld(true);
    const pointers = [];
    if (mouse.in) {
      const dir = new THREE.Vector3(mouse.x, mouse.y, 0.5).unproject(camera).sub(camera.position).normalize();
      const ax = [(keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)];
      pointers.push({ id: 'mouse', origin: camera.position.clone(), dir, ax, trigger: mouse.down, held: mouse.held, grip, pad: false });
    }
    mouse.down = false; grip = false;
    try { world.frame(dt, pointers, camera); } catch (err) { if (frames < 5) log('preview frame error:', err && (err.stack || err.message)); }
    if (world.requestCentre) { look.yaw = 0; look.pitch = -0.12; world.requestCentre = false; }
    if (world.requestExit) return end();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  function end() {
    if (!alive) return; alive = false;
    removeEventListener('mouseup', onUp); removeEventListener('keydown', onKey); removeEventListener('keyup', onKeyUp); removeEventListener('resize', size);
    world.dispose(); renderer.dispose(); renderer.forceContextLoss(); wrapEl.remove();
    if (window.__vrPreview === handle) window.__vrPreview = null;
  }
  requestAnimationFrame(loop);
  const handle = { world, camera, renderer, look, setPair: world.setPair, end, stats: () => ({ frames }) };
  window.__vrPreview = handle;
  return handle;
}
