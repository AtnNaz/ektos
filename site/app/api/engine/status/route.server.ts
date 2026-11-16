import { engine, engineDown, tooMany } from '@/lib/engine';
import { allow, clientKey } from '@/lib/rate';

export async function GET(request: Request) {
  if (!allow(clientKey(request, 'status'), 120)) return tooMany();
  const job = new URL(request.url).searchParams.get('job') || '';
  if (!/^[0-9a-f]{10}$/.test(job)) return Response.json({ error: 'unknown job', code: 'bad' }, { status: 400 });
  const r = await engine('/api/status', { job }, 10_000);
  return r.ok ? Response.json(r.body, { status: r.status }) : engineDown();
}
