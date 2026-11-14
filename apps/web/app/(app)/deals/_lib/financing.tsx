import type { FinancingPlanView, FinancingPostureView, TrancheKindView, TrancheStatusView } from '@pactlab/contracts';
import { Badge } from '@pactlab/ui';

/** Buyer financing (T-117): the labels and the read-only summary both sides see. */
export const TRANCHE_KIND_LABELS: Readonly<Record<TrancheKindView, string>> = {
  CASH: 'Cash',
  SBA_7A: 'SBA 7(a) loan',
  CONVENTIONAL_DEBT: 'Conventional debt',
  SELLER_NOTE: 'Seller note',
  ROLLOVER_EQUITY: 'Rollover equity',
  OTHER: 'Other',
};
export const TRANCHE_STATUS_LABELS: Readonly<Record<TrancheStatusView, string>> = {
  NOT_STARTED: 'Not started',
  EXPLORING: 'Exploring',
  PRE_QUALIFIED: 'Pre-qualified',
  APPLICATION_SUBMITTED: 'Application submitted',
  COMMITMENT_ISSUED: 'Commitment issued',
  CLEARED_TO_CLOSE: 'Cleared to close',
};
export const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  PROOF_OF_FUNDS: 'Proof of funds',
  PRE_QUALIFICATION: 'Lender pre-qualification',
  COMMITMENT_LETTER: 'Commitment letter',
  SBA_PRE_QUALIFICATION: 'SBA pre-qualification',
  ESCROW_RECEIPT: 'Escrow receipt',
  BUYER_FINANCIALS: 'Buyer financials (keep private)',
  OTHER: 'Other',
};

const LEVEL: Record<FinancingPostureView['level'], 'neutral' | 'draft' | 'calculation' | 'reviewed' | 'danger'> = {
  NONE: 'neutral',
  EARLY: 'draft',
  IN_PROGRESS: 'draft',
  COMMITTED: 'calculation',
  CLEARED: 'reviewed',
};

export const money = (amount: string, currency: string) => {
  const [whole = '0', fraction = ''] = amount.split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(fraction + '00').slice(0, 2)}`;
};

/** The posture in one line: what a seller asks first. Buyer-provided, and labelled so. */
export function FinancingPosture({ posture, compact = false }: { posture: FinancingPostureView; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={LEVEL[posture.level]}>{posture.headline}</Badge>
        {posture.escrow ? <span className="text-slate-text">{posture.escrow}</span> : null}
        <span className="text-xs text-muted-foreground">Buyer-provided</span>
      </p>
      {!compact && posture.coverage.against ? (
        <p className="text-sm text-slate-text">
          Covers {money(posture.coverage.total, posture.coverage.currency)} of the {posture.coverage.against.agreed ? 'agreed' : 'proposed'} price of {money(posture.coverage.against.price, posture.coverage.currency)}
          {posture.coverage.against.state === 'UNDER' ? `, ${money(posture.coverage.against.gap, posture.coverage.currency)} short` : posture.coverage.against.state === 'OVER' ? `, ${money(posture.coverage.against.gap, posture.coverage.currency)} over` : ''}.
        </p>
      ) : null}
      {!compact
        ? posture.blockers.map((blocker) => (
            <p key={blocker} role="note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-950">
              {blocker}
            </p>
          ))
        : null}
    </div>
  );
}

/** The plan's sources of funds, read-only: kind, amount, status and whether a visible document backs it. */
export function TrancheTable({ plan }: { plan: FinancingPlanView }) {
  if (plan.tranches.length === 0) return <p className="text-sm text-muted-foreground">No sources of funds yet.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2 pr-4">Source</th>
          <th className="py-2 pr-4 text-right">Amount</th>
          <th className="py-2 pr-4">Status</th>
          <th className="py-2">Backing</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {plan.tranches.map((tranche) => (
          <tr key={tranche.id}>
            <td className="py-2 pr-4 font-medium">
              {TRANCHE_KIND_LABELS[tranche.kind]}
              {tranche.label ? <span className="block text-xs font-normal text-muted-foreground">{tranche.label}</span> : null}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums">{money(tranche.amount, tranche.currency)}</td>
            <td className="py-2 pr-4">{TRANCHE_STATUS_LABELS[tranche.status]}</td>
            <td className="py-2">
              {tranche.documented ? <Badge variant="reviewed">Document-backed</Badge> : tranche.needsDocument ? <Badge variant="draft">Attested, no document</Badge> : <span className="text-muted-foreground">Attested</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
