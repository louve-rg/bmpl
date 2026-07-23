import { NextResponse, type NextRequest } from 'next/server';

/**
 * Lightweight gate: if neither auth cookie is present, bounce to /login. This is
 * a UX guard only — real authorization is always enforced by the API on every
 * request (rule #1/#2). A present-but-expired token is handled by the API 401 +
 * client refresh flow.
 */
export function middleware(req: NextRequest) {
  const hasSession =
    req.cookies.has('access_token') || req.cookies.has('refresh_token');
  if (!hasSession) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
