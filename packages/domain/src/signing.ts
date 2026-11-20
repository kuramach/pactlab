/**
 * In-workflow signing (T-136, ADR 0036), as pact code sees it: provider-neutral. The provider an
 * envelope went out with is a name; its status, timeline and signed files are the same shape for
 * every adapter.
 */

/** SENT -> DELIVERED (opened) -> one settled status. "Signed" is COMPLETED: every signer has signed. */
export type EnvelopeStatus = 'SENT' | 'DELIVERED' | 'COMPLETED' | 'DECLINED' | 'EXPIRED' | 'VOIDED';

export const ENVELOPE_STATUS_LABELS = {
  SENT: 'Sent for signature',
  DELIVERED: 'Opened by a signer',
  COMPLETED: 'Signed by both sides',
  DECLINED: 'Declined',
  EXPIRED: 'Expired unsigned',
  VOIDED: 'Voided',
} as const satisfies Record<EnvelopeStatus, string>;

export const OPEN_ENVELOPE_STATUSES: readonly EnvelopeStatus[] = ['SENT', 'DELIVERED'];

/** What an organization signs new envelopes with (Settings → Signing; owners and admins). */
export type SigningChoice = 'PACTLAB' | 'DOCUSIGN';

export const SIGNING_CHOICES = {
  PACTLAB: { label: 'Pactlab signing', detail: 'Pactlab’s own signing account: nothing to set up. Signers sign inside Pactlab.' },
  DOCUSIGN: { label: 'Your DocuSign', detail: 'Envelopes go out from your organization’s connected DocuSign account; signers sign from DocuSign’s email.' },
} as const satisfies Record<SigningChoice, { label: string; detail: string }>;

/** What a pact's signed document is. */
export type SigningSubject = 'LOI' | 'TERMS';

export interface SigningEnvelopeView {
  readonly id: string;
  readonly subject: SigningSubject;
  /** The letter of intent or agreed terms version it carries. */
  readonly version: number;
  /** The provider it was sent with (and finishes on), as a label. */
  readonly provider: string;
  readonly status: EnvelopeStatus;
  readonly statusLabel: string;
  readonly reason: string | null;
  readonly sentAt: string;
  readonly timeline: readonly { readonly status: EnvelopeStatus; readonly label: string; readonly reason: string | null; readonly source: 'APP' | 'WEBHOOK' | 'POLL'; readonly at: string }[];
  readonly artifacts: readonly { readonly kind: 'SIGNED_DOCUMENT' | 'CERTIFICATE'; readonly label: string; readonly sha256: string; readonly sizeBytes: number; readonly storedAt: string }[];
  /** Completed, but the signed files are not stored yet (Pactlab retries when the pact is opened). */
  readonly artifactsPending: boolean;
  /** The caller is a signatory on this open envelope and may open an embedded signing session now. */
  readonly canSignEmbedded: boolean;
  /** The caller may sign in Pactlab's test signing screen (fixture envelopes, outside production). */
  readonly canFixtureSign: boolean;
}

export interface SigningView {
  readonly envelopes: readonly SigningEnvelopeView[];
}

export interface SigningSettingsView {
  readonly current: SigningChoice;
  /** What new envelopes go out with now, and why when it differs from the setting. */
  readonly effective: { readonly provider: string | null; readonly note: string | null };
  readonly options: readonly { readonly choice: SigningChoice; readonly label: string; readonly detail: string; readonly available: boolean; readonly unavailableReason: string | null }[];
  readonly canEdit: boolean;
}
