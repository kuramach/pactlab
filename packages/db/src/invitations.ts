import type { PrismaClient } from './client';
import { APP_DB_ROLE } from './tenant';

/** Run one statement as the application role, which holds EXECUTE on the invitation functions (ADR 0014). */
function asApp<T>(prisma: PrismaClient, run: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return run(tx);
  });
}

export interface InvitationPreviewRow {
  dealName: string;
  organizationName: string;
  email: string;
  side: string;
  role: string;
  status: string;
  expiresAt: Date;
}

/**
 * Pact invitations (T-094 B12). Lookups by token hash and acceptance go
 * through security-definer functions owned by the auth role, so they work
 * before (and independent of) the invitee's tenant scope.
 */
export const invitationLinks = {
  async preview(prisma: PrismaClient, tokenHash: string): Promise<InvitationPreviewRow | null> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ deal_name: string; organization_name: string; email: string; side: string; role: string; status: string; expires_at: Date }[]>`
        SELECT * FROM app_invitation_preview(${tokenHash})`,
    );
    const row = rows[0];
    return row ? { dealName: row.deal_name, organizationName: row.organization_name, email: row.email, side: row.side, role: row.role, status: row.status, expiresAt: row.expires_at } : null;
  },

  async validFor(prisma: PrismaClient, tokenHash: string, email: string): Promise<boolean> {
    const rows = await asApp(prisma, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_invitation_valid_for(${tokenHash}, ${email}) AS ok`);
    return rows[0]?.ok === true;
  },

  /** The deal membership created for `userId`, or null when the invitation cannot be accepted by them. */
  async accept(prisma: PrismaClient, tokenHash: string, userId: string): Promise<{ organizationId: string; dealId: string; invitationId: string } | null> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ organization_id: string; deal_id: string; invitation_id: string }[]>`
        SELECT organization_id::text, deal_id::text, invitation_id::text FROM app_accept_deal_invitation(${tokenHash}, ${userId}::uuid)`,
    );
    const row = rows[0];
    return row ? { organizationId: row.organization_id, dealId: row.deal_id, invitationId: row.invitation_id } : null;
  },
};
