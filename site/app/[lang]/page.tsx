import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CoordinateDemo } from '@/components/CoordinateDemo';
import { Counters } from '@/components/Counters';
import { Glyph } from '@/components/Glyph';
import { SkyHero } from '@/components/SkyHero';
import { ToolEmbed } from '@/components/ToolEmbed';
import { Arrow } from '@/components/icons';
import { getDict } from '@/content';
import fields from '@/content/fields.generated.json';
import { TOOL_URL, toolLink } from '@/lib/config';
import { hasLocale } from '@/lib/i18n';

const no = (i: number) => String(i).padStart(2, '0');

export default async function Home({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang);
  const field = { t: 'wise0855', band: 'W2s', mode: 'diff' };

  return (
    <>
      <section className="hero">
        <SkyHero fields={fields.named} />
        <div className="wrap hero-in">
          <p className="kicker">{d.hero.kicker}</p>
          <h1>{d.hero.title}</h1>
          <p className="lead">{d.hero.lead}</p>
          <div className="hero-cta">
            <a className="btn primary" href={toolLink('index.html')}>{d.hero.ctaTool}<Arrow /></a>
            <a className="btn" href="#ideas">{d.hero.ctaHow}</a>
          </div>
          <div className="hero-foot">
            <p>{d.hero.caption}</p>
            <span className="cue" aria-hidden="true"><i />{d.hero.scroll}</span>
          </div>
        </div>
      </section>

      <section className="section wrap" aria-labelledby="problem-h">
        <p className="kicker"><span className="no">{no(1)}</span>{d.problem.kicker}</p>
        <h2 className="h2 rise" id="problem-h" style={{ maxWidth: '24ch' }}>{d.problem.title}</h2>
        <div className="split">
          <div className="prose rise">{d.problem.body.map(p => <p key={p}>{p}</p>)}</div>
          <dl className="read rise">
            {d.problem.stats.map(s => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
          </dl>
        </div>
      </section>

      <section className="section pin" aria-labelledby="history-h">
        <div className="pin-stage">
          <div className="wrap">
            <p className="kicker"><span className="no">{no(2)}</span>{d.history.kicker}</p>
            <h2 className="h2" id="history-h">{d.history.title}</h2>
            <ol className="pin-track">
              {d.history.items.map(it => (
                <li className="era" key={it.year}>
                  <p className="year">{it.year}</p>
                  <h3>{it.title}</h3>
                  <p>{it.body}</p>
                </li>
              ))}
            </ol>
            <div className="pin-bar" aria-hidden="true"><i /></div>
          </div>
        </div>
      </section>

      <section className="section wrap" id="ideas" aria-labelledby="ideas-h">
        <p className="kicker"><span className="no">{no(3)}</span>{d.ideas.kicker}</p>
        <h2 className="h2" id="ideas-h">{d.ideas.title}</h2>
        <ol className="ledger">
          {d.ideas.items.map((it, i) => (
            <li className="idea rise" key={it.title}>
              <span className="no">{no(i + 1)}</span>
              <h3>{it.title}</h3>
              <p>{it.body}</p>
              <Glyph i={i} />
            </li>
          ))}
        </ol>
      </section>

      <section className="section wrap" aria-labelledby="live-h">
        <p className="kicker"><span className="no">{no(4)}</span>{d.live.kicker}</p>
        <h2 className="h2" id="live-h">{d.live.title}</h2>
        <p className="lead">{d.live.body}</p>
        <div className="live">
          <figure className="live-plate">
            <ToolEmbed
              src={toolLink('index.html', { ...field, embed: 1 })}
              probe={`${TOOL_URL}/data/index.json`}
              title={d.live.frameTitle}
              alt={d.live.imageAlt}
              offline={d.live.offline}
            />
            <p className="legend">
              <span className="a"><i />2010 · WISE</span>
              <span className="b"><i />2026 · SPHEREx</span>
            </p>
          </figure>
          <div>
            <ul className="notes">
              {d.live.notes.map(n => <li className="rise" key={n.title}><h3>{n.title}</h3><p>{n.body}</p></li>)}
            </ul>
            <a className="btn primary" href={toolLink('index.html', field)}>{d.live.open}<Arrow /></a>
            {d.toolLang && <p className="muted" style={{ marginTop: '0.9rem' }}>{d.toolLang}</p>}
          </div>
        </div>
      </section>

      <section className="section wrap" aria-labelledby="adds-h">
        <p className="kicker"><span className="no">{no(5)}</span>{d.adds.kicker}</p>
        <h2 className="h2" id="adds-h" style={{ maxWidth: '26ch' }}>{d.adds.title}</h2>
        <p className="lead">{d.adds.lead}</p>
        <ul className="bento">
          {d.adds.items.map((it, i) => (
            <li className="cell rise" key={it.title}>
              <span className="no">{no(i + 1)}</span>
              <p className="value">{it.value}</p>
              <p className="versus">{it.versus}</p>
              <h3>{it.title}</h3>
              <p>{it.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="section wrap" aria-labelledby="results-h">
        <p className="kicker"><span className="no">{no(6)}</span>{d.results.kicker}</p>
        <h2 className="h2" id="results-h" style={{ maxWidth: '26ch' }}>{d.results.title}</h2>
        <p className="lead">{d.results.lead}</p>
        <table className="sheet stack">
          <thead><tr><th scope="col">{d.results.cols.target}</th><th scope="col">{d.results.cols.measured}</th><th scope="col">{d.results.cols.control}</th></tr></thead>
          <tbody>
            {d.results.rows.map(r => (
              <tr key={r.name} data-tone={r.tone}>
                <td><span className="name">{r.name}</span><span className="kind">{r.kind}</span></td>
                <td data-label={d.results.cols.measured}>{r.measured}</td>
                <td data-label={d.results.cols.control}>{r.control}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="after-table"><Link className="btn" href={`/${lang}/science`}>{d.results.more}<Arrow /></Link></p>
      </section>

      <section className="section wrap" aria-labelledby="honesty-h">
        <p className="kicker"><span className="no">{no(7)}</span>{d.honesty.kicker}</p>
        <h2 className="quote rise" id="honesty-h">{d.honesty.title}</h2>
        <p className="lead">{d.honesty.body}</p>
        <div className="aside rise"><h3>{d.honesty.example.title}</h3><p>{d.honesty.example.body}</p></div>
        <div className="two">
          <div><h3>{d.honesty.notClaimTitle}</h3><ul className="dashes not">{d.honesty.notClaim.map(t => <li key={t}>{t}</li>)}</ul></div>
          <div><h3>{d.honesty.limitsTitle}</h3><ul className="dashes">{d.honesty.limits.map(t => <li key={t}>{t}</li>)}</ul></div>
        </div>
      </section>

      <section className="mission" aria-labelledby="mission-h">
        <div className="wrap">
          <p className="kicker" id="mission-h">{d.mission.kicker}</p>
          <p className="statement rise">{d.mission.statement}</p>
          <p className="lead">{d.mission.body}</p>
          <p className="trio-title">{d.mission.forTitle}</p>
          <div className="trio">
            {d.mission.audiences.map(a => <div key={a.title}><h3>{a.title}</h3><p>{a.body}</p></div>)}
          </div>
        </div>
      </section>

      <section className="section wrap" aria-labelledby="challenge-h">
        <p className="kicker"><span className="no">{no(8)}</span>{d.challenge.kicker}</p>
        <h2 className="h2" id="challenge-h">{d.challenge.title}</h2>
        <table className="sheet stack tight">
          <thead><tr><th scope="col">{d.challenge.cols.item}</th><th scope="col">{d.challenge.cols.status}</th><th scope="col">{d.challenge.cols.note}</th></tr></thead>
          <tbody>
            {d.challenge.rows.map(r => (
              <tr key={r.item}>
                <td style={{ color: 'var(--ink)' }}>{r.item}</td>
                <td><span className={`tag ${r.status === 'yes' ? 'ok' : 'part'}`}>{r.status === 'yes' ? d.challenge.yes : d.challenge.partial}</span></td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section wrap" aria-labelledby="demo-h">
        <p className="kicker"><span className="no">{no(9)}</span>{d.demo.kicker}</p>
        <h2 className="h2" id="demo-h">{d.demo.title}</h2>
        <p className="lead">{d.demo.body}</p>
        <div className="demo">
          <CoordinateDemo d={d.demo} toolBase={TOOL_URL} />
          <Counters d={d.stats} />
        </div>
      </section>

      <section className="section wrap" aria-labelledby="next-h">
        <p className="kicker"><span className="no">{no(10)}</span>{d.next.kicker}</p>
        <h2 className="h2" id="next-h">{d.next.title}</h2>
        <ol className="steps">{d.next.items.map(t => <li key={t}><span>{t}</span></li>)}</ol>
      </section>
    </>
  );
}
