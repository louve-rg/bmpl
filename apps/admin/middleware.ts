import { NextResponse, type NextRequest } from 'next/server';

/** UX gate only — every admin API call is permission-checked on the backend. */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('access_token') || req.cookies.has('refresh_token');
  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
