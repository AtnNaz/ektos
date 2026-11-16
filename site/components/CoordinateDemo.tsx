'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dict } from '@/content';
import { parseCoords } from '@/lib/coords';
import { Arrow } from './icons';

type Count = { slug: string; kept: boolean; listed?: number; total?: number; cached?: number; est_mb?: number };
type Job = { state: string; done?: number; total?: number; mb?: number; slug?: string; code?: string };
type Phase =
  | { k: 'idle' }
  | { k: 'counting' }
  | { k: 'counted'; pos: { ra: number; dec: number }; c: Count }
  | { k: 'building'; job: Job }
  | { k: 'done'; slug: string; mb: number | null }
  | { k: 'error'; msg: string }
  | { k: 'offline' };

export function CoordinateDemo({ d, toolBase }: { d: Dict['demo']; toolBase: string }) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const fail = (code: string | undefined, status: number) => {
    if (status === 503 && code === 'engine') return setPhase({ k: 'offline' });
    const e = d.errors as Record<string, string>;
    setPhase({ k: 'error', msg: (status === 429 ? e.rate : code && e[code]) || e.unknown });
  };

  async function count(ev: React.FormEvent) {
    ev.preventDefault();
    const pos = parseCoords(text);
    if (!pos) return setPhase({ k: 'error', msg: d.badCoords });
    setPhase({ k: 'counting' });
    try {
      const r = await fetch(`/api/engine/count?ra=${pos.ra}&dec=${pos.dec}`);
      const body = await r.json();
      if (!alive.current) return;
      if (!r.ok) return fail(body.code, r.status);
      if (!body.kept && !body.listed) return setPhase({ k: 'error', msg: d.errors.empty });
      setPhase({ k: 'counted', pos, c: body });
    } catch { if (alive.current) setPhase({ k: 'error', msg: d.errors.unknown }); }
  }

  async function build(pos: { ra: number; dec: number }) {
    setPhase({ k: 'building', job: { state: 'listing' } });
    try {
      const r = await fetch('/api/engine/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pos) });
      const body = await r.json();
      if (!r.ok) return fail(body.code, r.status);
      for (;;) {
        await new Promise(res => setTimeout(res, 1500));
        if (!alive.current) return;
        const s = await fetch(`/api/engine/status?job=${body.job}`);
        const job: Job = await s.json();
        if (!alive.current) return;
        if (!s.ok) return fail(job.code, s.status);
        if (job.state === 'done' && job.slug) return setPhase({ k: 'done', slug: job.slug, mb: job.mb ?? null });
        if (job.state === 'error') return fail(job.code, 200);
        setPhase({ k: 'building', job });
      }
    } catch { if (alive.current) setPhase({ k: 'error', msg: d.errors.unknown }); }
  }

  const open = (slug: string) => `${toolBase}/index.html?t=${encodeURIComponent(slug)}`;
  const busy = phase.k === 'counting' || phase.k === 'building';

  return (
    <div>
      <form onSubmit={count} className="field">
        <label htmlFor="coords">{d.label}</label>
        <div className="demo-form">
          <input id="coords" className="input" type="text" spellCheck={false} autoComplete="off" placeholder={d.placeholder} value={text} onChange={e => setText(e.target.value)} />
          <button className="btn primary" type="submit" disabled={busy || !text.trim()}>{d.count}</button>
        </div>
      </form>

      <div className="demo-out" aria-live="polite">
        {phase.k === 'counting' && <p className="msg">{d.counting}</p>}
        {phase.k === 'error' && <p className="msg bad" role="alert">{phase.msg}</p>}
        {phase.k === 'offline' && (
          <>
            <p className="msg bad">{d.engineOffline}</p>
            <div className="panel" style={{ marginTop: 0 }}><h3>{d.recordedTitle}</h3><p>{d.recorded}</p></div>
          </>
        )}
        {phase.k === 'counted' && (phase.c.kept ? (
          <>
            <p className="msg good">{d.curated}</p>
            <div><a className="btn primary" href={open(phase.c.slug)}>{d.open}<Arrow /></a></div>
          </>
        ) : (
          <>
            <dl className="kv">
              <div><dt>{d.listed}</dt><dd>{phase.c.listed}</dd></div>
              <div><dt>{d.willFetch}</dt><dd>{phase.c.total}</dd></div>
              <div><dt>{d.cached}</dt><dd>{phase.c.cached}</dd></div>
              <div><dt>{d.estimate}</dt><dd>{phase.c.est_mb} MB</dd></div>
            </dl>
            <div><button className="btn primary" type="button" onClick={() => build(phase.pos)}>{d.build}</button></div>
          </>
        ))}
        {phase.k === 'building' && (
          <>
            <p className="msg">{d.building}: {phase.job.done ?? 0} / {phase.job.total || '…'} · {(phase.job.mb ?? 0).toFixed(1)} MB {d.spent}</p>
            <div className="bar"><i style={{ width: `${phase.job.total ? Math.round(100 * (phase.job.done ?? 0) / phase.job.total) : 0}%` }} /></div>
          </>
        )}
        {phase.k === 'done' && (
          <>
            <p className="msg good">{d.done}{phase.mb !== null ? `: ${phase.mb.toFixed(1)} MB ${d.spent}` : ''}</p>
            <div><a className="btn primary" href={open(phase.slug)}>{d.open}<Arrow /></a></div>
          </>
        )}
      </div>
    </div>
  );
}
