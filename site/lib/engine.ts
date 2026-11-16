const ENGINE_URL = (process.env.ENGINE_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');

export type EngineReply = { ok: true; status: number; body: unknown } | { ok: false };

export async function engine(path: string, params: Record<string, string | number> = {}, timeoutMs = 60_000): Promise<EngineReply> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  try {
    const r = await fetch(`${ENGINE_URL}${path}${q ? `?${q}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, status: r.status, body: await r.json() };
  } catch {
    return { ok: false };
  }
}

export function readPosition(src: { get(name: string): unknown }): { ra: number; dec: number; half: number } | null {
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const ra = num(src.get('ra')), dec = num(src.get('dec'));
  const halfRaw = src.get('half');
  const half = halfRaw === null || halfRaw === undefined ? 24 : num(halfRaw);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra > 360 || dec < -90 || dec > 90) return null;
  if (!Number.isInteger(half) || half < 8 || half > 40) return null;
  return { ra, dec, half };
}

export const engineDown = () => Response.json({ error: 'engine not reachable', code: 'engine' }, { status: 503 });
export const tooMany = () => Response.json({ error: 'too many requests', code: 'rate' }, { status: 429 });
