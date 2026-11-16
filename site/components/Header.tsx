import Link from 'next/link';
import type { Dict } from '@/content';
import { toolLink } from '@/lib/config';
import type { Locale } from '@/lib/i18n';
import { LangSwitch, NavLinks } from './HeaderNav';
import { Arrow } from './icons';

export function Header({ lang, d }: { lang: Locale; d: Dict }) {
  const items = [
    { href: `/${lang}`, label: d.nav.home },
    { href: `/${lang}/science`, label: d.nav.science },
    { href: `/${lang}/experiment`, label: d.nav.experiment },
    { href: `/${lang}/contact`, label: d.nav.contact },
  ];
  return (
    <header className="site">
      <div className="wrap site-in">
        <Link className="mark" href={`/${lang}`}>Ektos</Link>
        <NavLinks items={items} label={d.nav.pages} />
        <a className="btn primary tool" href={toolLink('index.html')}>{d.nav.openTool}<Arrow /></a>
        <LangSwitch lang={lang} labels={d.lang} />
      </div>
    </header>
  );
}
