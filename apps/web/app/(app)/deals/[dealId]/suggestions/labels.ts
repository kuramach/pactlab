/** A connected app's suggestion as the API returns it (T-084b). */
export interface SuggestionView {
  readonly id: string;
  readonly kind: 'TERM' | 'DOCUMENT_REQUEST';
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'WITHDRAWN';
  readonly rationale: string;
  readonly clientName: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly problem: string | null;
  readonly detail:
    | { readonly kind: 'TERM'; readonly findingId: string; readonly findingTitle: string; readonly lever: keyof typeof LEVER_LABELS; readonly amount: { amount: string; currency: string } | null }
    | { readonly kind: 'DOCUMENT_REQUEST'; readonly items: readonly { id: string; label: string }[]; readonly note: string | null }
    | null;
}

export const LEVER_LABELS = {
  PRICE_REDUCTION: 'Price reduction',
  REMEDIATION_COST: 'Remediation cost',
  ESCROW: 'Escrow',
  INDEMNITY: 'Indemnity',
} as const;

export const STATUS_LOOK: Record<SuggestionView['status'], { label: string; variant: 'neutral' | 'draft' | 'calculation' | 'danger' }> = {
  PENDING: { label: 'Waiting for you', variant: 'draft' },
  FAILED: { label: 'Not carried out', variant: 'danger' },
  APPROVED: { label: 'Approved', variant: 'calculation' },
  REJECTED: { label: 'Rejected', variant: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'neutral' },
};
