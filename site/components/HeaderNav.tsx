'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BASE } from '@/lib/config';
import { LANG_COOKIE, type Locale, swapLocale } from '@/lib/i18n';
import { FlagGB, FlagTR } from './icons';

type Item = { href: string; label: string };

function rememberLang(to: Locale) {
  document.cookie = `${LANG_COOKIE}=${to}; path=${BASE || '/'}; max-age=31536000; samesite=lax`;
}

export function NavLinks({ items, label }: { items: Item[]; label: string }) {
  const pathname = usePathname().replace(/(.)\/$/, '$1');
  return (
    <nav aria-label={label}>
      <ul>
        {items.map(it => (
          <li key={it.href}>
            <Link href={it.href} aria-current={pathname === it.href ? 'page' : undefined}>{it.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function LangSwitch({ lang, labels }: { lang: Locale; labels: { label: string; en: string; tr: string; switchTo: string } }) {
  const pathname = usePathname();
  const opt = (to: Locale, flag: React.ReactNode) => (
    <Link
      href={swapLocale(pathname, to)}
      hrefLang={to}
      lang={to}
      scroll={false}
      aria-current={lang === to ? 'true' : undefined}
      aria-label={lang === to ? labels[to] : `${labels.switchTo} ${labels[to]}`}
      onClick={() => rememberLang(to)}
    >
      {flag}
      {to.toUpperCase()}
    </Link>
  );
  return (
    <div className="langs" role="group" aria-label={labels.label}>
      {opt('en', <FlagGB />)}
      {opt('tr', <FlagTR />)}
    </div>
  );
}
