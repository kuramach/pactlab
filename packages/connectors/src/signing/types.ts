/**
 * The signing-provider seam (T-136, ADR 0036; first built for T-107, ADR 0022). Every adapter
 * implements this one contract and passes the same contract tests (`contract.ts`); pact and domain
 * code see only these types, never a provider's own. Which adapter sends a new envelope is a setting
 * (per organization), and an envelope finishes on the provider it was sent with.
 */
import type { EnvelopeStatus } from '@pactlab/domain';

export type { EnvelopeStatus };
export type SigningProviderName = 'FIXTURE' | 'DOCUSIGN' | 'BOLDSIGN';
export const SETTLED_STATUSES: readonly EnvelopeStatus[] = ['COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED'];

/** What each provider is, for the settings screen and for the service choosing one. */
export const SIGNING_PROVIDERS = {
  FIXTURE: { label: 'Test signing (no provider)', embedded: false, account: 'PACTLAB' },
  BOLDSIGN: { label: 'Pactlab signing', embedded: true, account: 'PACTLAB' },
  DOCUSIGN: { label: 'Your DocuSign', embedded: false, account: 'ORGANIZATION' },
} as const satisfies Record<SigningProviderName, { label: string; embedded: boolean; account: 'PACTLAB' | 'ORGANIZATION' }>;

/**
 * The text printed (in white) in a document where signer `order` (1-based) signs. One marker for
 * every adapter: anchor-based providers search for it, tag-based providers read it as their text
 * tag, so documents never carry a provider of their own.
 */
export function signHereMarker(order: number): string {
  if (!Number.isInteger(order) || order < 1 || order > 9) throw new Error('signer order must be 1 to 9');
  return `{{sign|${order}|*}}`;
}

export interface SigningDocument {
  readonly name: string;
  readonly fileExtension: 'pdf';
  readonly bytes: Uint8Array;
}

export interface SigningSigner {
  readonly email: string;
  readonly name: string;
  /** Text printed in the document where this signer signs (`signHereMarker(order)`). */
  readonly anchor: string;
}

export interface EnvelopeRequest {
  readonly emailSubject: string;
  readonly documents: readonly SigningDocument[];
  /** In signing order: buyer first, then seller. */
  readonly signers: readonly SigningSigner[];
  /** Days until the provider expires it unsigned; absent: the provider's default. */
  readonly expiresInDays?: number;
}

export interface EnvelopeState {
  readonly status: EnvelopeStatus;
  /** The provider's reason for a decline, expiry or void, where it gives one. */
  readonly reason: string | null;
}

/** A completed envelope's legal record, byte-for-byte as the provider returns it. */
export interface SignedArtifacts {
  /** The signed document (all documents combined, as signed). */
  readonly document: Uint8Array;
  /** The certificate of completion / audit trail. */
  readonly certificate: Uint8Array;
}

export interface SigningProvider {
  readonly name: SigningProviderName;
  createEnvelope(request: EnvelopeRequest): Promise<{ envelopeId: string }>;
  /** The polling fallback: the envelope's current state at the provider. */
  status(envelopeId: string): Promise<EnvelopeState>;
  /**
   * A short-lived link to an embedded signing session for one signer, returning to `returnUrl`.
   * Null when the provider has no embedded session (the signer signs from the provider's email).
   */
  embeddedSigningUrl(envelopeId: string, signerEmail: string, returnUrl: string): Promise<string | null>;
  /** The signed document and certificate of a COMPLETED envelope. */
  artifacts(envelopeId: string): Promise<SignedArtifacts>;
}

/** A provider event, verified, reduced to what Pactlab records. */
export interface SigningEvent {
  /** Unique per provider event: the deduplication key for repeated deliveries. */
  readonly eventId: string;
  readonly envelopeId: string;
  readonly status: EnvelopeStatus;
  readonly reason: string | null;
}

/** How a provider's webhooks are verified and read. */
export interface SigningWebhook {
  readonly provider: SigningProviderName;
  /** True when the raw body carries the provider's valid signature under this deployment's secret. */
  verify(rawBody: Uint8Array, headers: Readonly<Record<string, string | string[] | undefined>>, nowMs?: number): boolean;
  /** A provider's endpoint check, answered 200 without recording anything. */
  isPing(headers: Readonly<Record<string, string | string[] | undefined>>): boolean;
  /** The event as Pactlab records it; null for events Pactlab does not record. */
  parse(rawBody: Uint8Array): SigningEvent | null;
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

/** A recipient outside this environment's test recipients was refused before any provider call. */
export class SigningRecipientRefused extends SigningProviderError {
  constructor() {
    super('Only test recipients may be sent envelopes from this environment', 'REJECTED');
    this.name = 'SigningRecipientRefused';
  }
}

/** One header's value, whatever shape the framework gave it. */
export function headerValue(headers: Readonly<Record<string, string | string[] | undefined>>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

/**
 * Non-live sending (T-136 item 7): outside the production go, every envelope goes only to test
 * recipients — listed addresses or `@domain`s. Any other recipient is refused before the provider
 * is called, whichever adapter sends.
 */
export function restrictRecipients(provider: SigningProvider, allowed: readonly string[]): SigningProvider {
  const rules = allowed.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const permitted = (email: string) => {
    const address = email.trim().toLowerCase();
    return rules.some((rule) => (rule.startsWith('@') ? address.endsWith(rule) : address === rule));
  };
  return {
    name: provider.name,
    createEnvelope: async (request) => {
      if (rules.length === 0 || !request.signers.every((signer) => permitted(signer.email))) {
        throw new SigningRecipientRefused();
      }
      return provider.createEnvelope(request);
    },
    status: (envelopeId) => provider.status(envelopeId),
    embeddedSigningUrl: (envelopeId, signerEmail, returnUrl) => provider.embeddedSigningUrl(envelopeId, signerEmail, returnUrl),
    artifacts: (envelopeId) => provider.artifacts(envelopeId),
  };
}
