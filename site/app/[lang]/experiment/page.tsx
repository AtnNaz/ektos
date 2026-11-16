import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ExperimentPanel } from '@/components/ExperimentPanel';
import { Arrow } from '@/components/icons';
import { getDict } from '@/content';
import { MACHINE_TABLE } from '@/content/facts';
import { toolLink } from '@/lib/config';
import { hasLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: PageProps<'/[lang]/experiment'>): Promise<Metadata> {
  const { lang } = await params;
  return hasLocale(lang) ? { title: getDict(lang).experiment.title, description: getDict(lang).experiment.lead } : {};
}

export default async function Experiment({ params }: PageProps<'/[lang]/experiment'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang), x = d.experiment, s = d.science;
  return (
    <>
      <header className="page-head wrap">
        <p className="kicker">{x.kicker}</p>
        <h1>{x.title}</h1>
        <p className="lead">{x.lead}</p>
      </header>

      <section className="section wrap" aria-labelledby="proto-h">
        <p className="kicker"><span className="no">01</span>{x.protocolTitle}</p>
        <h2 className="sr-only" id="proto-h">{x.protocolTitle}</h2>
        <ol className="numbered">{x.protocol.map(p => <li key={p}><span>{p}</span></li>)}</ol>
        <p className="lead" style={{ fontSize: 'var(--step-0)' }}>{x.hypothesis}</p>
        <div className="links">
          <a className="btn primary" href={toolLink('index.html', { t: 'wise0855', band: 'W2s', a: 2, b: 3, exp: 1 })}>{x.openTool}<Arrow /></a>
        </div>
      </section>

      <section className="section wrap" aria-labelledby="sum-h">
        <p className="kicker"><span className="no">02</span>{x.summaryTitle}</p>
        <h2 className="sr-only" id="sum-h">{x.summaryTitle}</h2>
        <ExperimentPanel d={x} />
      </section>

      <section className="section wrap" aria-labelledby="mach-h">
        <p className="kicker"><span className="no">03</span>{x.machineTitle}</p>
        <h2 className="sr-only" id="mach-h">{x.machineTitle}</h2>
        <h3 className="h3" style={{ marginTop: '2rem' }}>{s.machineTitle}</h3>
        <div className="table-scroll">
          <table className="sheet num tight" style={{ maxWidth: '40rem', marginTop: '1.2rem' }}>
            <thead><tr><th scope="col">{s.machineCols.snr}</th>{MACHINE_TABLE.shifts.map(sh => <th scope="col" key={sh}>{s.machineCols.shift} {sh}″</th>)}</tr></thead>
            <tbody>
              {MACHINE_TABLE.rows.map(row => <tr key={row.snr}><td style={{ color: 'var(--ink)' }}>{row.snr}</td>{row.cells.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        <p className="lead" style={{ fontSize: 'var(--step-0)' }}>{s.machineNote}</p>
      </section>
    </>
  );
}
