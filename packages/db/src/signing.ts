import type { PrismaClient, TransactionClient } from './client';
import { APP_DB_ROLE } from './tenant';

async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

type Provider = 'FIXTURE' | 'DOCUSIGN' | 'BOLDSIGN';
type Observed = 'SENT' | 'DELIVERED' | 'COMPLETED' | 'DECLINED' | 'EXPIRED' | 'VOIDED';

/**
 * E-signature outcomes (T-107, T-136). A provider's webhook carries no user session, so what it
 * reports is recorded through SECURITY DEFINER functions, idempotently.
 */
export const signingOutcomes = {
  /** T-107's recorder, kept for the release still running; new code records through `observe`. */
  async record(prisma: PrismaClient, provider: Provider, envelopeId: string, status: 'COMPLETED' | 'DECLINED' | 'VOIDED') {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ organization_id: string; deal_id: string; batch_id: string; status: string }[]>`
        SELECT organization_id::text, deal_id::text, batch_id::text, status FROM app_signing_record(${provider}, ${envelopeId}, ${status})`,
    );
    return row ? { organizationId: row.organization_id, dealId: row.deal_id, batchId: row.batch_id, status: row.status } : null;
  },

  /**
   * One provider observation (T-136): `eventId` names it, so a second delivery changes nothing; the
   * status only moves forward. Returns the envelope when this call changed it, else null.
   */
  async observe(prisma: PrismaClient, input: { provider: Provider; envelopeId: string; status: Observed; reason: string | null; eventId: string; source: 'WEBHOOK' | 'POLL' }) {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ envelope_row_id: string; organization_id: string; deal_id: string; batch_id: string; loi_id: string | null; status: string }[]>`
        SELECT envelope_row_id::text, organization_id::text, deal_id::text, batch_id::text, loi_id::text, status
          FROM app_signing_event(${input.provider}, ${input.envelopeId}, ${input.status}, ${input.reason}, ${input.eventId}, ${input.source})`,
    );
    return row ? { envelopeRowId: row.envelope_row_id, organizationId: row.organization_id, dealId: row.deal_id, batchId: row.batch_id, loiId: row.loi_id, status: row.status as Observed } : null;
  },

  /** A completed envelope's signed file or certificate, already stored under `objectKey`; true when recorded now. */
  async artifact(prisma: PrismaClient, input: { envelopeRowId: string; kind: 'SIGNED_DOCUMENT' | 'CERTIFICATE'; objectKey: string; sha256: string; sizeBytes: number }) {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ recorded: boolean }[]>`
        SELECT app_signing_artifact(${input.envelopeRowId}::uuid, ${input.kind}, ${input.objectKey}, ${input.sha256}, ${input.sizeBytes}::int) AS recorded`,
    );
    return row?.recorded === true;
  },

  /** One keyset page of open envelopes not checked since `staleBefore`, across organizations (the worker sweep, T-144). */
  async openPage(prisma: PrismaClient, input: { staleBefore: Date; after: string | null; limit: number }) {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ envelope_row_id: string; organization_id: string; deal_id: string; provider: string; provider_envelope_id: string }[]>`
        SELECT envelope_row_id::text, organization_id::text, deal_id::text, provider, provider_envelope_id
          FROM app_signing_open_page(${input.staleBefore}::timestamptz, ${input.after}::uuid, ${input.limit}::int)`,
    );
    return rows.map((row) => ({ envelopeRowId: row.envelope_row_id, organizationId: row.organization_id, dealId: row.deal_id, provider: row.provider as Provider, providerEnvelopeId: row.provider_envelope_id }));
  },

  /** A poll that could not reach a verdict: stamps the envelope as checked and audits it on the pact (once a day). True when audited now. */
  async pollFailed(prisma: PrismaClient, envelopeRowId: string) {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ audited: boolean }[]>`SELECT app_signing_poll_failed(${envelopeRowId}::uuid) AS audited`);
    return row?.audited === true;
  },
};
