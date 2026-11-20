import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  DocuSignSigningProvider,
  DocuSignWebhook,
  restrictRecipients,
  SIGNING_PROVIDERS,
  SigningProviderError,
  SigningRecipientRefused,
  type DocuSignTokens,
  type EnvelopeRequest,
  type SigningProvider,
  type SigningProviderName,
  type SigningWebhook,
} from '@pactlab/connectors';
import { appendAuditEvent, signingOutcomes, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  ENVELOPE_STATUS_LABELS,
  newId,
  OPEN_ENVELOPE_STATUSES,
  permissionsForDealRole,
  SIGNING_CHOICES,
  type DealRole,
  type EnvelopeStatus,
  type SigningChoice,
  type SigningSettingsView,
  type SigningView,
  type TenantContext,
} from '@pactlab/domain';
import { CLOSE_DEPENDENCIES, type CloseDependencies } from '../close/close.dependencies';
import { DealAccess } from '../deals/deal-access';
import { DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from '../documents/documents.repository';
import { termSide } from '../pricing/pricing.service';
import { PRISMA } from '../tokens';

type Headers = Readonly<Record<string, string | string[] | undefined>>;
type Envelope = { id: string; organizationId: string; dealId: string; provider: string; providerEnvelopeId: string; status: string; loiId: string | null };
const canRead = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ');
const ARTIFACT_LABELS = { SIGNED_DOCUMENT: 'Signed document (PDF)', CERTIFICATE: 'Certificate of completion and audit trail (PDF)' } as const;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** What a new envelope goes out with, and why when it is not the organization's setting. */
export interface ChosenProvider {
  readonly provider: SigningProvider;
  readonly name: SigningProviderName;
}

/**
 * The document -> envelope service behind the signing seam (T-136, ADR 0036). Pact documents (the
 * letter of intent, an agreed terms version, and later others) are sent through `send`; the
 * organization's setting picks the provider for new envelopes; every envelope finishes on the
 * provider it went out with. Provider webhooks drive status, idempotently; the polling fallback
 * (`reconcile`, when a pact's signing state is read) catches a missed one. A completed envelope's
 * signed document and certificate are stored byte-for-byte as the pact's legal record.
 */
@Injectable()
export class SigningService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(CLOSE_DEPENDENCIES) private readonly deps: CloseDependencies,
    @Inject(DOCUMENT_OBJECT_STORE) private readonly documents: DocumentObjectStore,
  ) {}

  /** Outside the production go, every provider that leaves the process sends to test recipients only. */
  private guarded(provider: SigningProvider): SigningProvider {
    return this.deps.testRecipients && provider.name !== 'FIXTURE' ? restrictRecipients(provider, this.deps.testRecipients) : provider;
  }

  /** Pactlab signing for this deployment: BoldSign, or the fixture outside production. */
  private pactlab(): ChosenProvider | null {
    if (this.deps.pactlabSigning === 'BOLDSIGN' && this.deps.boldsign) return { provider: this.guarded(this.deps.boldsign.provider), name: 'BOLDSIGN' };
    if (this.deps.pactlabSigning === 'FIXTURE' && this.deps.fixtureSigning) return { provider: this.deps.fixtureSigning, name: 'FIXTURE' };
    return null;
  }

  /** The organization's own connected DocuSign (T-107), when Pactlab's registration is configured. */
  private async docusign(tx: TransactionClient, organizationId: string): Promise<ChosenProvider | null> {
    const { docusign, secrets } = this.deps;
    if (!docusign || !secrets) return null;
    const connection = await tx.organizationConnection.findFirst({ where: { organizationId, provider: 'docusign', disconnectedAt: null } });
    if (!connection) return null;
    const accessToken = async () => {
      const tokens = JSON.parse(await secrets.get(connection.credentialRef)) as DocuSignTokens;
      if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
      const refreshed = await docusign.oauth.refresh(tokens.refreshToken);
      await secrets.put(connection.credentialRef, JSON.stringify(refreshed));
      return refreshed.accessToken;
    };
    const provider = new DocuSignSigningProvider({ accountId: connection.accountId, accountName: connection.accountName, baseUri: connection.baseUri }, accessToken);
    return { provider: this.guarded(provider), name: 'DOCUSIGN' };
  }

  /** What new envelopes go out with now: the setting, or Pactlab signing when its own DocuSign is gone (said, never silent). */
  async forNewEnvelope(tx: TransactionClient, organizationId: string): Promise<{ chosen: ChosenProvider | null; note: string | null }> {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { signingProvider: true } });
    if (organization?.signingProvider === 'DOCUSIGN') {
      const own = await this.docusign(tx, organizationId);
      if (own) return { chosen: own, note: null };
      const fallback = this.pactlab();
      return { chosen: fallback, note: fallback ? 'Your DocuSign is not connected, so new envelopes go out with Pactlab signing. Reconnect it in Settings → Signing.' : 'Your DocuSign is not connected and Pactlab signing is not available here: reconnect DocuSign in Settings → Signing.' };
    }
    return { chosen: this.pactlab(), note: null };
  }

  /** The adapter an existing envelope finishes on: always the provider it was sent with. */
  private async forEnvelope(tx: TransactionClient | null, envelope: Envelope): Promise<SigningProvider | null> {
    switch (envelope.provider as SigningProviderName) {
      case 'BOLDSIGN':
        return this.deps.boldsign?.provider ?? null;
      case 'FIXTURE':
        return this.deps.fixtureSigning;
      case 'DOCUSIGN':
        return tx ? ((await this.docusign(tx, envelope.organizationId))?.provider ?? null) : null;
    }
  }

  /**
   * Send one pact document for signature: buyer's signatory first, then the seller's. Records the
   * envelope with the provider it went out with, and the first entry of its timeline.
   */
  async send(
    tx: TransactionClient,
    tenant: TenantContext,
    input: { dealId: string; batchId: string; loiId: string | null; documentSha256: string; agreementDocumentId?: string | null; buyerSignatory: string; sellerSignatory: string; request: EnvelopeRequest },
  ) {
    const { chosen } = await this.forNewEnvelope(tx, tenant.organizationId);
    if (!chosen) throw new UnprocessableEntityException({ code: 'ESIGN_UNAVAILABLE' });
    let envelopeId: string;
    try {
      ({ envelopeId } = await chosen.provider.createEnvelope(input.request));
    } catch (error) {
      if (error instanceof SigningRecipientRefused) throw new UnprocessableEntityException({ code: 'ESIGN_TEST_RECIPIENTS_ONLY', detail: 'This environment sends envelopes to test recipients only.' });
      if (error instanceof SigningProviderError) throw new ServiceUnavailableException({ code: error.kind === 'AUTH' ? 'ESIGN_RECONNECT' : 'ESIGN_UNAVAILABLE' });
      throw error;
    }
    const row = await tx.signatureEnvelope.create({
      data: {
        id: newId(),
        organizationId: tenant.organizationId,
        dealId: input.dealId,
        batchId: input.batchId,
        loiId: input.loiId,
        provider: chosen.name,
        providerEnvelopeId: envelopeId,
        termSheetSha256: input.documentSha256,
        agreementDocumentId: input.agreementDocumentId,
        buyerSignatory: input.buyerSignatory,
        sellerSignatory: input.sellerSignatory,
        sentBy: tenant.userId,
      },
    });
    await tx.signingEnvelopeEvent.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId: input.dealId, envelopeId: row.id, status: 'SENT', source: 'APP', providerEventId: 'app:sent' } });
    return row;
  }

  // --- Provider webhooks and polling --------------------------------------------------------

  private webhookFor(provider: SigningProviderName): SigningWebhook | null {
    if (provider === 'BOLDSIGN') return this.deps.boldsign?.webhook ?? null;
    if (provider === 'DOCUSIGN') return this.deps.docusign ? new DocuSignWebhook(this.deps.docusign.connectHmacKey) : null;
    return null;
  }

  /** A provider's webhook: verified on the raw body, recorded once however often it arrives. No session; the signature is the proof. */
  async webhook(provider: SigningProviderName, rawBody: Uint8Array, headers: Headers): Promise<{ recorded: boolean }> {
    const webhook = this.webhookFor(provider);
    // Not configured here: refused like a bad signature, revealing nothing.
    if (!webhook) throw new ForbiddenException();
    if (webhook.isPing(headers)) return { recorded: false };
    if (!webhook.verify(rawBody, headers)) throw new ForbiddenException();
    const event = webhook.parse(rawBody);
    if (!event || event.status === 'SENT') return { recorded: false };
    const changed = await signingOutcomes.observe(this.prisma, { provider, envelopeId: event.envelopeId, status: event.status, reason: event.reason, eventId: event.eventId, source: 'WEBHOOK' });
    if (changed?.status === 'COMPLETED' && provider !== 'DOCUSIGN') {
      // The organization's DocuSign token is read in the tenant's own session: its files are collected by `reconcile`.
      await this.collect(null, { id: changed.envelopeRowId, organizationId: changed.organizationId, dealId: changed.dealId, provider, providerEnvelopeId: event.envelopeId, status: 'COMPLETED', loiId: changed.loiId })
        // handled: the envelope shows "signed files pending" and reconcile retries when the pact is opened.
        .catch(() => undefined);
    }
    return { recorded: changed !== null };
  }

  /** Fixture signing settled an envelope in-process: recorded the way a webhook would be. */
  async fixtureSettled(envelopeId: string, status: EnvelopeStatus, reason: string | null) {
    if (status === 'SENT') return;
    const changed = await signingOutcomes.observe(this.prisma, { provider: 'FIXTURE', envelopeId, status, reason, eventId: `fixture:${status}`, source: 'WEBHOOK' });
    if (changed?.status === 'COMPLETED') await this.collect(null, { id: changed.envelopeRowId, organizationId: changed.organizationId, dealId: changed.dealId, provider: 'FIXTURE', providerEnvelopeId: envelopeId, status: 'COMPLETED', loiId: changed.loiId });
  }

  /** Store a completed envelope's signed document and certificate, once, byte-for-byte. */
  private async collect(tx: TransactionClient | null, envelope: Envelope): Promise<void> {
    const provider = await this.forEnvelope(tx, envelope);
    if (!provider) return;
    const artifacts = await provider.artifacts(envelope.providerEnvelopeId);
    for (const [kind, bytes] of [['SIGNED_DOCUMENT', artifacts.document], ['CERTIFICATE', artifacts.certificate]] as const) {
      const digest = sha256(bytes);
      const objectKey = `${envelope.organizationId}/${envelope.dealId}/signing/${envelope.id}/${kind === 'SIGNED_DOCUMENT' ? 'signed' : 'certificate'}.pdf`;
      // The store never overwrites: a second collection finds the first one's bytes in place.
      await this.documents.put(objectKey, bytes, { contentType: 'application/pdf', sha256: digest })
        // silent-ok: a concurrent collection stored these bytes first; the record below is written once either way.
        .catch(() => undefined);
      await signingOutcomes.artifact(this.prisma, { envelopeRowId: envelope.id, kind, objectKey, sha256: digest, sizeBytes: bytes.length });
    }
  }

  /**
   * The polling fallback: ask the provider about this pact's open envelopes (at most once per
   * interval each), and collect the signed files of completed ones that have none yet. Runs when a
   * pact's signing state is read; a missed webhook never leaves a pact in a silent state.
   */
  async reconcile(tenant: TenantContext, dealId: string): Promise<void> {
    const stale = new Date(Date.now() - this.deps.pollIntervalMs);
    const work = await withTenant(this.prisma, tenant, async (tx) => {
      // bounded: one pact's own envelopes (a few: one per letter or terms version sent)
      const envelopes = await tx.signatureEnvelope.findMany({
        where: { dealId, OR: [{ status: { in: [...OPEN_ENVELOPE_STATUSES] }, OR: [{ checkedAt: null }, { checkedAt: { lt: stale } }] }, { status: 'COMPLETED', artifacts: { none: {} } }] },
        select: { id: true, organizationId: true, dealId: true, provider: true, providerEnvelopeId: true, status: true, loiId: true },
      });
      const providers = new Map<string, SigningProvider | null>();
      for (const envelope of envelopes) providers.set(envelope.id, await this.forEnvelope(tx, envelope));
      return { envelopes, providers };
    });
    for (const envelope of work.envelopes) {
      const provider = work.providers.get(envelope.id);
      if (!provider) continue;
      try {
        if (envelope.status === 'COMPLETED') {
          // handled: a DocuSign failure is retried under the tenant; any other is caught below and retried on the next read.
          await this.collect(null, envelope).catch(async (error: unknown) => {
            // DocuSign's token is read under the tenant: retry there before giving up for now.
            if (envelope.provider !== 'DOCUSIGN') throw error;
            await withTenant(this.prisma, tenant, (tx) => this.collect(tx, envelope));
          });
          continue;
        }
        const state = await provider.status(envelope.providerEnvelopeId);
        const changed = await signingOutcomes.observe(this.prisma, { provider: envelope.provider as SigningProviderName, envelopeId: envelope.providerEnvelopeId, status: state.status, reason: state.reason, eventId: `poll:${state.status}`, source: 'POLL' });
        if (changed?.status === 'COMPLETED') await this.collect(null, envelope);
      } catch {
        // handled: the envelope keeps its last known status on the page, and the next read polls again.
      }
    }
  }

  // --- What the pact shows ------------------------------------------------------------------

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<SigningView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'signing.viewed', requestId });
    await this.reconcile(tenant, dealId);
    const side = termSide(role);
    return withTenant(this.prisma, tenant, async (tx) => {
      // bounded: one pact's own envelopes (a few: one per letter or terms version sent)
      const envelopes = await tx.signatureEnvelope.findMany({ where: { dealId }, orderBy: { sentAt: 'desc' }, include: { events: { orderBy: { receivedAt: 'asc' } }, artifacts: { orderBy: { kind: 'asc' } } } });
      const [batches, lois] = await Promise.all([
        // bounded: the versions the envelopes above name
        tx.termProposalBatch.findMany({ where: { id: { in: envelopes.map((row) => row.batchId) } }, select: { id: true, version: true } }),
        // bounded: the letters the envelopes above name
        tx.loiVersion.findMany({ where: { id: { in: envelopes.flatMap((row) => (row.loiId ? [row.loiId] : [])) } }, select: { id: true, version: true } }),
      ]);
      const version = (row: (typeof envelopes)[number]) => (row.loiId ? lois.find((loi) => loi.id === row.loiId)?.version : batches.find((batch) => batch.id === row.batchId)?.version) ?? 0;
      return {
        envelopes: envelopes.map((row) => {
          const status = row.status as EnvelopeStatus;
          const mine = side === 'BUYER' ? row.buyerSignatory === tenant.userId : side === 'SELLER' ? row.sellerSignatory === tenant.userId : false;
          const open = OPEN_ENVELOPE_STATUSES.includes(status);
          return {
            id: row.id,
            subject: row.loiId ? ('LOI' as const) : ('TERMS' as const),
            version: version(row),
            provider: SIGNING_PROVIDERS[row.provider as SigningProviderName]?.label ?? row.provider,
            status,
            statusLabel: ENVELOPE_STATUS_LABELS[status],
            reason: row.statusReason,
            sentAt: row.sentAt.toISOString(),
            timeline: row.events.map((event) => ({ status: event.status as EnvelopeStatus, label: ENVELOPE_STATUS_LABELS[event.status as EnvelopeStatus], reason: event.reason, source: event.source as 'APP' | 'WEBHOOK' | 'POLL', at: event.receivedAt.toISOString() })),
            artifacts: row.artifacts.map((artifact) => ({ kind: artifact.kind as 'SIGNED_DOCUMENT' | 'CERTIFICATE', label: ARTIFACT_LABELS[artifact.kind as 'SIGNED_DOCUMENT' | 'CERTIFICATE'], sha256: artifact.sha256, sizeBytes: artifact.sizeBytes, storedAt: artifact.storedAt.toISOString() })),
            artifactsPending: status === 'COMPLETED' && row.artifacts.length < 2,
            canSignEmbedded: open && mine && SIGNING_PROVIDERS[row.provider as SigningProviderName]?.embedded === true,
            canFixtureSign: open && mine && row.provider === 'FIXTURE' && this.deps.fixtureSigning !== null,
          };
        }),
      };
    });
  }

  /**
   * An embedded signing session for the caller, who must be this envelope's signatory for their
   * side and signed in to Pactlab (the guest's emailed code is their identity). Returns the
   * provider's short-lived link; it comes back to the pact when done.
   */
  async session(tenant: TenantContext, dealId: string, envelopeRowId: string, requestId: string): Promise<{ url: string }> {
    const role = await this.access.require(tenant, dealId, (r: DealRole) => termSide(r) !== null, { action: 'signing.session_opened', requestId });
    const { envelope, email, provider } = await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.signatureEnvelope.findFirst({ where: { id: envelopeRowId, dealId } });
      if (!row) throw new NotFoundException();
      if (!OPEN_ENVELOPE_STATUSES.includes(row.status as EnvelopeStatus)) throw new ConflictException({ code: 'ENVELOPE_NOT_OPEN' });
      if ((termSide(role) === 'BUYER' ? row.buyerSignatory : row.sellerSignatory) !== tenant.userId) throw new ForbiddenException('Only the named signatory signs');
      const me = await tx.user.findUnique({ where: { id: tenant.userId }, select: { email: true } });
      if (!me?.email) throw new ConflictException({ code: 'SIGNATORY_EMAIL_MISSING' });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'signing.session_opened', targetType: 'signature_envelope', targetId: row.id, outcome: 'SUCCEEDED', requestId });
      return { envelope: row, email: me.email, provider: await this.forEnvelope(tx, row) };
    });
    if (!provider) throw new ServiceUnavailableException({ code: 'ESIGN_UNAVAILABLE' });
    const back = new URL(`/deals/${dealId}/sign/${envelope.id}/done`, this.deps.appOrigin).toString();
    let url: string | null;
    try {
      url = await provider.embeddedSigningUrl(envelope.providerEnvelopeId, email, back);
    } catch (error) {
      if (error instanceof SigningProviderError && error.kind === 'REJECTED') throw new ConflictException({ code: 'ESIGN_NOT_YOUR_TURN', detail: 'The provider will not open a session for you yet: the buyer signs first.' });
      if (error instanceof SigningProviderError) throw new ServiceUnavailableException({ code: 'ESIGN_UNAVAILABLE' });
      throw error;
    }
    if (!url) throw new ConflictException({ code: 'ESIGN_NOT_EMBEDDED', detail: 'This envelope is signed from the provider’s own email.' });
    return { url };
  }

  /** A stored signed file, re-checked against its recorded digest: what was signed, byte-for-byte. */
  async artifact(tenant: TenantContext, dealId: string, envelopeRowId: string, kind: 'SIGNED_DOCUMENT' | 'CERTIFICATE', requestId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    await this.access.require(tenant, dealId, canRead, { action: 'signing.artifact_downloaded', requestId });
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      const found = await tx.signingArtifact.findFirst({ where: { envelopeId: envelopeRowId, dealId, kind } });
      if (found) await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'signing.artifact_downloaded', targetType: 'signing_artifact', targetId: found.id, outcome: 'SUCCEEDED', requestId });
      return found;
    });
    if (!row) throw new NotFoundException();
    const bytes = await this.documents.get(row.objectKey);
    if (sha256(bytes) !== row.sha256) throw new ConflictException({ code: 'ARTIFACT_INTEGRITY', detail: 'The stored file does not match what was signed; it was not served.' });
    return { bytes, fileName: kind === 'SIGNED_DOCUMENT' ? 'Signed document.pdf' : 'Certificate of completion.pdf' };
  }

  // --- Settings → Signing (owners and admins) -------------------------------------------------

  private canEdit(tenant: TenantContext) {
    return tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN';
  }

  async settings(tenant: TenantContext): Promise<SigningSettingsView> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { signingProvider: true } });
      const own = await this.docusign(tx, tenant.organizationId);
      const pactlab = this.pactlab();
      const { chosen, note } = await this.forNewEnvelope(tx, tenant.organizationId);
      const docusignReason = !this.deps.docusign ? 'DocuSign is not available on this deployment.' : !own ? 'Connect your organization’s DocuSign account first (Settings → DocuSign).' : null;
      return {
        current: (organization?.signingProvider ?? 'PACTLAB') as SigningChoice,
        effective: { provider: chosen ? SIGNING_PROVIDERS[chosen.name].label : null, note: note ?? (chosen ? null : 'No signing provider is available here; letters and terms are signed in Pactlab instead.') },
        options: (Object.keys(SIGNING_CHOICES) as SigningChoice[]).map((choice) => ({
          choice,
          label: SIGNING_CHOICES[choice].label,
          detail: SIGNING_CHOICES[choice].detail,
          available: choice === 'PACTLAB' ? pactlab !== null : own !== null,
          unavailableReason: choice === 'PACTLAB' ? (pactlab ? null : 'Pactlab signing is not configured on this deployment.') : docusignReason,
        })),
        canEdit: this.canEdit(tenant),
      };
    });
  }

  /** New envelopes only: those in flight finish on their own provider. Audited. */
  async choose(tenant: TenantContext, choice: SigningChoice, requestId: string): Promise<SigningSettingsView> {
    if (!this.canEdit(tenant)) throw new ForbiddenException();
    await withTenant(this.prisma, tenant, async (tx) => {
      if (choice === 'DOCUSIGN' && !(await this.docusign(tx, tenant.organizationId))) throw new UnprocessableEntityException({ code: 'DOCUSIGN_NOT_CONNECTED' });
      const { count } = await tx.organization.updateMany({ where: { id: tenant.organizationId }, data: { signingProvider: choice } });
      // Row security admits owners and admins only; anyone else changes nothing.
      if (count !== 1) throw new ForbiddenException();
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId: null, actorUserId: tenant.userId, action: 'organization.signing_provider_changed', targetType: 'organization', targetId: tenant.organizationId, outcome: 'SUCCEEDED', requestId });
    });
    return this.settings(tenant);
  }
}
