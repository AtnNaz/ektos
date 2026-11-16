import { matchesSecret } from '@/lib/auth';
import { addSession } from '@/lib/db';
import { fingerprint, parseSession } from '@/lib/experiment';
import { allow, clientKey } from '@/lib/rate';

export async function POST(request: Request) {
  if (!allow(clientKey(request, 'upload'), 6)) return Response.json({ code: 'rate' }, { status: 429 });
  if (!process.env.EXPERIMENT_KEY) return Response.json({ code: 'disabled' }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 2_000_000) return Response.json({ code: 'format' }, { status: 413 });
  let body: { key?: unknown; sessions?: unknown };
  try { body = JSON.parse(raw); } catch { return Response.json({ code: 'format' }, { status: 400 }); }
  if (!matchesSecret(body.key, 'EXPERIMENT_KEY')) return Response.json({ code: 'key' }, { status: 401 });
  if (!Array.isArray(body.sessions) || body.sessions.length === 0 || body.sessions.length > 200) return Response.json({ code: 'format' }, { status: 400 });
  const parsed = body.sessions.map(parseSession);
  if (parsed.some(s => s === null)) return Response.json({ code: 'format' }, { status: 400 });
  let stored = 0, duplicates = 0;
  for (const s of parsed) {
    if (!s) continue;
    if (addSession({ fingerprint: fingerprint(s), when: s.when, observer: s.observer, field: s.field, data: JSON.stringify(s) })) stored++;
    else duplicates++;
  }
  return Response.json({ stored, duplicates });
}
