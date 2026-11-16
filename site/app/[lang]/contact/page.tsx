import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContactForm } from '@/components/ContactForm';
import { getDict } from '@/content';
import { hasLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: PageProps<'/[lang]/contact'>): Promise<Metadata> {
  const { lang } = await params;
  return hasLocale(lang) ? { title: getDict(lang).contact.title, description: getDict(lang).contact.lead } : {};
}

export default async function Contact({ params }: PageProps<'/[lang]/contact'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const c = getDict(lang).contact;
  return (
    <div className="wrap" style={{ paddingBottom: '2rem' }}>
      <header className="page-head">
        <p className="kicker">{c.kicker}</p>
        <h1>{c.title}</h1>
        <p className="lead">{c.lead}</p>
      </header>
      <ContactForm d={c} lang={lang} />
    </div>
  );
}
