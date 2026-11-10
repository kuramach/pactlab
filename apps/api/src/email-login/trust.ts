import { authSessions, type EmailLoginSession, type PrismaClient, type TrustHours } from '@pactlab/db';
import type { TrustChoice } from './email-login.schemas';

const HOURS: Record<Exclude<TrustChoice, '8h'>, TrustHours> = { '1d': 24, '1w': 168, '30d': 720 };

/**
 * "Stay signed in on this device" (T-112): lengthen a session just opened, within the
 * organization's cap. Returns the session's expiry, which the token then carries.
 */
export async function applyTrust(prisma: PrismaClient, session: EmailLoginSession, trust: TrustChoice, device: string | undefined): Promise<Date> {
  if (trust === '8h') return session.expiresAt;
  return (await authSessions.trust(prisma, { sessionId: session.sessionId, hours: HOURS[trust], deviceLabel: device ?? null })) ?? session.expiresAt;
}
