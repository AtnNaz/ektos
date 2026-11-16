import { cookies } from 'next/headers';
import { ADMIN_COOKIE, adminCookieValue, matchesSecret } from '@/lib/auth';
import { allow, clientKey } from '@/lib/rate';

export async function POST(request: Request) {
  if (!allow(clientKey(request, 'login'), 5)) return Response.json({ code: 'rate' }, { status: 429 });
  if (!process.env.ADMIN_TOKEN) return Response.json({ code: 'disabled' }, { status: 503 });
  let body: { token?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  if (!matchesSecret(body.token, 'ADMIN_TOKEN')) return Response.json({ code: 'wrong' }, { status: 401 });
  (await cookies()).set(ADMIN_COOKIE, adminCookieValue()!, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 3600 });
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
}
