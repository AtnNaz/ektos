export const SWEEP = 5.0;
export const LAM0 = 0.75, LAM1 = 5.0;
export const F_HIGH = 1568, F_LOW = 196;
const VOLUME = 0.25;

export const timeOf = lam => SWEEP * (lam - LAM0) / (LAM1 - LAM0);
export const lamAt = t => LAM0 + (LAM1 - LAM0) * t / SWEEP;
export const pitchOf = lam => F_HIGH * Math.pow(F_LOW / F_HIGH, Math.log(lam / LAM0) / Math.log(LAM1 / LAM0));

export function loudness(mean) {
  const m = mean.filter(p => p[0] >= LAM0 && p[0] <= LAM1 && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (m.length < 5) return null;
  const d = [];
  for (let i = 1; i < m.length; i++) d.push(Math.abs(m[i][1] - m[i - 1][1]));
  d.sort((a, b) => a - b);
  const noise = 1.4826 * d[d.length >> 1] / Math.SQRT2;
  const pos = m.map(p => p[1]).filter(v => v > 0).sort((a, b) => a - b);
  const p90 = pos.length ? pos[Math.min(pos.length - 1, Math.floor(0.9 * pos.length))] : 0;
  const ref = Math.max(p90, 4 * noise, 1e-30);
  return { ref, noise, pts: m.map(([lam, v]) => ({ lam, t: timeOf(lam), f: pitchOf(lam), g: Math.min(1, Math.max(0, v / ref)) })) };
}

function schedule(ctx, env, t0) {
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(env.pts[0].f, t0);
  gain.gain.setValueAtTime(0, t0);
  for (const p of env.pts) {
    osc.frequency.linearRampToValueAtTime(p.f, t0 + Math.max(p.t, 0.001));
    gain.gain.linearRampToValueAtTime(VOLUME * p.g, t0 + Math.max(p.t, 0.001));
  }
  gain.gain.linearRampToValueAtTime(0, t0 + SWEEP + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + SWEEP + 0.1);
  return osc;
}

let shared = null;
export function play(mean) {
  const env = loudness(mean);
  if (!env) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  shared = shared || new AC();
  if (shared.state === 'suspended') shared.resume();
  const t0 = shared.currentTime + 0.05, osc = schedule(shared, env, t0);
  let ended = false;
  const done = new Promise(resolve => { osc.onended = () => { ended = true; resolve(); }; });
  return { env, done, stop() { if (!ended) { try { osc.stop(); } catch (err) {  } } },
    lam() { return Math.min(LAM1, Math.max(LAM0, lamAt(shared.currentTime - t0))); } };
}

export async function render(mean, rate = 22050) {
  const env = loudness(mean);
  if (!env) return null;
  const ctx = new OfflineAudioContext(1, Math.ceil(rate * (SWEEP + 0.1)), rate);
  schedule(ctx, env, 0);
  const buf = await ctx.startRendering();
  return { env, rate, samples: buf.getChannelData(0) };
}
