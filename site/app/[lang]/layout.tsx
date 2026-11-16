import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { getDict } from '@/content';
import { STATIC, asset } from '@/lib/config';
import { LOCALES, hasLocale } from '@/lib/i18n';
import '../fonts.generated.css';
import '../globals.css';

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const d = getDict(lang);
  return {
    title: { default: d.meta.title, template: '%s · Ektos' },
    description: d.meta.description,
    alternates: { languages: { en: asset(STATIC ? '/en/' : '/en'), tr: asset(STATIC ? '/tr/' : '/tr') } },
  };
}

export default async function RootLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang);
  return (
    <html lang={lang} style={{ '--sky-map': `url("${asset('/sky/spherex_dr1_rgb_icrs_2048.jpg')}")` } as React.CSSProperties}>
      <body>
        <a className="skip" href="#main">{d.nav.skip}</a>
        <Header lang={lang} d={d} />
        <main id="main">{children}</main>
        <Footer lang={lang} d={d} />
      </body>
    </html>
  );
}
