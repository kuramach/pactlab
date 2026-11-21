import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DOCUMENT_SOURCE_LABELS,
  DocumentSourceError,
  documentSourceAdapter,
  MAX_SOURCE_FILES,
  MAX_SOURCE_READS,
  type DocumentSourceProvider,
  type SourceFile,
} from '@pactlab/connectors';
import { appendAuditEvent, withTenant, type AuditEventInput, type PrismaClient } from '@pactlab/db';
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { PROVIDER_DEPENDENCIES, type ProviderDependencies } from '../connections/provider-dependencies';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';
import { DocumentConnectionsService } from './document-connections.service';
import type { ConnectDocumentSourceBody } from './documents.schemas';
import { DocumentsService } from './documents.service';
import { DOCX_CONTENT_TYPE, XLSX_CONTENT_TYPE, type AcceptedContentType } from './documents.types';

/** Buyers who may add documents read them from a source; sources are buyer-side configuration. */
const canManage = (role: DealRole) => {
  const permissions = permissionsForDealRole(role);
  return permissions.has('DEAL_WRITE') && permissions.has('BUYER_ANALYSIS_READ');
};

const CONTENT_TYPES: Readonly<Record<string, AcceptedContentType>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  pdf: 'application/pdf',
  docx: DOCX_CONTENT_TYPE,
  xlsx: XLSX_CONTENT_TYPE,
};
const contentTypeOf = (name: string) => CONTENT_TYPES[(name.split('.').pop() ?? '').toLowerCase()];

/** WAITING: new or changed, left for the next sync (at most MAX_SOURCE_READS are read per sync; T-126). */
export type SourceFileOutcome = 'NEW' | 'UPDATED' | 'UNCHANGED' | 'DUPLICATE' | 'REMOVED' | 'SKIPPED' | 'REJECTED' | 'WAITING';

export interface SourceSyncFile {
  readonly path: string;
  readonly outcome: SourceFileOutcome;
  readonly reason: string | null;
  readonly documentId: string | null;
}

function sourceError(error: unknown): never {
  if (!(error instanceof DocumentSourceError)) throw error;
  switch (error.reason) {
    case 'ACCESS':
      throw new UnprocessableEntityException({ code: 'SOURCE_ACCESS' });
    case 'NOT_FOUND':
      throw new UnprocessableEntityException({ code: 'SOURCE_NOT_FOUND' });
    case 'NOT_CONFIGURED':
      throw new UnprocessableEntityException({ code: 'SOURCE_NOT_CONFIGURED' });
    default:
      throw new ServiceUnavailableException({ code: 'SOURCE_UNAVAILABLE' });
  }
}

/**
 * Connected data rooms and drives (T-098, ADR 0016). Pactlab reads them —
 * never writes, moves or shares files at the source. A sync reads new and
 * changed files through the normal upload path; a file gone at the source is
 * marked REMOVED (never deleted), so findings built on it keep their lineage.
 */
