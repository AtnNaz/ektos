import { pitchOf } from './sonify.js';

const VOLUME = 0.4;
const HUM = 0.5, CHIME = 0.55;
const VISIT_S = 7;
const GLIDE_S = 2.2;
const DUCK = 0.25;

let shared = null;
function context() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  shared = shared || new AC();
  return shared;
}

const ECHO_S = 2.0;
let room = null;
function echo(ctx) {
  if (!room || room.context !== ctx) {
    const n = Math.round(ctx.sampleRate * ECHO_S), buf = ctx.createBuffer(2, n, ctx.sampleRate), k = Math.exp(Math.log(1e-3) / n);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let s = 1234567 + ch * 7654321, env = 1;
      for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 1073741823.5 - 1) * env; env *= k; }
    }
    room = ctx.createConvolver(); room.buffer = buf;
  }
  return room;
}

export function prepare() {
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  echo(ctx);
}
function resumeOnClick(ctx) {
  const go = () => { ctx.resume(); window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true); };
  window.addEventListener('pointerdown', go, true); window.addEventListener('keydown', go, true);
}

export function createSkySound(voice) {
  if (!voice || !voice.visits || !voice.visits.length) return null;
  const ctx = context();
  if (!ctx) return null;
  const now = () => ctx.currentTime;

  const master = ctx.createGain(); master.gain.value = 0;
  const dry = ctx.createGain(); dry.gain.value = 0.8;
  const wet = ctx.createGain(); wet.gain.value = 0.45;
  const rm = echo(ctx), send = ctx.createGain();
  dry.connect(master); rm.connect(wet).connect(master); master.connect(ctx.destination);
  const bus = ctx.createGain(); bus.connect(dry); bus.connect(send).connect(rm);

  const nb = voice.lams.length;
  let peak = 0;
  for (const v of voice.visits) for (const x of v.f) if (x > peak) peak = x;
  const level = x => (peak > 0 && x > 0 ? Math.pow(Math.min(1, x / peak), 0.7) : 0);
  const humBus = ctx.createGain(); humBus.gain.value = HUM / Math.sqrt(nb);
  const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 2200; soft.Q.value = 0.3;
  humBus.connect(soft).connect(bus);
  const tones = voice.lams.map(lam => {
    const g = ctx.createGain(); g.gain.value = 0; g.connect(humBus);
    const f = pitchOf(lam), o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = f; o2.frequency.value = f * 1.003;
    const half = ctx.createGain(); half.gain.value = 0.5;
    o1.connect(half); o2.connect(half); half.connect(g);
    return { g, o: [o1, o2], lam };
  });
  let visit = 0, visitT = 0;
  function showVisit(i, glide = GLIDE_S) {
    const v = voice.visits[i];
    tones.forEach((t, b) => t.g.gain.setTargetAtTime(level(v.f[b]), now(), glide));
  }

  const fl = voice.stars.map(s => s.flux).filter(x => x > 0), lo = Math.log10(Math.min(...fl)), hi = Math.log10(Math.max(...fl));
  const chimeBus = ctx.createGain(); chimeBus.gain.value = CHIME; chimeBus.connect(bus);
  const stars = voice.stars.map((s, i) => {
    const rel = hi > lo ? 0.2 + 0.8 * (Math.log10(s.flux) - lo) / (hi - lo) : 1;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.5; pan.rolloffFactor = 0.4;
    pan.connect(chimeBus);
    const period = 4 + 10 * (1 - rel);
    const phase = ((Math.abs(s.xi * 7.31 + s.eta * 3.17 + i * 1.7) % period) + period) % period;
    return { ...s, rel, pan, period, wait: 1.5 + phase, f: pitchOf(Math.min(5, Math.max(0.75, s.lam))) };
  });
  function ring(s) {
    const t = now(), g = ctx.createGain(), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = 'sine'; o.frequency.value = s.f; o2.type = 'sine'; o2.frequency.value = s.f * 2.01; g2.gain.value = 0.18;
    const amp = 0.55 * s.rel * (s.target ? 1.3 : 1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.012); g.gain.setTargetAtTime(0, t + 0.012, 0.75);
    o.connect(g); o2.connect(g2).connect(g); g.connect(s.pan);
    o.start(t); o2.start(t); o.stop(t + 5); o2.stop(t + 5);
  }

  const api = {
    on: false, started: false,
    start() {
      if (ctx.state === 'suspended') { ctx.resume(); resumeOnClick(ctx); }
      if (api.started) return;
      api.started = true;
      for (const t of tones) for (const o of t.o) o.start();
      showVisit(0, 0.6);
    },
    setOn(on) {
      api.on = !!on;
      if (api.on) api.start();
      master.gain.setTargetAtTime(api.on ? VOLUME * (api.ducked ? DUCK : 1) : 0, now(), 0.6);
    },
    ducked: false,
    setDuck(d) {
      if (api.ducked === !!d) return;
      api.ducked = !!d;
      if (api.on) master.gain.setTargetAtTime(VOLUME * (api.ducked ? DUCK : 1), now(), 0.25);
    },
    tick(dt, place) {
      if (!api.on || !api.started) return;
      visitT += dt;
      if (voice.visits.length > 1 && visitT > VISIT_S) { visitT = 0; visit = (visit + 1) % voice.visits.length; showVisit(visit); }
      for (const s of stars) {
        if (place) {
          const p = place(s);
          if (p) { const t = now(); s.pan.positionX.setTargetAtTime(p.x, t, 0.05); s.pan.positionY.setTargetAtTime(p.y, t, 0.05); s.pan.positionZ.setTargetAtTime(p.z, t, 0.05); }
        }
        s.wait -= dt;
        if (s.wait <= 0) { s.wait += s.period; ring(s); }
      }
    },
    voice, output: master,
    visitIndex() { return visit; },
    dispose() {
      try { master.gain.cancelScheduledValues(now()); master.gain.setValueAtTime(0, now()); } catch (err) {  }
      for (const t of tones) for (const o of t.o) { try { if (api.started) o.stop(); } catch (err) {  } o.disconnect(); }
      for (const s of stars) s.pan.disconnect();
      send.disconnect(); try { rm.disconnect(wet); } catch (err) {  }
      master.disconnect();
    },
  };
  return api;
}

