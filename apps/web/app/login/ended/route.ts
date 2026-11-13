import { NextResponse } from 'next/server';
import { NATIVE_SESSION_COOKIE, SIGN_IN_PATH } from '../../../lib/auth-flow';
import { serverEnv } from '../../../lib/env';

/**
 * The browser's Pactlab session ended elsewhere (T-112): signed out from another device,
 * 24 hours idle on a trusted device, or past the organization's limit. Server Components
 * cannot clear cookies, so the app sends the browser here to do it.
 */
export function GET(): NextResponse {
  // The public address, never request.url (the server's internal host behind the load balancer).
  const response = NextResponse.redirect(new URL(`${SIGN_IN_PATH}?ended=1`, serverEnv().APP_BASE_URL));
  response.cookies.delete(NATIVE_SESSION_COOKIE);
  return response;
}