@Injectable()
export class DocumentSourcesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(PROVIDER_DEPENDENCIES) private readonly providers: ProviderDependencies,
    @Inject(DocumentConnectionsService) private readonly accounts: DocumentConnectionsService,
  ) {}

  private audit(tenant: TenantContext, dealId: string, action: string, id: string, requestId: string): AuditEventInput {
    return {
      organizationId: tenant.organizationId,
      dealId,
      actorUserId: tenant.userId,
      action,
      targetType: 'document_source',
      targetId: id,
      outcome: 'SUCCEEDED',
      requestId,
    };
  }

  async list(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canManage, { action: 'document_source.list', requestId });
    // bounded: one pact's own records of this kind (tens: a checklist, versions, entries, its sources)
    const rows = await withTenant(this.prisma, tenant, (tx) => tx.documentSource.findMany({ where: { dealId }, orderBy: { createdAt: 'asc' } }));
    return {
      items: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        providerLabel: DOCUMENT_SOURCE_LABELS[row.provider as DocumentSourceProvider] ?? row.provider,
        mode: row.mode,
        displayName: row.displayName,
        folder: (row.config as { folder?: string }).folder ?? null,
        status: row.status,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        lastSyncSummary: row.lastSyncSummary,
        // Reads with the organization's own sign-in (T-147), not a pasted token.
        viaOrganization: row.organizationConnectionId !== null,
      })),
      // Providers the organization has signed in to, so a LIVE folder can be added without a token.
      signedIn: await this.accounts.signedIn(tenant),
      // Synthetic rooms are offered only where fixture connections are allowed (local and dev).
      fixtureRooms: this.providers.allowFixtureConnections
        ? Object.values(this.providers.fixtureRooms).map((room) => ({ id: room.id, label: room.label }))
        : [],
    };
  }

  async connect(tenant: TenantContext, dealId: string, body: ConnectDocumentSourceBody, requestId: string) {
    await this.access.require(tenant, dealId, canManage, { action: 'document_source.connected', requestId });
    if (body.mode === 'FIXTURE' && !this.providers.allowFixtureConnections) throw new ForbiddenException({ code: 'FIXTURES_OFF' });
    if (body.mode === 'FIXTURE' && !this.providers.fixtureRooms[body.folder]) throw new UnprocessableEntityException({ code: 'SOURCE_NOT_FOUND' });
    if (body.mode === 'LIVE' && body.provider === 'vdr') throw new UnprocessableEntityException({ code: 'SOURCE_NOT_CONFIGURED' });
    // LIVE reads with the organization's own sign-in (T-147); a pasted token only from older clients.
    const account =
      body.mode === 'LIVE' && !body.token
        ? await withTenant(this.prisma, tenant, (tx) => tx.organizationConnection.findFirst({ where: { organizationId: tenant.organizationId, provider: body.provider, disconnectedAt: null }, select: { id: true } }))
        : null;
    if (body.mode === 'LIVE' && !body.token && !account) throw new UnprocessableEntityException({ code: 'SOURCE_NOT_CONNECTED' });
    const id = newId();
    let credentialRef: string | null = null;
    if (body.mode === 'LIVE' && body.token) {
      credentialRef = `secretref:pactlab/${tenant.organizationId}/${dealId}/document-source/${id}`;
      try {
        // Stored once, never returned, logged or audited.
        await this.providers.secrets.put(credentialRef, body.token);
      } catch {
        throw new ServiceUnavailableException({ code: 'SECRETS_UNAVAILABLE' });
      }
    }
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.documentSource.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          dealId,
          provider: body.provider,
          mode: body.mode,
          displayName: body.displayName,
          config: { folder: body.folder },
          credentialRef,
          organizationConnectionId: account?.id ?? null,
          createdBy: tenant.userId,
        },
      });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.connected', id, requestId));
    });
    return { id };
  }

  /** Read the source: new and changed files in, removed ones marked. Each file's outcome is returned. */
  async sync(tenant: TenantContext, dealId: string, sourceId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canManage, { action: 'document_source.synced', requestId });
    const source = await withTenant(this.prisma, tenant, (tx) => tx.documentSource.findFirst({ where: { id: sourceId, dealId } }));
    if (!source) throw new NotFoundException();
    if (source.status !== 'ACTIVE') throw new ConflictException({ code: 'SOURCE_DISABLED' });
    const config = { folder: (source.config as { folder?: string }).folder ?? '' };
    // Signed in through the organization (T-147): its current sign-in, refreshed by itself; else a pasted token.
    const accessToken = source.organizationConnectionId ? await withTenant(this.prisma, tenant, (tx) => this.accounts.tokensFor(tx, source.organizationId, source.provider)) : undefined;
    const scope = { credentialRef: source.credentialRef, accessToken };
    const adapter = documentSourceAdapter(source.provider as DocumentSourceProvider, source.mode as 'FIXTURE' | 'LIVE', {
      fetch: this.providers.fetch,
      secrets: this.providers.secrets,
      rooms: this.providers.fixtureRooms,
    });

    let listing: SourceFile[];
    try {
      listing = await adapter.list(scope, config);
    } catch (error) {
      sourceError(error);
    }
    // A room larger than one listing is said so, and nothing is marked removed from a partial listing (T-126).
    const complete = listing.length <= MAX_SOURCE_FILES;
    const listed = listing.slice(0, MAX_SOURCE_FILES);
    let reads = 0;
    const known = await withTenant(this.prisma, tenant, (tx) =>
      // whole-set: a sync compares the source against every file it brought in
      tx.document.findMany({
        where: { dealId, sourceId, sourceState: 'CURRENT' },
        select: { id: true, sourceExternalId: true, sourceVersion: true, fileName: true, sourcePath: true },
      }),
    );
    const current = new Map(known.map((document) => [document.sourceExternalId ?? '', document]));
    const seen = new Set<string>();
    const files: SourceSyncFile[] = [];
    const replaced: string[] = [];

    for (const file of listed) {
      seen.add(file.externalId);
      const path = file.folder ? `${file.folder}/${file.name}` : file.name;
      const previous = current.get(file.externalId);
      if (previous && previous.sourceVersion === file.version) {
        files.push({ path, outcome: 'UNCHANGED', reason: null, documentId: previous.id });
        continue;
      }
      const contentType = contentTypeOf(file.name);
      if (!contentType) {
        files.push({ path, outcome: 'SKIPPED', reason: 'UNSUPPORTED_TYPE', documentId: null });
        continue;
      }
      // At most MAX_SOURCE_READS files are read per sync; the next sync carries on, since unchanged files are skipped.
      if (reads >= MAX_SOURCE_READS) {
        files.push({ path, outcome: 'WAITING', reason: 'NEXT_SYNC', documentId: previous?.id ?? null });
        continue;
      }
      reads += 1;
      let bytes: Uint8Array;
      try {
        bytes = await adapter.read(scope, config, file);
      } catch (error) {
        if (error instanceof DocumentSourceError && error.reason === 'TOO_LARGE') {
          files.push({ path, outcome: 'REJECTED', reason: 'TOO_LARGE', documentId: null });
          continue;
        }
        sourceError(error);
      }
      try {
        const uploaded = await this.documents.ingest(
          tenant,
          dealId,
          role,
          { fileName: file.name, contentType, contentBase64: Buffer.from(bytes).toString('base64'), retentionClass: 'DEAL_TERM', dataClass: 'BUSINESS', aiExcluded: false, shared: false },
          file.folder || null,
          requestId,
          { sourceId, externalId: file.externalId, version: file.version },
        );
        if (uploaded.duplicate) {
          files.push({ path, outcome: 'DUPLICATE', reason: null, documentId: uploaded.id });
          continue;
        }
        if (previous) replaced.push(previous.id);
        files.push({ path, outcome: previous ? 'UPDATED' : 'NEW', reason: null, documentId: uploaded.id });
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        files.push({ path, outcome: 'REJECTED', reason: 'UNREADABLE_OR_INFECTED', documentId: null });
      }
    }
    const removed = complete ? known.filter((document) => !seen.has(document.sourceExternalId ?? '')) : [];
    for (const document of removed) {
      files.push({ path: document.sourcePath ? `${document.sourcePath}/${document.fileName}` : document.fileName, outcome: 'REMOVED', reason: null, documentId: document.id });
    }

    const summary = Object.fromEntries(
      (['NEW', 'UPDATED', 'UNCHANGED', 'DUPLICATE', 'REMOVED', 'SKIPPED', 'REJECTED', 'WAITING'] as const).map((outcome) => [outcome, files.filter((file) => file.outcome === outcome).length]),
    );
    // Said on the page: files still to read (sync again), or a room larger than one listing.
    const progress = { complete, waiting: summary['WAITING'] ?? 0, listedLimit: MAX_SOURCE_FILES };
    await withTenant(this.prisma, tenant, async (tx) => {
      if (replaced.length > 0) await tx.document.updateMany({ where: { dealId, id: { in: replaced } }, data: { sourceState: 'REPLACED' } });
      if (removed.length > 0) await tx.document.updateMany({ where: { dealId, id: { in: removed.map((document) => document.id) } }, data: { sourceState: 'REMOVED' } });
      await tx.documentSource.update({ where: { id: sourceId }, data: { lastSyncedAt: new Date(), lastSyncSummary: { ...summary, LISTING_COMPLETE: complete ? 1 : 0 } } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.synced', sourceId, requestId));
    });
    // Unchanged and waiting files are counted in the summary, not listed: a large room would send thousands of rows.
    return { sourceId, summary, files: files.filter((file) => file.outcome !== 'UNCHANGED' && file.outcome !== 'WAITING'), ...progress };
  }
}
