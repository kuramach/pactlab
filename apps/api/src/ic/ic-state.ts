import type { TransactionClient } from '@pactlab/db';

export type IcState = 'NONE' | 'SUBMITTED' | 'APPROVED' | 'CONDITIONS_OPEN' | 'DECLINED';

export const IC_STATE_LABELS: Readonly<Record<IcState, string>> = {
  NONE: 'not submitted',
  SUBMITTED: 'awaiting the committee',
  APPROVED: 'approved',
  CONDITIONS_OPEN: 'approved, conditions open',
  DECLINED: 'declined',
};

/**
 * Where a pact stands with its investment committee (T-118), derived from the record, never
 * stored twice: the latest submission and its decision. With conditions, it is approved once
 * every condition is addressed — or cleared by the committee, when the organization asks for that.
 * Reads under the caller's RLS: the seller's side sees no record, so this is for the own side only.
 */
export async function icStatus(tx: TransactionClient, organizationId: string, dealId: string): Promise<{ required: boolean; state: IcState; satisfied: boolean; clearsConditions: boolean }> {
  const [deal, organization, latest] = await Promise.all([
    tx.deal.findUnique({ where: { id: dealId }, select: { icApprovalRequired: true } }),
    tx.organization.findUnique({ where: { id: organizationId }, select: { icApprovalRequired: true, icClearsConditions: true } }),
    tx.icSubmission.findFirst({ where: { dealId }, orderBy: { submittedAt: 'desc' } }),
  ]);
  const required = deal?.icApprovalRequired ?? organization?.icApprovalRequired ?? false;
  const clearsConditions = organization?.icClearsConditions ?? false;
  let state: IcState = 'NONE';
  if (latest) {
    const decision = await tx.icDecision.findUnique({ where: { submissionId: latest.id } });
    if (!decision) state = 'SUBMITTED';
    else if (decision.decision === 'DECLINE') state = 'DECLINED';
    else if (decision.decision === 'APPROVE') state = 'APPROVED';
    else {
      const open = await tx.icCondition.count({ where: { decisionId: decision.id, status: { in: clearsConditions ? ['OPEN', 'ADDRESSED'] : ['OPEN'] } } });
      state = open > 0 ? 'CONDITIONS_OPEN' : 'APPROVED';
    }
  }
  return { required, state, satisfied: !required || state === 'APPROVED', clearsConditions };
}
