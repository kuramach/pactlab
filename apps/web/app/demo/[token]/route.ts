import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '../../../lib/env';
import { authApi, storeNativeSession, type IssuedSession } from '../../../lib/native-session';

/**
 * A shared-demo link (T-113): `/demo/<token>` signs the visitor in as that demo's buyer or
 * seller, with no code, and opens their pacts. An ended or unknown link says the demo has ended.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  // The app's public address, never request.url: behind the load balancer a route handler sees the
  // server's internal host, and a redirect there is a page the browser cannot reach.
  const to = (path: string) => new URL(path, serverEnv().APP_BASE_URL);
  const { token } = await params;
  const opened = /^[A-Za-z0-9_-]{43}$/.test(token) ? await authApi('/v1/auth/demo-link', { token }) : { status: 401, data: null };
  if (opened.status !== 200) return NextResponse.redirect(to('/demo/ended'));
  await storeNativeSession(opened.data as IssuedSession);
  return NextResponse.redirect(to('/deals'));
}
