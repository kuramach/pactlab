import { randomUUID } from 'node:crypto';
import type { EnvelopeRequest, EnvelopeStatus, SigningProvider } from './types';

/**
 * The fixture signing provider (dev, demos, tests). An envelope completes once
 * every signer has signed through `sign`; nothing leaves the process. State is
 * in memory: a restart forgets fixture envelopes, which only ever hold demo data.
 */
export class FixtureSigningProvider implements SigningProvider {
  readonly name = 'FIXTURE' as const;
  private readonly envelopes = new Map<string, { signers: string[]; signed: Set<string>; status: EnvelopeStatus }>();

  async createEnvelope(request: EnvelopeRequest): Promise<{ envelopeId: string }> {
    if (request.documents.length === 0 || request.signers.length === 0) throw new Error('An envelope needs a document and a signer');
    const envelopeId = `fixture-${randomUUID()}`;
    this.envelopes.set(envelopeId, { signers: request.signers.map((signer) => signer.email.toLowerCase()), signed: new Set(), status: 'SENT' });
    return { envelopeId };
  }

  async status(envelopeId: string): Promise<EnvelopeStatus> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope) throw new Error('Unknown fixture envelope');
    return envelope.status;
  }

  /** One signer signs; returns the envelope's status afterwards. */
  sign(envelopeId: string, email: string): EnvelopeStatus {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope || envelope.status !== 'SENT') throw new Error('Not an open fixture envelope');
    if (!envelope.signers.includes(email.toLowerCase())) throw new Error('Not a signer on this envelope');
    envelope.signed.add(email.toLowerCase());
    if (envelope.signers.every((signer) => envelope.signed.has(signer))) envelope.status = 'COMPLETED';
    return envelope.status;
  }

  /** Who has signed so far (for the fixture's own "sign" screen). */
  signedBy(envelopeId: string): string[] {
    return [...(this.envelopes.get(envelopeId)?.signed ?? [])];
  }
}
