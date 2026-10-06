import type { PrismaClient, TransactionClient } from './client';
import { APP_DB_ROLE } from './tenant';

/**
 * Email-code sign-in state lives behind SECURITY DEFINER functions; the
 * runtime role has no table privileges on it. These wrappers call them as
 * `pactlab_app` with no tenant context (pre-authentication).
 */
async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

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
