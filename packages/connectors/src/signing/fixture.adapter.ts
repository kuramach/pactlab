import { randomUUID } from 'node:crypto';
import type { EnvelopeRequest, EnvelopeState, SignedArtifacts, SigningProvider } from './types';

interface FixtureEnvelope {
  readonly signers: readonly string[];
  readonly document: Uint8Array;
  readonly signed: Set<string>;
  state: EnvelopeState;
}

/**
 * The fixture signing provider (dev, demos, tests). An envelope completes once every signer has
 * signed through `sign`; `decline` and `expire` settle it the other ways. Nothing leaves the
 * process. State is in memory: a restart forgets fixture envelopes, which only ever hold demo data.
 */
export class FixtureSigningProvider implements SigningProvider {
  readonly name = 'FIXTURE' as const;
  private readonly envelopes = new Map<string, FixtureEnvelope>();

  async createEnvelope(request: EnvelopeRequest): Promise<{ envelopeId: string }> {
    const [first] = request.documents;
    if (!first || request.signers.length === 0) throw new Error('An envelope needs a document and a signer');
    const envelopeId = `fixture-${randomUUID()}`;
    this.envelopes.set(envelopeId, { signers: request.signers.map((signer) => signer.email.toLowerCase()), document: first.bytes, signed: new Set(), state: { status: 'SENT', reason: null } });
    return { envelopeId };
  }

  private open(envelopeId: string): FixtureEnvelope {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope || (envelope.state.status !== 'SENT' && envelope.state.status !== 'DELIVERED')) throw new Error('Not an open fixture envelope');
    return envelope;
  }

  async status(envelopeId: string): Promise<EnvelopeState> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope) throw new Error('Unknown fixture envelope');
    return envelope.state;
  }

  /** The fixture has no embedded session: its signers sign in Pactlab's own test screen. */
  async embeddedSigningUrl(): Promise<string | null> {
    return null;
  }

  async artifacts(envelopeId: string): Promise<SignedArtifacts> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope || envelope.state.status !== 'COMPLETED') throw new Error('Not a completed fixture envelope');
    const certificate = new TextEncoder().encode(`%PDF-1.4\n% Fixture certificate of completion (synthetic)\n% envelope ${envelopeId}\n% signed by ${[...envelope.signed].length} signers\n%%EOF\n`);
    return { document: envelope.document, certificate };
  }

  /** One signer signs; returns the envelope's status afterwards. */
  sign(envelopeId: string, email: string): EnvelopeState['status'] {
    const envelope = this.open(envelopeId);
    if (!envelope.signers.includes(email.toLowerCase())) throw new Error('Not a signer on this envelope');
    envelope.signed.add(email.toLowerCase());
    envelope.state = { status: envelope.signers.every((signer) => envelope.signed.has(signer)) ? 'COMPLETED' : 'DELIVERED', reason: null };
    return envelope.state.status;
  }

  decline(envelopeId: string, reason: string): void {
    this.open(envelopeId).state = { status: 'DECLINED', reason };
  }

  expire(envelopeId: string): void {
    this.open(envelopeId).state = { status: 'EXPIRED', reason: null };
  }

  /** Who has signed so far (for the fixture's own "sign" screen). */
  signedBy(envelopeId: string): string[] {
    return [...(this.envelopes.get(envelopeId)?.signed ?? [])];
  }
}
