import { engine, engineDown, readPosition, tooMany } from '@/lib/engine';
import { allow, clientKey } from '@/lib/rate';

export async function GET(request: Request) {
  if (!allow(clientKey(request, 'count'), 20)) return tooMany();
  const pos = readPosition(new URL(request.url).searchParams);
  if (!pos) return Response.json({ error: 'ra and dec in degrees are required', code: 'bad' }, { status: 400 });
  const r = await engine('/api/count', pos);
  return r.ok ? Response.json(r.body, { status: r.status }) : engineDown();
}
