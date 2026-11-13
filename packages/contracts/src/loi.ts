/** A letter of intent on a pact (T-119, ADR 0030). */
export type LoiStatusView = 'DRAFT' | 'SENT' | 'COUNTERSIGNED' | 'DECLINED' | 'EXPIRED';

export interface LoiFieldsView {
  exclusivityDays: number;
  governingLaw: string;
  expenses: string;
  diligenceDays: number;
  targetSigningDate: string | null;
  responseDays: number;
  conditions: readonly string[];
}

export interface LoiSectionView {
  heading: string;
  lines: readonly string[];
}

export interface LoiContentView {
  title: string;
  parties: string;
  nonBinding: readonly LoiSectionView[];
  binding: readonly LoiSectionView[];
  signatureNote: string;
  notice: string;
  unfilled: readonly string[];
}

export interface LoiView {
  required: boolean;
  /** The agreed terms version a new letter would quote; null until terms are agreed. */
  agreedTermsVersion: number | null;
  canDraft: boolean;
  canSetRequirement: boolean;
  signatories: { BUYER: string | null; SELLER: string | null };
  exclusivity: { endsAt: string; daysLeft: number; ended: boolean } | null;
  current: {
    id: string;
    version: number;
    status: LoiStatusView;
    termsBatchId: string;
    fields: LoiFieldsView;
    content: LoiContentView;
    method: 'IN_APP' | 'ESIGN' | null;
    sentAt: string | null;
    respondBy: string | null;
    signedBy: { BUYER: string | null; SELLER: string | null };
    canEdit: boolean;
    canSend: boolean;
    canSign: boolean;
    canDecline: boolean;
    canFixtureSign: boolean;
    hasPdf: boolean;
  } | null;
  versions: { id: string; version: number; status: LoiStatusView; sentAt: string | null; countersignedAt: string | null; hasPdf: boolean }[];
}
