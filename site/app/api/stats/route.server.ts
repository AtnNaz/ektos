import fields from '@/content/fields.generated.json';
import { countSessions } from '@/lib/db';
import { engine } from '@/lib/engine';

let memo: { at: number; body: unknown } | null = null;

export async function GET(request: Request) {
  void request.url;
  if (memo && Date.now() - memo.at < 30_000) return Response.json(memo.body);
  const meter = await engine('/api/meter', {}, 2500);
  const m = meter.ok && meter.status === 200 ? (meter.body as { mb?: number; requests?: number }) : null;
  let sessions: number | null = null;
  try { sessions = countSessions(); } catch { sessions = null; }
  const body = {
    engine: m ? { up: true, mb: m.mb ?? null, requests: m.requests ?? null } : { up: false, mb: null, requests: null },
    fields: fields.total,
    coldDwarfs: fields.coldDwarfs,
    sessions,
  };
  memo = { at: Date.now(), body };
  return Response.json(body);
}
