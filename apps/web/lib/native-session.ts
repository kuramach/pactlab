import { cookies, headers } from 'next/headers';
import { NATIVE_SESSION_COOKIE, nativeSessionState } from './auth-flow';
import { publicEnv, serverEnv } from './env';

/** Short-lived cookies remembering which address a code was sent to (kept out of URLs). */
const PENDING_EMAIL = {
  login: { name: 'pactlab_login_email', path: '/login' },
  signup: { name: 'pactlab_signup_email', path: '/signup' },
} as const;
export type CodeFlow = keyof typeof PENDING_EMAIL;

export interface IssuedSession {
  token: string;
  expiresAt: string;
  organizationId: string | null;
}

const secure = () => serverEnv().APP_BASE_URL.startsWith('https://');

/** The email-code session token when present and unexpired; never sent to the browser's JS. */
export async function nativeSessionToken(): Promise<string | null> {
  const token = (await cookies()).get(NATIVE_SESSION_COOKIE)?.value;
  return nativeSessionState(token) ? (token ?? null) : null;
}

/** Server actions only: Server Components cannot set cookies. */
export async function storeNativeSession(session: IssuedSession): Promise<void> {
  (await cookies()).set(NATIVE_SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expiresAt),
  });
}

export async function clearNativeSession(): Promise<void> {
  (await cookies()).delete(NATIVE_SESSION_COOKIE);
}

export async function rememberPendingEmail(email: string, flow: CodeFlow = 'login'): Promise<void> {
  const cookie = PENDING_EMAIL[flow];
  (await cookies()).set(cookie.name, email, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: cookie.path,
    maxAge: 10 * 60,
  });
}

export async function pendingEmail(flow: CodeFlow = 'login'): Promise<string | null> {
  return (await cookies()).get(PENDING_EMAIL[flow].name)?.value ?? null;
}

export async function forgetPendingEmail(flow: CodeFlow = 'login'): Promise<void> {
  const cookie = PENDING_EMAIL[flow];
  (await cookies()).delete({ name: cookie.name, path: cookie.path });
}

/** Server-side call to the API's email sign-in endpoints. */
export async function authApi(
  path: string,
  body: Record<string, unknown> | undefined,
  token?: string,
): Promise<{ status: number; data: unknown }> {
  // The API throttles code requests per client address; it cannot see the browser's.
  const clientIp = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
  const response = await fetch(new URL(path, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
    method: 'POST',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(clientIp ? { 'x-pactlab-client-ip': clientIp } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as unknown) : null };
}
