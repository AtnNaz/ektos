import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LANG_COOKIE, LOCALES, hasLocale } from '@/lib/i18n';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (LOCALES.some(l => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return;
  const saved = request.cookies.get(LANG_COOKIE)?.value;
  const url = request.nextUrl.clone();
  url.pathname = `/${hasLocale(saved) ? saved : DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
