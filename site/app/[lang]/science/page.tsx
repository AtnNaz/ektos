import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Arrow } from '@/components/icons';
import { getDict } from '@/content';
import { MACHINE_TABLE } from '@/content/facts';
import { toolLink } from '@/lib/config';
import { hasLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: PageProps<'/[lang]/science'>): Promise<Metadata> {
  const { lang } = await params;
  return hasLocale(lang) ? { title: getDict(lang).science.title, description: getDict(lang).science.lead } : {};
}

export default async function Science({ params }: PageProps<'/[lang]/science'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang), s = d.science, r = d.results;
  const fig = (file: string, f: { alt: string; caption: string }, w: number, h: number, wide = false) => (
    <figure className={wide ? (h > w ? 'tall' : 'wide') : undefined}>
      <Image src={`/img/${file}`} alt={f.alt} width={w} height={h} sizes={wide ? '(max-width: 78rem) 100vw, 70rem' : '(max-width: 52rem) 100vw, 36rem'} />
      <figcaption>{f.caption}</figcaption>
    </figure>
  );
  return (
    <>
      <header className="page-head wrap">
        <p className="kicker">{s.kicker}</p>
        <h1>{s.title}</h1>
        <p className="lead">{s.lead}</p>
      </header>

      <section className="section wrap" aria-labelledby="pipe-h">
        <p className="kicker"><span className="no">01</span>{s.pipelineTitle}</p>
        <h2 className="sr-only" id="pipe-h">{s.pipelineTitle}</h2>
        <ol className="flow">
          {s.pipeline.map((p, i) => <li key={p.title}><b>{String(i + 1).padStart(2, '0')}</b><strong>{p.title}</strong><span>{p.body}</span></li>)}
        </ol>
      </section>

      <section className="section wrap" aria-labelledby="method-h">
        <p className="kicker"><span className="no">02</span>{s.methodTitle}</p>
        <h2 className="sr-only" id="method-h">{s.methodTitle}</h2>
        <dl className="defs">
          {s.method.map(m => <div key={m.title}><dt>{m.title}</dt><dd>{m.body}</dd></div>)}
        </dl>
        <div className="figs">
          {fig('wavelength-map.png', s.figures.wavelengthMap, 2400, 740, true)}
          {fig('wise0855-track.png', s.figures.track, 2400, 404, true)}
          {fig('wise0855-parallax.png', s.figures.parallax, 1568, 532, true)}
        </div>
      </section>

      <section className="section wrap" aria-labelledby="res-h">
        <p className="kicker"><span className="no">03</span>{r.kicker}</p>
        <h2 className="h2" id="res-h" style={{ maxWidth: '26ch' }}>{r.title}</h2>
        <p className="lead">{r.lead}</p>
        <table className="sheet stack">
          <thead><tr><th scope="col">{r.cols.target}</th><th scope="col">{r.cols.measured}</th><th scope="col">{r.cols.control}</th></tr></thead>
          <tbody>
            {r.rows.map(row => (
              <tr key={row.name} data-tone={row.tone}>
                <td><span className="name">{row.name}</span><span className="kind">{row.kind}</span></td>
                <td data-label={r.cols.measured}>{row.measured}</td>
                <td data-label={r.cols.control}>{row.control}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="figs">
          {fig('smdet1-control.png', s.figures.smdet, 1408, 534)}
          {fig('blind-test.png', s.figures.blind, 1568, 676)}
        </div>
      </section>

      <section className="section wrap" aria-labelledby="inj-h">
        <p className="kicker"><span className="no">04</span>{s.injectTitle}</p>
        <h2 className="sr-only" id="inj-h">{s.injectTitle}</h2>
        <p className="lead">{s.injectBody}</p>
        <h3 className="h3">{s.machineTitle}</h3>
        <div className="table-scroll">
          <table className="sheet num tight" style={{ maxWidth: '40rem', marginTop: '1.2rem' }}>
            <thead><tr><th scope="col">{s.machineCols.snr}</th>{MACHINE_TABLE.shifts.map(sh => <th scope="col" key={sh}>{s.machineCols.shift} {sh}″</th>)}</tr></thead>
            <tbody>
              {MACHINE_TABLE.rows.map(row => <tr key={row.snr}><td style={{ color: 'var(--ink)' }}>{row.snr}</td>{row.cells.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        <p className="lead" style={{ fontSize: 'var(--step-0)' }}>{s.machineNote}</p>
        <h3 className="h3">{s.limitTitle}</h3>
        <p className="lead" style={{ fontSize: 'var(--step-0)' }}>{s.limitBody}</p>
      </section>

      <section className="section wrap" aria-labelledby="lim-h">
        <p className="kicker"><span className="no">05</span>{d.honesty.limitsTitle}</p>
        <h2 className="sr-only" id="lim-h">{d.honesty.limitsTitle}</h2>
        <div className="two" style={{ marginTop: '2.6rem' }}>
          <div><h3>{d.honesty.notClaimTitle}</h3><ul className="dashes not">{d.honesty.notClaim.map(t => <li key={t}>{t}</li>)}</ul></div>
          <div><h3>{d.honesty.limitsTitle}</h3><ul className="dashes">{d.honesty.limits.map(t => <li key={t}>{t}</li>)}</ul></div>
        </div>
        <div className="figs">{fig('vr-preview.png', s.figures.vr, 1440, 900)}</div>
      </section>

      <section className="section wrap" aria-labelledby="deep-h">
        <p className="kicker"><span className="no">06</span>{s.toolLinks.title}</p>
        <h2 className="sr-only" id="deep-h">{s.toolLinks.title}</h2>
        <div className="links">
          <a className="btn" href={toolLink('how.html')}>{s.toolLinks.how}<Arrow /></a>
          <a className="btn" href={toolLink('math.html')}>{s.toolLinks.maths}<Arrow /></a>
          <a className="btn" href={toolLink('data.html')}>{s.toolLinks.data}<Arrow /></a>
          <a className="btn" href={toolLink('parity.html')}>{s.toolLinks.parity}<Arrow /></a>
        </div>
        {d.toolLang && <p className="muted" style={{ marginTop: '1.2rem' }}>{d.toolLang}</p>}
      </section>
    </>
  );
}
