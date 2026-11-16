import { createHash, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'ektos-admin';
const digest = (s: string) => createHash('sha256').update(s).digest();

export function matchesSecret(given: unknown, envName: 'ADMIN_TOKEN' | 'EXPERIMENT_KEY'): boolean {
  const secret = process.env[envName];
  if (!secret || typeof given !== 'string' || !given) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

export const adminCookieValue = () => (process.env.ADMIN_TOKEN ? digest(`ektos-admin:${process.env.ADMIN_TOKEN}`).toString('hex') : null);
export function isAdmin(cookie: string | undefined): boolean {
  const want = adminCookieValue();
  return !!want && !!cookie && cookie.length === want.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(want));
}
