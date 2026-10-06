import { NextResponse, type NextRequest } from 'next/server';
import { NATIVE_SESSION_COOKIE, nativeSessionState, proxyDecision } from './lib/auth-flow';
import { auth0 } from './lib/auth0';

/** Serves /auth/* (login, logout, callback) and gates app paths on an Auth0 or email-code session. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const client = auth0();
  const { pathname, search } = request.nextUrl;
  // Without Auth0 configured there are no /auth/* routes and no Auth0 sessions.
  const authResponse = client ? await client.middleware(request) : NextResponse.next();
  if (pathname === '/auth' || pathname.startsWith('/auth/')) {
    return client ? authResponse : NextResponse.redirect(new URL('/login', request.url));
  }

  const session = client ? await client.getSession(request) : null;
  // Email-code sessions: routing only; the API verifies the token on every call.
  const native = session ? null : nativeSessionState(request.cookies.get(NATIVE_SESSION_COOKIE)?.value);
  const decision = proxyDecision({
    pathname,
    search,
    signedIn: session !== null || native !== null,
    organizationId: session ? session.user.org_id : native?.organizationId,
  });
  if (decision.kind === 'redirect') {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }
  // Carries any rolling-session cookie updates from the SDK.
  return authResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
};
