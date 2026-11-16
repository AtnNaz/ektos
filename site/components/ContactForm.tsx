'use client';

import { useState } from 'react';
import type { Dict } from '@/content';

const MAX = 2000;

export function ContactForm({ d, lang }: { d: Dict['contact']; lang: string }) {
  const [message, setMessage] = useState('');
  const [state, setState] = useState<{ k: 'idle' | 'sending' | 'sent' } | { k: 'error'; msg: string }>({ k: 'idle' });

  async function send(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget, f = new FormData(form);
    setState({ k: 'sending' });
    try {
      const r = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.get('name'), email: f.get('email'), message: f.get('message'), website: f.get('website'), lang }),
      });
      if (r.ok) { form.reset(); setMessage(''); return setState({ k: 'sent' }); }
      const body = await r.json().catch(() => ({}));
      const e = d.errors as Record<string, string>;
      setState({ k: 'error', msg: e[body.code] || e.unknown });
    } catch { setState({ k: 'error', msg: d.errors.unknown }); }
  }

  return (
    <form className="form" onSubmit={send} noValidate>
      <div className="row">
        <div className="field">
          <label htmlFor="c-name">{d.name} <small>({d.optional})</small></label>
          <input id="c-name" name="name" className="input" type="text" autoComplete="name" maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="c-email">{d.email} <small>({d.optional})</small></label>
          <input id="c-email" name="email" className="input" type="email" autoComplete="email" maxLength={200} aria-describedby="c-email-help" />
          <small id="c-email-help">{d.emailHelp}</small>
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-message">{d.message}</label>
        <textarea id="c-message" name="message" className="input" required maxLength={MAX} value={message} onChange={e => setMessage(e.target.value)} aria-describedby="c-left" />
        <small id="c-left">{MAX - message.length} {d.left}</small>
      </div>
      <div className="hp" aria-hidden="true"><label htmlFor="c-website">Website</label><input id="c-website" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
      <div className="foot-row">
        <button className="btn primary" type="submit" disabled={state.k === 'sending'}>{state.k === 'sending' ? d.sending : d.send}</button>
      </div>
      <div aria-live="polite">
        {state.k === 'sent' && <p className="msg good">{d.sent}</p>}
        {state.k === 'error' && <p className="msg bad" role="alert">{state.msg}</p>}
      </div>
    </form>
  );
}
