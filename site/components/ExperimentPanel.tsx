'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Dict } from '@/content';
import { STATIC } from '@/lib/config';
import type { ModeSummary, Summary } from '@/lib/experiment';

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function ExperimentPanel({ d }: { d: Dict['experiment'] }) {
  if (STATIC) {
    return (
      <>
        <p className="empty">{d.none}</p>
        <div className="panel">
          <h3>{d.uploadTitle}</h3>
          <p>{d.staticUpload}</p>
        </div>
      </>
    );
  }
  return <LiveExperimentPanel d={d} />;
}

function LiveExperimentPanel({ d }: { d: Dict['experiment'] }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    fetch('/api/experiment/summary').then(r => (r.ok ? r.json() : Promise.reject())).then(setSum).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const [up, setUp] = useState<{ k: 'idle' | 'busy' } | { k: 'ok'; stored: number; duplicates: number } | { k: 'error'; msg: string }>({ k: 'idle' });
  async function upload(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget), file = f.get('file');
    const e = d.uploadErrors as Record<string, string>;
    if (!(file instanceof File) || !file.size) return setUp({ k: 'error', msg: e.format });
    setUp({ k: 'busy' });
    try {
      const parsed = JSON.parse(await file.text());
      const sessions = Array.isArray(parsed) ? parsed : parsed?.sessions;
      const r = await fetch('/api/experiment/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.get('key'), sessions }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return setUp({ k: 'error', msg: e[body.code] || e.unknown });
      setUp({ k: 'ok', stored: body.stored, duplicates: body.duplicates });
      load();
    } catch { setUp({ k: 'error', msg: e.format }); }
  }

  const rows = (m: ModeSummary, name: string) => [
    <tr key={`${name}-all`}><td style={{ color: 'var(--ink)' }}>{name}</td><td>{d.all}</td><td>{d.all}</td><td>{m.all.hit} / {m.all.n}</td><td>{m.all.n ? `${pct(m.all.hit / m.all.n)} (${pct(m.all.lo)}–${pct(m.all.hi)})` : '—'}</td></tr>,
    ...m.byShift.map(c => <tr key={`${name}-s${c.shift}`}><td>{name}</td><td>{c.shift}″</td><td>{d.all}</td><td>{c.hit} / {c.n}</td><td>{pct(c.hit / c.n)} ({pct(c.lo)}–{pct(c.hi)})</td></tr>),
    ...m.bySnr.map(c => <tr key={`${name}-n${c.snr}`}><td>{name}</td><td>{d.all}</td><td>{c.snr}</td><td>{c.hit} / {c.n}</td><td>{pct(c.hit / c.n)} ({pct(c.lo)}–{pct(c.hi)})</td></tr>),
  ];

  return (
    <>
      <div aria-live="polite">
        {failed && <p className="empty">—</p>}
        {sum && sum.sessions === 0 && <p className="empty">{d.none}</p>}
        {sum && sum.sessions > 0 && (
          <>
            <dl className="kv" style={{ marginTop: '1.6rem', maxWidth: '36rem' }}>
              <div><dt>{d.sessions}</dt><dd>{sum.sessions}</dd></div>
              <div><dt>{d.observers}</dt><dd>{sum.observers}</dd></div>
            </dl>
            <div className="table-scroll">
              <table className="sheet num tight">
                <thead><tr><th scope="col">{d.cols.mode}</th><th scope="col">{d.cols.shift}</th><th scope="col">{d.cols.snr}</th><th scope="col">{d.cols.hits}</th><th scope="col">{d.cols.rate}</th></tr></thead>
                <tbody>{rows(sum.modes.blink, d.modes.blink)}{rows(sum.modes.stereo, d.modes.stereo)}</tbody>
              </table>
            </div>
            <dl className="kv" style={{ marginTop: '1.6rem' }}>
              {(['blink', 'stereo'] as const).map(k => (
                <div key={k}><dt>{d.modes[k]}: {d.cols.falseAlarm}</dt><dd>{sum.modes[k].falseAlarm} / {sum.modes[k].empty}</dd></div>
              ))}
              {(['blink', 'stereo'] as const).map(k => (
                <div key={`${k}-rt`}><dt>{d.modes[k]}: {d.cols.rt}</dt><dd>{sum.modes[k].medianRt === null ? '—' : `${sum.modes[k].medianRt!.toFixed(1)} ${d.seconds}`}</dd></div>
              ))}
            </dl>
          </>
        )}
      </div>

      <div className="panel">
        <h3>{d.uploadTitle}</h3>
        <p>{d.uploadBody}</p>
        <form className="form" onSubmit={upload} style={{ marginTop: '1.4rem' }}>
          <div className="field"><label htmlFor="x-file">{d.file}</label><input id="x-file" name="file" className="input" type="file" accept="application/json,.json" required /></div>
          <div className="field"><label htmlFor="x-key">{d.key}</label><input id="x-key" name="key" className="input" type="password" autoComplete="off" required /></div>
          <div><button className="btn primary" type="submit" disabled={up.k === 'busy'}>{up.k === 'busy' ? d.uploading : d.upload}</button></div>
          <div aria-live="polite">
            {up.k === 'ok' && <p className="msg good">{up.stored} {d.uploaded}{up.duplicates ? ` · ${up.duplicates} ${d.duplicates}` : ''}</p>}
            {up.k === 'error' && <p className="msg bad" role="alert">{up.msg}</p>}
          </div>
        </form>
      </div>
    </>
  );
}
