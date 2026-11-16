'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Dict } from '@/content';

export function AdminLogin({ d }: { d: Dict['admin'] }) {
  const router = useRouter();
  const [wrong, setWrong] = useState(false);
  async function enter(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const token = new FormData(ev.currentTarget).get('token');
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    if (r.ok) router.refresh(); else setWrong(true);
  }
  return (
    <form className="form" onSubmit={enter}>
      <div className="field"><label htmlFor="a-token">{d.token}</label><input id="a-token" name="token" className="input" type="password" autoComplete="off" required /></div>
      <div><button className="btn primary" type="submit">{d.enter}</button></div>
      {wrong && <p className="msg bad" role="alert">{d.wrong}</p>}
    </form>
  );
}

export function AdminLogout({ label }: { label: string }) {
  const router = useRouter();
  return <button className="btn" type="button" onClick={async () => { await fetch('/api/admin/login', { method: 'DELETE' }); router.refresh(); }}>{label}</button>;
}
