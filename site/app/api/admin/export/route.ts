import { cookies } from 'next/headers';
import { ADMIN_COOKIE, isAdmin } from '@/lib/auth';
import { listMessages, listSessions } from '@/lib/db';

export async function GET() {
  if (!isAdmin((await cookies()).get(ADMIN_COOKIE)?.value)) return Response.json({ error: 'not signed in' }, { status: 401 });
  const body = { exported_at: new Date().toISOString(), messages: listMessages(), sessions: listSessions().map(s => ({ ...s, data: JSON.parse(s.data) })) };
  return new Response(JSON.stringify(body, null, 1), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="ektos-site-export.json"' } });
}
