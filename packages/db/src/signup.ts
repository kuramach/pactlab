import type { PrismaClient, TransactionClient } from './client';
import { APP_DB_ROLE } from './tenant';

/**
 * Self-serve sign-up state lives behind SECURITY DEFINER functions; the
 * runtime role has no table privileges on it. Called as `pactlab_app` with
 * no tenant context (pre-authentication).
 */
async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

export type SignupBegin =
  | { kind: 'code'; challengeId: string }
  | { kind: 'existing-user' }
  | { kind: 'throttled' };

export interface SignedUpOrganization {
  organizationId: string;
  slug: string;
  status: 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED';
  ownerUserId: string;
  organizationName: string;
  ownerName: string;
  ssoRequested: boolean;
}

export const signup = {
  async begin(
    prisma: PrismaClient,
    input: {
      email: string;
      displayName: string;
      organizationName: string;
      ssoRequested: boolean;
      codeHash: string;
      ipHash: string;
    },
  ): Promise<SignupBegin> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ challenge_id: string | null; existing_user: boolean }[]>`
        SELECT challenge_id::text, existing_user FROM app_signup_begin(
          ${input.email}, ${input.displayName}, ${input.organizationName}, ${input.ssoRequested},
          ${input.codeHash}, ${input.ipHash})`,
    );
    if (!row) return { kind: 'throttled' };
    if (row.existing_user) return { kind: 'existing-user' };
    return row.challenge_id ? { kind: 'code', challengeId: row.challenge_id } : { kind: 'throttled' };
  },

  async verify(
    prisma: PrismaClient,
    input: { email: string; codeHash: string; requiresApproval: boolean },
  ): Promise<SignedUpOrganization | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<
        {
          organization_id: string;
          slug: string;
          status: SignedUpOrganization['status'];
          owner_user_id: string;
          organization_name: string;
          owner_name: string;
          sso_requested: boolean;
        }[]
      >`SELECT organization_id::text, slug, status::text AS status, owner_user_id::text, organization_name, owner_name, sso_requested
          FROM app_signup_verify(${input.email}, ${input.codeHash}, ${input.requiresApproval})`,
    );
    return row
      ? {
          organizationId: row.organization_id,
          slug: row.slug,
          status: row.status,
          ownerUserId: row.owner_user_id,
          organizationName: row.organization_name,
          ownerName: row.owner_name,
          ssoRequested: row.sso_requested,
        }
      : null;
  },
};
