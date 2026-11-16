import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AdminLogin, AdminLogout } from '@/components/AdminLogin';
import { getDict, type Dict } from '@/content';
import { ADMIN_COOKIE, isAdmin } from '@/lib/auth';
import { listMessages, listSessions } from '@/lib/db';
import { hasLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Team', robots: { index: false, follow: false } };

async function Area({ d }: { d: Dict['admin'] }) {
  if (!process.env.ADMIN_TOKEN) return <p className="empty">{d.disabled}</p>;
  if (!isAdmin((await cookies()).get(ADMIN_COOKIE)?.value)) return <AdminLogin d={d} />;
  const messages = listMessages(), sessions = listSessions();
  return (
    <>
      <div className="links"><a className="btn" href="/api/admin/export" download>{d.download}</a><AdminLogout label={d.logout} /></div>
      <h2 className="h3">{d.messages} ({messages.length})</h2>
      {messages.length === 0 ? <p className="empty">{d.none}</p> : (
        <table className="sheet stack tight" style={{ marginTop: '1.2rem' }}>
          <thead><tr><th scope="col">{d.when}</th><th scope="col">{d.from}</th><th scope="col">{d.messages}</th></tr></thead>
          <tbody>
            {messages.map(m => (
              <tr key={m.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{m.created_at.slice(0, 16).replace('T', ' ')}</td>
                <td>{m.name || '—'}{m.email ? <><br /><a href={`mailto:${m.email}`}>{m.email}</a></> : null}</td>
                <td style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 className="h3">{d.sessions} ({sessions.length})</h2>
      {sessions.length === 0 ? <p className="empty">{d.none}</p> : (
        <table className="sheet tight" style={{ marginTop: '1.2rem' }}>
          <thead><tr><th scope="col">{d.when}</th><th scope="col">{d.observer}</th><th scope="col">{d.field}</th><th scope="col">{d.trials}</th></tr></thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id}><td>{(s.when_run || '').slice(0, 16).replace('T', ' ')}</td><td>{s.observer}</td><td>{s.field}</td><td>{(JSON.parse(s.data).rows || []).length}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export default async function Admin({ params }: PageProps<'/[lang]/admin'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang).admin;
  return (
    <div className="wrap" style={{ paddingBottom: '2rem' }}>
      <header className="page-head"><h1>{d.title}</h1></header>
      <div style={{ marginTop: '2rem' }}>
        <Suspense fallback={<p className="muted">…</p>}><Area d={d} /></Suspense>
      </div>
    </div>
  );
}
