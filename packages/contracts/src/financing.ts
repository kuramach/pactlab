/** Buyer financing (T-117, ADR 0033): what the buyer and the seller each see. */
export type TrancheKindView = 'CASH' | 'SBA_7A' | 'CONVENTIONAL_DEBT' | 'SELLER_NOTE' | 'ROLLOVER_EQUITY' | 'OTHER';
export type TrancheStatusView = 'NOT_STARTED' | 'EXPLORING' | 'PRE_QUALIFIED' | 'APPLICATION_SUBMITTED' | 'COMMITMENT_ISSUED' | 'CLEARED_TO_CLOSE';
export type EscrowStatusView = 'NOT_COMMITTED' | 'COMMITTED' | 'DEPOSITED' | 'APPLIED_AT_CLOSE' | 'RELEASED_TO_SELLER' | 'REFUNDED_TO_BUYER';
export type FinancingPurposeView = 'PROOF_OF_FUNDS' | 'PRE_QUALIFICATION' | 'COMMITMENT_LETTER' | 'SBA_PRE_QUALIFICATION' | 'ESCROW_RECEIPT' | 'BUYER_FINANCIALS' | 'OTHER';

export interface FinancingDocumentView {
  id: string;
  purpose: FinancingPurposeView;
  fileName: string;
  trancheId: string | null;
  uploadedAt: string;
  /** Shared with the seller (the seller only ever sees shared ones). */
  shared: boolean;
}

export interface FinancingTrancheView {
  id: string;
  kind: TrancheKindView;
  amount: string;
  currency: string;
  status: TrancheStatusView;
  label: string;
  /** Buyer only. */
  buyerNote: string | null;
  /** From pre-qualification up, the status should be backed by a document. */
  needsDocument: boolean;
  /** Backed by a document the reader can see (for the seller: a shared one). */
  documented: boolean;
}

export interface FinancingEscrowView {
  amount: string;
  currency: string;
  holderKind: 'TITLE_COMPANY' | 'ATTORNEY' | 'BROKER' | 'OTHER';
  holderName: string;
  depositDueOn: string | null;
  hardOn: string | null;
  refundConditions: string;
  status: EscrowStatusView;
  deposit: { on: string; reference: string; proofDocumentId: string | null } | null;
  confirmed: boolean;
  dispute: { note: string; at: string } | null;
}

export interface FinancingPostureView {
  level: 'NONE' | 'EARLY' | 'IN_PROGRESS' | 'COMMITTED' | 'CLEARED';
  headline: string;
  escrow: string | null;
  coverage: { total: string; firm: string; currency: string; against: { price: string; agreed: boolean; state: 'UNDER' | 'EXACT' | 'OVER'; gap: string } | null; otherCurrencies: readonly string[] };
  blockers: readonly string[];
}

export interface FinancingPlanView {
  id: string | null;
  /** Seller-led pacts: the bid this plan is for, and the bidding firm. */
  bidId: string | null;
  firmName: string | null;
  commitmentExpectedBy: string | null;
  /** Buyer only. */
  buyerNote: string | null;
  tranches: readonly FinancingTrancheView[];
  escrow: FinancingEscrowView | null;
  documents: readonly FinancingDocumentView[];
  posture: FinancingPostureView;
}

export interface FinancingView {
  /** BUYER: the reader maintains the plan; SELLER: the reader sees each buyer's plan, as attested. */
  side: 'BUYER' | 'SELLER' | null;
  canEdit: boolean;
  plans: readonly FinancingPlanView[];
}
