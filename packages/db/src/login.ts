import type { PrismaClient } from './client';
import { asApp } from './auth-role';

export interface EmailLoginSession {
  sessionId: string;
  userId: string;
  subject: string;
  /** Null when the user belongs to several email-code organizations and must pick one. */
  organizationId: string | null;
  expiresAt: Date;
}

export const emailLogin = {
  /** Challenge id when a code should be sent; null otherwise. Callers respond identically. */
  async begin(
    prisma: PrismaClient,
    input: { email: string; codeHash: string; ipHash: string },
  ): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string | null }[]>`
        SELECT app_email_login_begin(${input.email}, ${input.codeHash}, ${input.ipHash})::text AS id`,
    );
    return row?.id ?? null;
  },

  async verify(
    prisma: PrismaClient,
    input: { email: string; codeHash: string },
  ): Promise<EmailLoginSession | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<
        {
          session_id: string;
          user_id: string;
          subject: string;
          organization_id: string | null;
          expires_at: Date;
        }[]
      >`SELECT session_id::text, user_id::text, subject, organization_id::text, expires_at
          FROM app_email_login_verify(${input.email}, ${input.codeHash})`,
    );
    return row
      ? {
          sessionId: row.session_id,
          userId: row.user_id,
          subject: row.subject,
          organizationId: row.organization_id,
          expiresAt: new Date(row.expires_at),
        }
      : null;
  },
};

export const authSessions = {
  async rescope(
    prisma: PrismaClient,
    sessionId: string,
    organizationId: string,
  ): Promise<{ sessionId: string; expiresAt: Date } | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ session_id: string; expires_at: Date }[]>`
        SELECT session_id::text, expires_at
          FROM app_auth_session_rescope(${sessionId}::uuid, ${organizationId}::uuid)`,
    );
    return row ? { sessionId: row.session_id, expiresAt: new Date(row.expires_at) } : null;
  },

  async isActive(
    prisma: PrismaClient,
    input: { sessionId: string; subject: string; organizationId: string | null },
  ): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ active: boolean }[]>`
        SELECT app_auth_session_active(${input.sessionId}::uuid, ${input.subject}, ${input.organizationId}::uuid) AS active`,
    );
    return row?.active === true;
  },

  async revoke(prisma: PrismaClient, sessionId: string): Promise<void> {
    await asApp(prisma, (tx) => tx.$executeRaw`SELECT app_auth_session_revoke(${sessionId}::uuid)`);
  },
};

/** The signed-in user behind an email-code session (T-108). `signedInAt` survives a move between organizations. */
export interface PasskeyAccount {
  userId: string;
  email: string | null;
  displayName: string;
  signedInAt: Date;
  offerDismissed: boolean;
}

export interface StoredPasskey {
  id: string;
  credentialId: string;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Passkey sign-in state (T-108), behind SECURITY DEFINER functions like the email codes.
 * Everything a signed-in user does names their session, never a user id.
 */
export const passkeys = {
  async account(prisma: PrismaClient, sessionId: string): Promise<PasskeyAccount | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ user_id: string; email: string | null; display_name: string; signed_in_at: Date; offer_dismissed: boolean }[]>`
        SELECT user_id::text, email, display_name, signed_in_at, offer_dismissed FROM app_passkey_account(${sessionId}::uuid)`,
    );
    return row
      ? { userId: row.user_id, email: row.email, displayName: row.display_name, signedInAt: new Date(row.signed_in_at), offerDismissed: row.offer_dismissed }
      : null;
  },

  async list(prisma: PrismaClient, sessionId: string): Promise<StoredPasskey[]> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string; credential_id: string; transports: string[]; name: string; created_at: Date; last_used_at: Date | null }[]>`
        SELECT id::text, credential_id, transports, name, created_at, last_used_at FROM app_passkey_list(${sessionId}::uuid)`,
    );
    return rows.map((row) => ({
      id: row.id,
      credentialId: row.credential_id,
      transports: row.transports,
      name: row.name,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    }));
  },

  /** A challenge id, or null when not allowed (sign-in rate limit; registration needs a recent sign-in). */
  async beginChallenge(
    prisma: PrismaClient,
    input: { purpose: 'SIGN_IN' | 'REGISTER'; sessionId: string | null; challenge: string; ipHash: string | null },
  ): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string | null }[]>`
        SELECT app_passkey_challenge_begin(${input.purpose}, ${input.sessionId}::uuid, ${input.challenge}, ${input.ipHash})::text AS id`,
    );
    return row?.id ?? null;
  },

  /** Consumes the challenge (one attempt each) and returns it, or null. */
  async takeChallenge(prisma: PrismaClient, input: { challengeId: string; purpose: 'SIGN_IN' | 'REGISTER'; sessionId: string | null }): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ challenge: string | null }[]>`
        SELECT app_passkey_challenge_take(${input.challengeId}::uuid, ${input.purpose}, ${input.sessionId}::uuid) AS challenge`,
    );
    return row?.challenge ?? null;
  },

  /** The new passkey's id, or null when refused (sign-in too old, limit of 10, already stored). */
  async register(
    prisma: PrismaClient,
    input: { sessionId: string; credentialId: string; publicKey: Uint8Array; counter: number; transports: string[]; name: string },
  ): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string | null }[]>`
        SELECT app_passkey_register(${input.sessionId}::uuid, ${input.credentialId}, ${Buffer.from(input.publicKey)}, ${input.counter}::bigint, ${input.transports}::text[], ${input.name})::text AS id`,
    );
    return row?.id ?? null;
  },

  async lookup(prisma: PrismaClient, credentialId: string): Promise<{ publicKey: Uint8Array<ArrayBuffer>; counter: number; transports: string[] } | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ public_key: Uint8Array; counter: bigint; transports: string[] }[]>`
        SELECT public_key, counter, transports FROM app_passkey_lookup(${credentialId})`,
    );
    return row ? { publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports } : null;
  },

  /** After a verified signature: the same session an email code opens, or null (counter went backwards). */
  async login(prisma: PrismaClient, input: { credentialId: string; newCounter: number }): Promise<EmailLoginSession | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ session_id: string; user_id: string; subject: string; organization_id: string | null; expires_at: Date }[]>`
        SELECT session_id::text, user_id::text, subject, organization_id::text, expires_at
          FROM app_passkey_login(${input.credentialId}, ${input.newCounter}::bigint)`,
    );
    return row
      ? { sessionId: row.session_id, userId: row.user_id, subject: row.subject, organizationId: row.organization_id, expiresAt: new Date(row.expires_at) }
      : null;
  },

  /** The removed passkey's name, or null when it is not the session user's. */
  async revoke(prisma: PrismaClient, input: { sessionId: string; passkeyId: string }): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ name: string | null }[]>`SELECT app_passkey_revoke(${input.sessionId}::uuid, ${input.passkeyId}::uuid) AS name`,
    );
    return row?.name ?? null;
  },

  async dismissOffer(prisma: PrismaClient, sessionId: string): Promise<void> {
    await asApp(prisma, (tx) => tx.$executeRaw`SELECT app_passkey_offer_dismiss(${sessionId}::uuid)`);
  },
};
