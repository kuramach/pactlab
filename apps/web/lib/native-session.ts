import { cookies, headers } from 'next/headers';
import { NATIVE_SESSION_COOKIE, nativeSessionState } from './auth-flow';
import { deviceLabel, type TrustChoice } from './device-label';
import { publicEnv, serverEnv } from './env';

/** Short-lived cookies remembering which address a code was sent to (kept out of URLs). */
const PENDING_EMAIL = {
  login: { name: 'pactlab_login_email', path: '/login' },
  signup: { name: 'pactlab_signup_email', path: '/signup' },
  // Sign-up from a pact invitation happens on /invite/<token> (T-094 B12).
  invite: { name: 'pactlab_invite_email', path: '/invite' },
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

/**
 * After an email sign-in, the one-time passkey offer (T-108) is shown for 15 minutes,
 * the window in which a passkey can be added without signing in again.
 */
const PASSKEY_OFFER_COOKIE = 'pactlab_passkey_offer';

export async function rememberPasskeyOffer(): Promise<void> {
  (await cookies()).set(PASSKEY_OFFER_COOKIE, '1', { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: 15 * 60 });
}

export async function passkeyOfferPending(): Promise<boolean> {
  return (await cookies()).get(PASSKEY_OFFER_COOKIE)?.value === '1';
}

export async function forgetPasskeyOffer(): Promise<void> {
  (await cookies()).delete({ name: PASSKEY_OFFER_COOKIE, path: '/' });
}

/** The "stay signed in" choice between the email and code steps (T-112), like the pending address. */
const PENDING_TRUST_COOKIE = 'pactlab_login_trust';

export async function rememberPendingTrust(trust: string): Promise<void> {
  (await cookies()).set(PENDING_TRUST_COOKIE, trust, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/login', maxAge: 10 * 60 });
}

export async function pendingTrust(): Promise<string | null> {
  return (await cookies()).get(PENDING_TRUST_COOKIE)?.value ?? null;
}

export async function forgetPendingTrust(): Promise<void> {
  (await cookies()).delete({ name: PENDING_TRUST_COOKIE, path: '/login' });
}

/** What the API needs to trust this device: the choice and a readable device name. */
export async function trustFields(trust: TrustChoice): Promise<{ trust: TrustChoice; device?: string }> {
  const device = deviceLabel((await headers()).get('user-agent'));
  return { trust, ...(device ? { device } : {}) };
}

/**
 * After signing in again on a browser that still had a session (a step-up for a sensitive
 * action), end the old one so the device list shows this browser once.
 */
export async function retireSession(previousToken: string | null): Promise<void> {
  if (!previousToken) return;
  await authApi('/v1/auth/logout', undefined, previousToken).catch(() => undefined);
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
