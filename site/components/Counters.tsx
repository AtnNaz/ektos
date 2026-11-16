'use client';

import { useEffect, useState } from 'react';
import type { Dict } from '@/content';
import fields from '@/content/fields.generated.json';
import { STATIC } from '@/lib/config';

type Stats = { engine: { up: boolean; mb: number | null; requests: number | null }; fields: number | null; sessions: number | null };
const show = (v: number | null | undefined, digits = 0) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—');

function StaticCounters({ d }: { d: Dict['stats'] }) {
  return (
    <div className="counters">
      <h3>{d.staticTitle}</h3>
      <dl className="read">
        <div><dt>{d.fields}</dt><dd>{show(fields.total)}</dd></div>
        <div><dt>{d.coldDwarfs}</dt><dd>{show(fields.coldDwarfs)}</dd></div>
      </dl>
      <p className="note">{d.staticNote}</p>
    </div>
  );
}

function LiveCounters({ d }: { d: Dict['stats'] }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => fetch('/api/stats').then(r => r.json()).then(v => { if (on) setS(v); }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  const up = s?.engine.up;
  return (
    <div className="counters">
      <h3>
        <span className={`dot${up === true ? ' up' : up === false ? ' down' : ''}`} aria-hidden="true" />
        {d.title}
        <span className="state">{up === true ? d.engineUp : up === false ? d.engineDown : ''}</span>
      </h3>
      <dl className="read">
        <div><dt>{d.engineMb}</dt><dd>{show(s?.engine.mb, 1)}</dd></div>
        <div><dt>{d.requests}</dt><dd>{show(s?.engine.requests)}</dd></div>
        <div><dt>{d.fields}</dt><dd>{show(s?.fields)}</dd></div>
        <div><dt>{d.sessions}</dt><dd>{show(s?.sessions)}</dd></div>
      </dl>
      <p className="note">{d.note}</p>
    </div>
  );
}

export function Counters({ d }: { d: Dict['stats'] }) {
  return STATIC ? <StaticCounters d={d} /> : <LiveCounters d={d} />;
}
