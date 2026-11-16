export const STATIC = process.env.EKTOS_PAGES === '1';
export const BASE = process.env.EKTOS_BASE_PATH || '';
export const REPO_URL = `https://github.com/${process.env.EKTOS_REPO || 'AtnNaz/ektos'}`;

export const asset = (path: string) => `${BASE}${path}`;

export const TOOL_URL = (STATIC ? `${BASE}/tool` : process.env.NEXT_PUBLIC_TOOL_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');

export function toolLink(page: string, params: Record<string, string | number> = {}): string {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const s = q.toString();
  return `${TOOL_URL}/${page}${s ? `?${s}` : ''}`;
}
