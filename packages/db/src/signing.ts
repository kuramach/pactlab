import type { PrismaClient, TransactionClient } from './client';
import { APP_DB_ROLE } from './tenant';

async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

/**
 * E-signature outcomes (T-107). The provider's webhook carries no user session,
 * so the outcome is recorded through a SECURITY DEFINER function: it settles a
 * SENT envelope once and, on completion, records both sides' sign-offs.
 * Returns the envelope's pact, or null when unknown or already settled.
 */
export const signingOutcomes = {
  async record(prisma: PrismaClient, provider: 'FIXTURE' | 'DOCUSIGN', envelopeId: string, status: 'COMPLETED' | 'DECLINED' | 'VOIDED') {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ organization_id: string; deal_id: string; batch_id: string; status: string }[]>`
        SELECT organization_id::text, deal_id::text, batch_id::text, status FROM app_signing_record(${provider}, ${envelopeId}, ${status})`,
    );
    return row ? { organizationId: row.organization_id, dealId: row.deal_id, batchId: row.batch_id, status: row.status } : null;
  },
};
