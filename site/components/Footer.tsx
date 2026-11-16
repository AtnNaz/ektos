import Link from 'next/link';
import type { Dict } from '@/content';
import { asset, toolLink } from '@/lib/config';
import type { Locale } from '@/lib/i18n';
import { LangSwitch } from './HeaderNav';

export function Footer({ lang, d }: { lang: Locale; d: Dict }) {
  const f = d.footer;
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <section>
            <h2>{f.dataTitle}</h2>
            <p>{f.data}</p>
            <p lang="en">{f.ack}</p>
            <p>{f.noSynthetic}</p>
          </section>
          <section>
            <h2>{f.docsTitle}</h2>
            <ul>
              {f.docs.map(doc => (
                <li key={doc.file}><a href={asset(`/docs/${doc.file}`)}>{doc.label}</a><small>{f.docsLang}</small></li>
              ))}
            </ul>
          </section>
          <section>
            <h2>{f.siteTitle}</h2>
            <ul>
              <li><Link href={`/${lang}`}>{d.nav.home}</Link></li>
              <li><Link href={`/${lang}/science`}>{d.nav.science}</Link></li>
              <li><Link href={`/${lang}/experiment`}>{d.nav.experiment}</Link></li>
              <li><Link href={`/${lang}/contact`}>{d.nav.contact}</Link></li>
              <li><a href={toolLink('index.html')}>{d.nav.openTool}</a></li>
            </ul>
          </section>
        </div>
        <div className="foot-base">
          <span className="mark">Ektos</span>
          <p>{f.team} · {f.challenge}</p>
          <LangSwitch lang={lang} labels={d.lang} />
        </div>
        <p className="muted" style={{ marginTop: '1.2rem' }}>{f.thirdParty}</p>
      </div>
    </footer>
  );
}
