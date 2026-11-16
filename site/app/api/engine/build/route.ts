import { engine, engineDown, readPosition, tooMany } from '@/lib/engine';
import { allow, clientKey } from '@/lib/rate';

export async function POST(request: Request) {
  if (!allow(clientKey(request, 'build'), 4)) return tooMany();
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { body = {}; }
  const pos = readPosition({ get: (k: string) => body[k] ?? null });
  if (!pos) return Response.json({ error: 'ra and dec in degrees are required', code: 'bad' }, { status: 400 });
  const r = await engine('/api/build', pos, 20_000);
  return r.ok ? Response.json(r.body, { status: r.status }) : engineDown();
}
