/**
 * E-signature (T-107, ADR 0022). Pactlab owns no sending account: envelopes go
 * out from the pact creator's own provider account. Adapters share this
 * contract; the fixture runs dev, demos and every test.
 */
export type SigningProviderName = 'FIXTURE' | 'DOCUSIGN';
export type EnvelopeStatus = 'SENT' | 'COMPLETED' | 'DECLINED' | 'VOIDED';

export interface SigningDocument {
  readonly name: string;
  readonly fileExtension: 'pdf';
  readonly bytes: Uint8Array;
}

export interface SigningSigner {
  readonly email: string;
  readonly name: string;
  /** Text printed in the document where this signer signs. */
  readonly anchor: string;
}

export interface EnvelopeRequest {
  readonly emailSubject: string;
  readonly documents: readonly SigningDocument[];
  /** Buyer first, then seller. */
  readonly signers: readonly SigningSigner[];
}

export interface SigningProvider {
  readonly name: SigningProviderName;
  createEnvelope(request: EnvelopeRequest): Promise<{ envelopeId: string }>;
  status(envelopeId: string): Promise<EnvelopeStatus>;
}

/** A provider event, verified, reduced to what Pactlab records. */
export interface SigningEvent {
  readonly envelopeId: string;
  readonly status: EnvelopeStatus;
}

export class SigningProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'AUTH' | 'REJECTED' | 'UNAVAILABLE',
  ) {
    super(message);
    this.name = 'SigningProviderError';
  }
}
