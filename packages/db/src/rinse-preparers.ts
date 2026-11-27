import type { PrismaClient, TransactionClient } from './client';
import { asApp } from './auth-role';

/**
 * Pactlab Rinse preparers (T-178b, ADR 0059). Sign-up from an invite, acceptance, a preparer's own
 * bindings and the record of their AI rinse jobs go through SECURITY DEFINER functions owned by
 * pactlab_auth, which take the caller's session id, never a user id. The pact's own side reads and
 * revokes invites and bindings under RLS (`rinse_prep_invites`, `rinse_preparer_bindings`).
 */
export type PrepInviteState = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface PrepInvitePeek {
  inviteId: string;
  email: string;
  pactName: string;
  organizationName: string;
  expiresAt: Date;
  state: PrepInviteState;
}

export interface PreparerBinding {
  bindingId: string;
  organizationId: string;
  dealId: string;
  pactName: string;
  organizationName: string;
  boundAt: Date;
}

export interface PreparerSignedUp {
  userId: string;
  organizationId: string;
  session: { sessionId: string; subject: string; expiresAt: Date };
  /** Null when the invite was revoked or expired between start and verify: the account exists, unbound. */
  binding: { bindingId: string; organizationId: string; dealId: string } | null;
}

export const rinsePreparers = {
  async peek(prisma: PrismaClient, tokenHash: string): Promise<PrepInvitePeek | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ invite_id: string; email: string; pact_name: string; organization_name: string; expires_at: Date; state: PrepInviteState }[]>`
        SELECT invite_id::text, email, pact_name, organization_name, expires_at, state FROM app_rinse_invite_peek(${tokenHash})`,
    );
    return row ? { inviteId: row.invite_id, email: row.email, pactName: row.pact_name, organizationName: row.organization_name, expiresAt: new Date(row.expires_at), state: row.state } : null;
  },

  /** A challenge to email a code for; existing-user when the address signs in instead; null otherwise (identical replies). */
  async begin(
    prisma: PrismaClient,
    input: { tokenHash: string; email: string; displayName: string; codeHash: string; ipHash: string },
  ): Promise<{ kind: 'code'; challengeId: string } | { kind: 'existing-user' } | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ challenge_id: string | null; existing_user: boolean }[]>`
        SELECT challenge_id::text, existing_user FROM app_rinse_preparer_begin(${input.tokenHash}, ${input.email}, ${input.displayName}, ${input.codeHash}, ${input.ipHash})`,
    );
    if (!row) return null;
    if (row.existing_user) return { kind: 'existing-user' };
    return row.challenge_id ? { kind: 'code', challengeId: row.challenge_id } : null;
  },

  async verify(prisma: PrismaClient, input: { email: string; codeHash: string }): Promise<PreparerSignedUp | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<
        { user_id: string; organization_id: string; session_id: string; session_expires_at: Date; binding_id: string | null; deal_id: string | null; binding_organization_id: string | null }[]
      >`SELECT user_id::text, organization_id::text, session_id::text, session_expires_at, binding_id::text, deal_id::text, binding_organization_id::text
          FROM app_rinse_preparer_verify(${input.email}, ${input.codeHash})`,
    );
    if (!row) return null;
    return {
      userId: row.user_id,
      organizationId: row.organization_id,
      session: { sessionId: row.session_id, subject: `pactlab|${row.user_id}`, expiresAt: new Date(row.session_expires_at) },
      binding: row.binding_id && row.deal_id && row.binding_organization_id ? { bindingId: row.binding_id, organizationId: row.binding_organization_id, dealId: row.deal_id } : null,
    };
  },

  async accept(prisma: PrismaClient, sessionId: string, tokenHash: string): Promise<{ bindingId: string; organizationId: string; dealId: string } | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ binding_id: string; organization_id: string; deal_id: string }[]>`
        SELECT binding_id::text, organization_id::text, deal_id::text FROM app_rinse_invite_accept(${sessionId}::uuid, ${tokenHash})`,
    );
    return row ? { bindingId: row.binding_id, organizationId: row.organization_id, dealId: row.deal_id } : null;
  },

  // bounded: app_rinse_bindings returns at most 100 live bindings
  async bindings(prisma: PrismaClient, sessionId: string): Promise<PreparerBinding[]> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ binding_id: string; organization_id: string; deal_id: string; pact_name: string; organization_name: string; bound_at: Date }[]>`
        SELECT binding_id::text, organization_id::text, deal_id::text, pact_name, organization_name, bound_at FROM app_rinse_bindings(${sessionId}::uuid)`,
    );
    return rows.map((row) => ({ bindingId: row.binding_id, organizationId: row.organization_id, dealId: row.deal_id, pactName: row.pact_name, organizationName: row.organization_name, boundAt: new Date(row.bound_at) }));
  },

  async runsToday(prisma: PrismaClient, sessionId: string): Promise<number> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ count: number }[]>`SELECT app_rinse_runs_today(${sessionId}::uuid) AS count`);
    return Number(row?.count ?? 0);
  },

  /** Record a job on the bound pact. False when the binding is not the caller's live one. */
  async recordRun(prisma: PrismaClient, sessionId: string, bindingId: string, run: unknown): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ count: number | null }[]>`SELECT app_rinse_record_run(${sessionId}::uuid, ${bindingId}::uuid, ${JSON.stringify(run)}::jsonb) AS count`,
    );
    return row?.count !== null && row?.count !== undefined;
  },

  /** Inside the pact's tenant transaction, whichever side syncs: is this binding live for the pact? */
  async bindingLive(tx: TransactionClient, dealId: string, bindingId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ live: boolean }[]>`SELECT app_rinse_binding_live(${dealId}::uuid, ${bindingId}::uuid) AS live`;
    return row?.live === true;
  },
};
