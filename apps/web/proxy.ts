import { NextResponse, type NextRequest } from 'next/server';
import { proxyDecision } from './lib/auth-flow';
import { auth0 } from './lib/auth0';

/** Serves /auth/* (login, logout, callback) and gates app paths on a session. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const client = auth0();
  const authResponse = await client.middleware(request);
  const { pathname, search } = request.nextUrl;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return authResponse;

  const session = await client.getSession(request);
  const decision = proxyDecision({
    pathname,
    search,
    signedIn: session !== null,
    organizationId: session?.user.org_id,
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
