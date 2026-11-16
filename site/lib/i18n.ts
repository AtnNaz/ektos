export const LOCALES = ['en', 'tr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LANG_COOKIE = 'ektos-lang';

export const hasLocale = (v: string | undefined | null): v is Locale => v === 'en' || v === 'tr';

export function swapLocale(pathname: string, to: Locale): string {
  const parts = pathname.split('/');
  if (hasLocale(parts[1])) parts[1] = to;
  else parts.splice(1, 0, to);
  return parts.join('/') || `/${to}`;
}
