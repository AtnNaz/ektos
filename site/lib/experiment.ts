import { createHash } from 'node:crypto';
import { wilson } from './wilson';

export type Row = { mode: 'blink' | 'stereo'; snr: number; shift: number; answer: 'click' | 'none' | 'timeout'; hit: boolean; rt: number; display?: string };
export type Session = { when: string; observer: number; field: string; rows: Row[] };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseSession(v: unknown): Session | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s.when !== 'string' || Number.isNaN(Date.parse(s.when)) || !isNum(s.observer) || typeof s.field !== 'string') return null;
  if (!Array.isArray(s.rows) || s.rows.length === 0 || s.rows.length > 500) return null;
  for (const r of s.rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') return null;
    if (r.mode !== 'blink' && r.mode !== 'stereo') return null;
    if (r.answer !== 'click' && r.answer !== 'none' && r.answer !== 'timeout') return null;
    if (typeof r.hit !== 'boolean' || !isNum(r.rt) || !isNum(r.snr) || !isNum(r.shift)) return null;
  }
  return v as Session;
}

export const fingerprint = (s: Session) => createHash('sha256').update(JSON.stringify(s)).digest('hex');

type Cell = { n: number; hit: number; lo: number; hi: number };
const cell = (rows: Row[]): Cell => {
  const n = rows.length, hit = rows.filter(r => r.hit).length, [lo, hi] = wilson(hit, n);
  return { n, hit, lo, hi };
};
const uniq = (v: number[]) => [...new Set(v)].sort((a, b) => a - b);

export type ModeSummary = {
  all: Cell; byShift: (Cell & { shift: number })[]; bySnr: (Cell & { snr: number })[];
  empty: number; falseAlarm: number; medianRt: number | null;
};
export type Summary = { sessions: number; observers: number; trials: number; modes: Record<'blink' | 'stereo', ModeSummary> };

export function summarise(sessions: Session[]): Summary {
  const rows = sessions.flatMap(s => s.rows);
  const mode = (m: 'blink' | 'stereo'): ModeSummary => {
    const inj = rows.filter(r => r.mode === m && r.snr > 0), empty = rows.filter(r => r.mode === m && !(r.snr > 0));
    const rts = inj.filter(r => r.hit).map(r => r.rt).sort((a, b) => a - b);
    return {
      all: cell(inj),
      byShift: uniq(inj.map(r => r.shift)).map(shift => ({ shift, ...cell(inj.filter(r => r.shift === shift)) })),
      bySnr: uniq(inj.map(r => r.snr)).map(snr => ({ snr, ...cell(inj.filter(r => r.snr === snr)) })),
      empty: empty.length,
      falseAlarm: empty.filter(r => r.answer === 'click').length,
      medianRt: rts.length ? rts[rts.length >> 1] : null,
    };
  };
  return {
    sessions: sessions.length,
    observers: new Set(sessions.map(s => s.observer)).size,
    trials: rows.length,
    modes: { blink: mode('blink'), stereo: mode('stereo') },
  };
}
