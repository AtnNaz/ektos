import { addMessage } from '@/lib/db';
import { hasLocale } from '@/lib/i18n';
import { allow, clientKey } from '@/lib/rate';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(request: Request) {
  if (!allow(clientKey(request, 'contact-any'), 30)) return Response.json({ code: 'rate' }, { status: 429 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ code: 'unknown' }, { status: 400 }); }
  if (text(body.website, 200)) return Response.json({ ok: true });
  const raw = typeof body.message === 'string' ? body.message.trim() : '';
  if (raw.length < 10) return Response.json({ code: 'message' }, { status: 400 });
  if (raw.length > 2000) return Response.json({ code: 'long' }, { status: 400 });
  const email = text(body.email, 200);
  if (email && !EMAIL.test(email)) return Response.json({ code: 'email' }, { status: 400 });
  if (!allow(clientKey(request, 'contact'), 3)) return Response.json({ code: 'rate' }, { status: 429 });
  const lang = typeof body.lang === 'string' && hasLocale(body.lang) ? body.lang : 'en';
  try {
    addMessage({ name: text(body.name, 120) || null, email: email || null, message: raw, lang });
  } catch {
    return Response.json({ code: 'unknown' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
