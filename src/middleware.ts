import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'hp_session';

export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const isPublicPage = req.nextUrl.pathname === '/login' || req.nextUrl.pathname === '/signup';

  if (!hasSession && !isPublicPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  // Note: presence of the cookie doesn't mean it's valid — the (app) layout
  // re-validates server-side and redirects to /login itself if needed. Don't
  // bounce hasSession-but-invalid cookies away from /login here, or it loops.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
