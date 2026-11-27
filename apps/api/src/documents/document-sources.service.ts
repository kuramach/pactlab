import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  connectionTokens,
  destroySecret,
  DOCUMENT_OAUTH_PROVIDERS,
  DOCUMENT_SOURCE_LABELS,
  documentSourceConfigSchema,
  MAX_PICKED_FILES,
  OneDriveDocumentSourceAdapter,
  DocumentSourceError,
  documentSourceAdapter,
  MAX_SOURCE_FILES,
  MAX_SOURCE_READS,
  matchRinsedFile,
  readRinsedArchive,
  readRinsedFolder,
  rinseDisposition,
  sourcePathOf,
  type RinsedFolder,
  type DocumentOAuthProvider,
  type DocumentSourceProvider,
  type SourceFile,
} from '@pactlab/connectors';
import { appendAuditEvent, withTenant, type AuditEventInput, type PrismaClient } from '@pactlab/db';
import { isBuyerSideRole, isCounterpartyRole, newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { PROVIDER_DEPENDENCIES, type ProviderDependencies } from '../connections/provider-dependencies';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';
import { DocumentConnectionsService } from './document-connections.service';
import type { ConnectDocumentSourceBody, DocumentSignInBody } from './documents.schemas';
import type { SignInState } from './oauth-state';
import { DocumentsService } from './documents.service';
import { DOCX_CONTENT_TYPE, XLSX_CONTENT_TYPE, type AcceptedContentType } from './documents.types';
import { ArchiveError, unpackArchiveFiles } from './archive';
import type { ImportRinsedArchiveBody } from './documents.schemas';
import { rinseIntakeReason, type RinseSyncSummary } from './rinse-injection';
import { RinseProvenanceService, type RinseInjection } from './rinse-provenance.service';

/** Buyers who may add documents read them from a source; sources are buyer-side configuration. */
const canManage = (role: DealRole) => {
  const permissions = permissionsForDealRole(role);
  return permissions.has('DEAL_WRITE') && permissions.has('BUYER_ANALYSIS_READ');
};

/** Counterparties read only what is shared with them (RLS), as with the documents themselves. */
const canReadDocuments = (role: DealRole) => permissionsForDealRole(role).has('EVIDENCE_READ') || isCounterpartyRole(role);

/**
 * Who may connect a drive folder from the pact itself with their own sign-in: the deal team, and the
 * seller, whose folder comes in shared with the deal (Kumar, 2026-11-21). RLS keeps a seller to the
 * sources they connected.
 */
const canSupply = (role: DealRole) => canManage(role) || role === 'TARGET_CONTRIBUTOR';

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
    @Inject(RinseProvenanceService) private readonly rinseProvenance: RinseProvenanceService,
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
    const role = await this.access.require(tenant, dealId, canSupply, { action: 'document_source.list', requestId });
    const team = canManage(role);
    // bounded: one pact's own records of this kind (tens: a checklist, versions, entries, its sources)
    const rows = await withTenant(this.prisma, tenant, (tx) => tx.documentSource.findMany({ where: { dealId }, orderBy: { createdAt: 'asc' } }));
    const signedIn = await this.accounts.signedIn(tenant);
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
        // How it reads, and as whom (an email; never a token).
        kind: row.organizationConnectionId ? 'ORGANIZATION' : row.credentialKind === 'OAUTH' ? 'PERSON' : row.mode === 'LIVE' ? 'TOKEN' : 'FIXTURE',
        signedInAs: row.accountName,
        // Google Drive through the picker: how many files were chosen (Pactlab reads only those).
        filesChosen: Array.isArray((row.config as { files?: unknown }).files) ? ((row.config as { files: unknown[] }).files.length) : null,
        shared: row.visibility === 'SHARED',
        canDisconnect: row.status === 'ACTIVE' && row.mode === 'LIVE' && (team || row.createdBy === tenant.userId),
        // A OneDrive source waits for its folder, chosen in Pactlab by whoever connected it (in the account it reads with).
        needsFolder: row.provider === 'onedrive' && row.mode === 'LIVE' && !(row.config as { folder?: string }).folder,
        canChooseFolder: row.status === 'ACTIVE' && row.provider === 'onedrive' && row.mode === 'LIVE' && row.createdBy === tenant.userId,
        // Only the person who signed in can open Google's picker on their own Drive.
        canChooseFiles: row.status === 'ACTIVE' && row.provider === 'google-drive' && row.credentialKind === 'OAUTH' && row.createdBy === tenant.userId,
      })),
      // Providers the organization has signed in to, so a LIVE folder can be added without a token.
      signedIn: team ? signedIn : [],
      // Providers someone may sign in to from this pact (Pactlab's client is set up here).
      providers: DOCUMENT_OAUTH_PROVIDERS.filter(
        (provider) => Boolean(this.providers.documentOAuth[provider] && this.providers.webOrigin) && (provider !== 'google-drive' || this.providers.googlePicker !== null),
      ).map((provider) => ({
        provider,
        label: DOCUMENT_SOURCE_LABELS[provider],
        organizationSignedIn: team && signedIn.includes(provider),
      })),
      // The seller's own view: what they connect is shared with the deal team.
      seller: !team,
      // Synthetic rooms are offered only where fixture connections are allowed (local and dev).
      fixtureRooms: team && this.providers.allowFixtureConnections
        ? Object.values(this.providers.fixtureRooms).map((room) => ({ id: room.id, label: room.label }))
        : [],
    };
  }

  async connect(tenant: TenantContext, dealId: string, body: ConnectDocumentSourceBody, requestId: string) {
    await this.access.require(tenant, dealId, canManage, { action: 'document_source.connected', requestId });
    if (body.mode === 'FIXTURE' && !this.providers.allowFixtureConnections) throw new ForbiddenException({ code: 'FIXTURES_OFF' });
    if (body.mode === 'FIXTURE' && !this.providers.fixtureRooms[body.folder]) throw new UnprocessableEntityException({ code: 'SOURCE_NOT_FOUND' });
    if (body.mode === 'LIVE' && body.provider === 'vdr') throw new UnprocessableEntityException({ code: 'SOURCE_NOT_CONFIGURED' });
    // Google Drive files are chosen in each person's picker (`startSignIn`), never read through an organization sign-in.
    if (body.mode === 'LIVE' && body.provider === 'google-drive' && !body.token) throw new UnprocessableEntityException({ code: 'USE_PICKER' });
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

  /**
   * Connect a folder from the pact with the person's own sign-in: off to Google or Microsoft, back to the
   * provider's registered callback, then `completeSignIn`. The folder and name travel in the signed state.
   */
  async startSignIn(tenant: TenantContext, dealId: string, body: DocumentSignInBody, requestId: string): Promise<{ url: string }> {
    await this.access.require(tenant, dealId, canSupply, { action: 'document_source.sign_in_started', requestId });
    if (body.provider === 'google-drive' && !this.providers.googlePicker) throw new ServiceUnavailableException({ code: 'SOURCE_NOT_CONFIGURED' });
    return this.accounts.signInUrl(tenant, body.provider, { k: 'pact', d: dealId, f: body.provider === 'google-drive' ? '' : (body.folder ?? ''), n: body.displayName });
  }

  /**
   * The person came back signed in: the code is exchanged, the tokens stored under this source's own
   * reference, and the source created. A seller's folder is shared with the deal; the deal team's is
   * buyer-only, as their uploads are.
   */
  async completeSignIn(tenant: TenantContext, state: Extract<SignInState, { k: 'pact' }>, code: string, requestId: string): Promise<{ dealId: string; sourceId: string }> {
    const dealId = state.d;
    const role = await this.access.require(tenant, dealId, canSupply, { action: 'document_source.connected', requestId });
    const folder = documentSourceConfigSchema.shape.folder.safeParse(state.f);
    if (!folder.success) throw new UnprocessableEntityException({ code: 'SOURCE_NOT_FOUND' });
    const { tokens, account } = await this.accounts.exchange(state.p, code);
    const id = newId();
    const credentialRef = `secretref:${tenant.organizationId}/${dealId}/document-source/${id}`;
    try {
      // Stored once, never returned, logged or audited.
      await this.providers.secrets.put(credentialRef, JSON.stringify(tokens));
    } catch {
      throw new ServiceUnavailableException({ code: 'SECRETS_UNAVAILABLE' });
    }
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.documentSource.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          dealId,
          provider: state.p,
          mode: 'LIVE',
          displayName: state.n,
          // Google Drive: no folder; the files come from the picker next (`addFiles`). OneDrive: chosen next (`chooseFolder`).
          config: state.p === 'google-drive' ? { folder: '', files: [] } : { folder: folder.data },
          credentialRef,
          credentialKind: 'OAUTH',
          accountName: account.accountName,
          visibility: isBuyerSideRole(role) ? 'BUYER_ONLY' : 'SHARED',
          createdBy: tenant.userId,
        },
      });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.connected', id, requestId));
    });
    return { dealId, sourceId: id };
  }

  /**
   * Stop reading a source: its sign-in is destroyed and the source disabled. Files already read stay,
   * like any document. The person who connected it, or the deal team, may do this.
   */
  async disconnect(tenant: TenantContext, dealId: string, sourceId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canSupply, { action: 'document_source.disconnected', requestId });
    const source = await withTenant(this.prisma, tenant, (tx) => tx.documentSource.findFirst({ where: { id: sourceId, dealId } }));
    if (!source) throw new NotFoundException();
    if (!canManage(role) && source.createdBy !== tenant.userId) throw new ForbiddenException();
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.documentSource.update({ where: { id: sourceId }, data: { status: 'DISABLED' } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.disconnected', sourceId, requestId));
    });
    // An organization sign-in is the organization's (Settings); only the source's own credential goes.
    if (source.credentialRef) {
      // handled: the source is already disabled, so the credential is never used again; a store outage only delays deletion
      await destroySecret(this.providers.secrets, source.credentialRef).catch(() => undefined);
    }
    return { id: sourceId, status: 'DISABLED' };
  }

  /**
   * How a source signs in: the organization's current sign-in (T-147), the person's own (from the pact,
   * refreshed under the source's reference), or a pasted token (before T-147).
   */
  private async scopeOf(tenant: TenantContext, source: { organizationId: string; provider: string; organizationConnectionId: string | null; credentialKind: string | null; credentialRef: string | null }) {
    const personal = source.credentialKind === 'OAUTH' && source.credentialRef ? this.providers.documentOAuth[source.provider as DocumentOAuthProvider] : undefined;
    const accessToken = source.organizationConnectionId
      ? await withTenant(this.prisma, tenant, (tx) => this.accounts.tokensFor(tx, source.organizationId, source.provider))
      : source.credentialKind === 'OAUTH'
        ? personal && source.credentialRef
          ? connectionTokens(personal, this.providers.secrets, source.credentialRef)
          : async () => {
              throw new DocumentSourceError('ACCESS');
            }
        : undefined;
    return { credentialRef: source.credentialRef, accessToken };
  }

  /** A OneDrive source the caller connected: the chooser browses the account it reads with. */
  private async ownOneDriveSource(tenant: TenantContext, dealId: string, sourceId: string, action: string, requestId: string) {
    await this.access.require(tenant, dealId, canSupply, { action, requestId });
    const source = await withTenant(this.prisma, tenant, (tx) => tx.documentSource.findFirst({ where: { id: sourceId, dealId } }));
    if (!source) throw new NotFoundException();
    if (source.provider !== 'onedrive' || source.mode !== 'LIVE') throw new ConflictException({ code: 'NOT_A_ONEDRIVE_SOURCE' });
    if (source.createdBy !== tenant.userId) throw new ForbiddenException();
    if (source.status !== 'ACTIVE') throw new ConflictException({ code: 'SOURCE_DISABLED' });
    return source;
  }

  /** One level of folders in the account the source reads with: My files, or inside a folder (read-only listing). */
  async folders(tenant: TenantContext, dealId: string, sourceId: string, at: { driveId?: string | undefined; itemId?: string | undefined }, requestId: string) {
    const source = await this.ownOneDriveSource(tenant, dealId, sourceId, 'document_source.folders_listed', requestId);
    const adapter = new OneDriveDocumentSourceAdapter({ fetch: this.providers.fetch, secrets: this.providers.secrets });
    try {
      const folders = await adapter.folders(await this.scopeOf(tenant, source), at.driveId && at.itemId ? { driveId: at.driveId, itemId: at.itemId } : undefined);
      return { items: folders };
    } catch (error) {
      sourceError(error);
    }
  }

  /** The folder a OneDrive source reads, chosen in the chooser. Its whole content is read, including files added later. */
  async chooseFolder(tenant: TenantContext, dealId: string, sourceId: string, folder: { driveId: string; itemId: string }, requestId: string) {
    await this.ownOneDriveSource(tenant, dealId, sourceId, 'document_source.folder_chosen', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.documentSource.update({ where: { id: sourceId }, data: { config: { folder: `${folder.driveId}/${folder.itemId}` } } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.folder_chosen', sourceId, requestId));
    });
    return { id: sourceId };
  }

  /** A Google Drive source the caller connected with their own sign-in (the picker runs as them, in their Drive). */
  private async ownGoogleSource(tenant: TenantContext, dealId: string, sourceId: string, action: string, requestId: string) {
    await this.access.require(tenant, dealId, canSupply, { action, requestId });
    const source = await withTenant(this.prisma, tenant, (tx) => tx.documentSource.findFirst({ where: { id: sourceId, dealId } }));
    if (!source) throw new NotFoundException();
    if (source.provider !== 'google-drive' || source.credentialKind !== 'OAUTH' || !source.credentialRef) throw new ConflictException({ code: 'NOT_A_PICKER_SOURCE' });
    if (source.createdBy !== tenant.userId) throw new ForbiddenException();
    if (source.status !== 'ACTIVE') throw new ConflictException({ code: 'SOURCE_DISABLED' });
    return source as typeof source & { credentialRef: string };
  }

  /**
   * What Google's picker needs in the browser, for the person who connected this source only: their own
   * short-lived access token (drive.file, about an hour), Pactlab's picker API key and project number.
   * Audited; never logged. The picker can show only that person's own Drive.
   */
  async picker(tenant: TenantContext, dealId: string, sourceId: string, requestId: string) {
    const source = await this.ownGoogleSource(tenant, dealId, sourceId, 'document_source.picker_opened', requestId);
    const picker = this.providers.googlePicker;
    const client = this.providers.documentOAuth['google-drive'];
    if (!picker || !client) throw new ServiceUnavailableException({ code: 'SOURCE_NOT_CONFIGURED' });
    let accessToken: string;
    try {
      accessToken = await connectionTokens(client, this.providers.secrets, source.credentialRef)();
    } catch (error) {
      sourceError(error);
    }
    await withTenant(this.prisma, tenant, (tx) => appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.picker_opened', sourceId, requestId)));
    return { accessToken, apiKey: picker.apiKey, appId: picker.appId };
  }

  /** Files chosen in the picker join the source (deduplicated, at most MAX_PICKED_FILES); the next sync reads them. */
  async addFiles(tenant: TenantContext, dealId: string, sourceId: string, fileIds: readonly string[], requestId: string) {
    const source = await this.ownGoogleSource(tenant, dealId, sourceId, 'document_source.files_chosen', requestId);
    const current = (source.config as { files?: string[] }).files ?? [];
    const files = [...new Set([...current, ...fileIds])];
    if (files.length > MAX_PICKED_FILES) throw new UnprocessableEntityException({ code: 'TOO_MANY_FILES' });
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.documentSource.update({ where: { id: sourceId }, data: { config: { folder: '', files } } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.files_chosen', sourceId, requestId));
    });
    return { id: sourceId, filesChosen: files.length };
  }

  /** Read the source: new and changed files in, removed ones marked. Each file's outcome is returned. */
  async sync(tenant: TenantContext, dealId: string, sourceId: string, requestId: string) {
    // The deal team syncs any source; a seller only their own (RLS hides the rest).
    const role = await this.access.require(tenant, dealId, canSupply, { action: 'document_source.synced', requestId });
    const source = await withTenant(this.prisma, tenant, (tx) => tx.documentSource.findFirst({ where: { id: sourceId, dealId } }));
    if (!source) throw new NotFoundException();
    if (source.status !== 'ACTIVE') throw new ConflictException({ code: 'SOURCE_DISABLED' });
    const stored = source.config as { folder?: string; files?: string[] };
    const config = { folder: stored.folder ?? '', ...(Array.isArray(stored.files) ? { files: stored.files } : {}) };
    const scope = await this.scopeOf(tenant, source);
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
        select: { id: true, sourceExternalId: true, sourceVersion: true, fileName: true, sourcePath: true, intakeState: true },
      }),
    );
    const current = new Map(known.map((document) => [document.sourceExternalId ?? '', document]));
    const seen = new Set<string>();
    const files: SourceSyncFile[] = [];
    const replaced: string[] = [];

    // A folder finished in Pactlab Rinse carries its manifest (T-178): read it first, so classifications,
    // provenance and hand-sourced entries arrive with the files. Without one, the folder syncs as before.
    const rinsed = await readRinsedFolder(adapter, scope, config, listed);
    const rinseFiled: { documentId: string; proposal: { category: string; by: 'AI' | 'PERSON'; confidence: number | null; reason: string } }[] = [];

    const rinseDocuments = new Map<string, string>();

    for (const file of listed) {
      seen.add(file.externalId);
      const path = sourcePathOf(file);
      const previous = current.get(file.externalId);
      // The same decisions as an archive import (T-178d): manifest, original, hand entry, stray, copy.
      const disposition = rinseDisposition(rinsed, file);
      if (disposition.kind === 'MANIFEST') {
        files.push({ path, outcome: 'SKIPPED', reason: 'RINSE_MANIFEST', documentId: null });
        continue;
      }
      if (disposition.kind === 'REFUSE') {
        files.push({ path, outcome: 'REJECTED', reason: disposition.reason, documentId: null });
        continue;
      }
      if (disposition.kind === 'SKIP') {
        files.push({ path, outcome: 'SKIPPED', reason: disposition.reason, documentId: null });
        continue;
      }
      const entry = disposition.kind === 'READ' ? disposition.match : undefined;
      if (previous && previous.sourceVersion === file.version) {
        files.push({ path, outcome: 'UNCHANGED', reason: null, documentId: previous.id });
        if (entry) rinseDocuments.set(entry.document.id, previous.id);
        // A seller's sync brought it in unsorted: the deal team's sync files it from the manifest.
        const classification = entry?.document.classification;
        if (entry && classification && previous.intakeState === 'UNCLASSIFIED') {
          rinseFiled.push({ documentId: previous.id, proposal: { category: classification.category, by: classification.by, confidence: classification.confidence, reason: rinseIntakeReason(entry.document) } });
        }
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
      if (entry && matchRinsedFile(rinsed, file, bytes) === 'CHANGED_SINCE_RINSE') {
        files.push({ path, outcome: 'REJECTED', reason: 'CHANGED_SINCE_RINSE', documentId: null });
        continue;
      }
      try {
        const uploaded = await this.documents.ingest(
          tenant,
          dealId,
          role,
          { fileName: file.name, contentType, contentBase64: Buffer.from(bytes).toString('base64'), retentionClass: 'DEAL_TERM', dataClass: 'BUSINESS', aiExcluded: false, shared: source.visibility === 'SHARED' },
          file.folder || null,
          requestId,
          { sourceId, externalId: file.externalId, version: file.version },
        );
        if (entry) rinseDocuments.set(entry.document.id, uploaded.id);
        if (uploaded.duplicate) {
          files.push({ path, outcome: 'DUPLICATE', reason: null, documentId: uploaded.id });
          continue;
        }
        if (previous) replaced.push(previous.id);
        files.push({ path, outcome: previous ? 'UPDATED' : 'NEW', reason: null, documentId: uploaded.id });
        const classification = entry?.document.classification;
        if (entry && classification) {
          rinseFiled.push({ documentId: uploaded.id, proposal: { category: classification.category, by: classification.by, confidence: classification.confidence, reason: rinseIntakeReason(entry.document) } });
        }
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        files.push({ path, outcome: 'REJECTED', reason: 'UNREADABLE_OR_INFECTED', documentId: null });
      }
    }
    const removed = complete ? known.filter((document) => !seen.has(document.sourceExternalId ?? '')) : [];
    for (const document of removed) {
      files.push({ path: document.sourcePath ? `${document.sourcePath}/${document.fileName}` : document.fileName, outcome: 'REMOVED', reason: null, documentId: document.id });
    }

    // Seller classifications are filed only for the deal team, who settle intake (as with seller uploads).
    if (canManage(role)) {
      for (const filed of rinseFiled) await this.documents.fileFromRinseManifest(tenant, dealId, filed.documentId, filed.proposal, requestId);
    }
    const rinse = await this.injectRinse(tenant, dealId, role, rinsed, { origin: 'SYNC', sourceId, visibility: source.visibility, documents: rinseDocuments, filed: canManage(role) ? rinseFiled.map((filed) => filed.documentId) : [] }, requestId);

    const summary = Object.fromEntries(
      (['NEW', 'UPDATED', 'UNCHANGED', 'DUPLICATE', 'REMOVED', 'SKIPPED', 'REJECTED', 'WAITING'] as const).map((outcome) => [outcome, files.filter((file) => file.outcome === outcome).length]),
    );
    // Said on the page: files still to read (sync again), or a room larger than one listing.
    const progress = { complete, waiting: summary['WAITING'] ?? 0, listedLimit: MAX_SOURCE_FILES };
    await withTenant(this.prisma, tenant, async (tx) => {
      if (replaced.length > 0) await tx.document.updateMany({ where: { dealId, id: { in: replaced } }, data: { sourceState: 'REPLACED' } });
      if (removed.length > 0) await tx.document.updateMany({ where: { dealId, id: { in: removed.map((document) => document.id) } }, data: { sourceState: 'REMOVED' } });
      await tx.documentSource.update({ where: { id: sourceId }, data: { lastSyncedAt: new Date(), lastSyncSummary: { ...summary, LISTING_COMPLETE: complete ? 1 : 0, ...(rinse ? { RINSE_MANIFEST: rinse.status === 'READ' ? 1 : 0, RINSE_HAND_SOURCED: rinse.handSourced.length, RINSE_NOTED_GAPS: rinse.notedGaps.length, RINSE_SOURCE_DISCREPANCIES: rinse.sourceDiscrepancies.length } : {}) } } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'document_source.synced', sourceId, requestId));
    });
    // Unchanged and waiting files are counted in the summary, not listed: a large room would send thousands of rows.
    return { sourceId, summary, files: files.filter((file) => file.outcome !== 'UNCHANGED' && file.outcome !== 'WAITING'), ...progress, rinse };
  }

  /**
   * What a rinsed set's manifest brings beyond its files: its provenance, hand-sourced entries as
   * HAND_SOURCED seller claims (the deal team's pass; a seller's leaves them waiting), and its gap notes
   * and source discrepancies, stored on the set (T-178d).
   */
  private async injectRinse(tenant: TenantContext, dealId: string, role: DealRole, rinsed: RinsedFolder, context: RinseInjection, requestId: string): Promise<RinseSyncSummary | null> {
    if (rinsed.status === 'NONE') return null;
    if (rinsed.status === 'INVALID') {
      return { status: 'INVALID', problem: rinsed.problem, set: null, documents: 0, audited: 0, handSourced: [], notedGaps: [], sourceDiscrepancies: [], claimsWaitForDealTeam: false, filed: [] };
    }
    return this.rinseProvenance.inject(tenant, dealId, role, rinsed, context, requestId);
  }

  /**
   * Injection path (b), T-178d: a folder finished in Pactlab Rinse, uploaded once as a zip with its
   * manifest. The same manifest reader, the same per-file decisions and the same SHA-256 checks as a
   * sync; nothing the manifest does not name comes in. A seller's import is shared with the deal.
   */
  async importRinsedArchive(tenant: TenantContext, dealId: string, body: ImportRinsedArchiveBody, requestId: string) {
    const role = await this.access.require(tenant, dealId, canSupply, { action: 'document.rinse_archive.imported', requestId });
    let entries;
    try {
      entries = unpackArchiveFiles(Buffer.from(body.contentBase64, 'base64'));
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw error;
      if (error.reason === 'TOO_LARGE' || error.reason === 'EXPANDS_TOO_FAR' || error.reason === 'TOO_MANY_FILES') throw new PayloadTooLargeException({ code: `ARCHIVE_${error.reason}` });
      throw new UnprocessableEntityException({ code: `ARCHIVE_${error.reason}` });
    }
    const { folder: rinsed, files: archived } = readRinsedArchive(entries);
    if (rinsed.status === 'NONE') throw new UnprocessableEntityException({ code: 'RINSE_MANIFEST_MISSING', message: 'The archive has no pactlab-manifest.json at its top' });
    if (rinsed.status === 'INVALID') throw new UnprocessableEntityException({ code: 'RINSE_MANIFEST_INVALID', message: `The manifest cannot be read (${rinsed.problem})` });
    const shared = isCounterpartyRole(role) || body.shared;
    const files: SourceSyncFile[] = [];
    const documents = new Map<string, string>();
    const filed: { documentId: string; proposal: { category: string; by: 'AI' | 'PERSON'; confidence: number | null; reason: string } }[] = [];
    for (const file of archived) {
      const path = sourcePathOf(file);
      const disposition = rinseDisposition(rinsed, file);
      if (disposition.kind === 'MANIFEST') {
        files.push({ path, outcome: 'SKIPPED', reason: 'RINSE_MANIFEST', documentId: null });
        continue;
      }
      if (disposition.kind === 'REFUSE' || disposition.kind === 'ORDINARY') {
        files.push({ path, outcome: 'REJECTED', reason: 'NOT_IN_RINSE_MANIFEST', documentId: null });
        continue;
      }
      if (disposition.kind === 'SKIP') {
        files.push({ path, outcome: 'SKIPPED', reason: disposition.reason, documentId: null });
        continue;
      }
      if (matchRinsedFile(rinsed, file, file.bytes) === 'CHANGED_SINCE_RINSE') {
        files.push({ path, outcome: 'REJECTED', reason: 'CHANGED_SINCE_RINSE', documentId: null });
        continue;
      }
      const contentType = contentTypeOf(file.name);
      if (!contentType) {
        files.push({ path, outcome: 'SKIPPED', reason: 'UNSUPPORTED_TYPE', documentId: null });
        continue;
      }
      try {
        const uploaded = await this.documents.ingest(
          tenant,
          dealId,
          role,
          { fileName: file.name, contentType, contentBase64: Buffer.from(file.bytes).toString('base64'), retentionClass: 'DEAL_TERM', dataClass: 'BUSINESS', aiExcluded: false, shared },
          file.folder || null,
          requestId,
        );
        documents.set(disposition.match.document.id, uploaded.id);
        files.push({ path, outcome: uploaded.duplicate ? 'DUPLICATE' : 'NEW', reason: null, documentId: uploaded.id });
        const classification = disposition.match.document.classification;
        if (classification) filed.push({ documentId: uploaded.id, proposal: { category: classification.category, by: classification.by, confidence: classification.confidence, reason: rinseIntakeReason(disposition.match.document) } });
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        files.push({ path, outcome: 'REJECTED', reason: 'UNREADABLE_OR_INFECTED', documentId: null });
      }
    }
    if (canManage(role)) for (const item of filed) await this.documents.fileFromRinseManifest(tenant, dealId, item.documentId, item.proposal, requestId);
    const rinse = await this.rinseProvenance.inject(tenant, dealId, role, rinsed, { origin: 'ARCHIVE', sourceId: null, visibility: shared ? 'SHARED' : 'BUYER_ONLY', documents, filed: canManage(role) ? filed.map((item) => item.documentId) : [] }, requestId);
    await withTenant(this.prisma, tenant, (tx) => appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'document.rinse_archive.imported', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId }));
    return { fileName: body.fileName, files, rinse };
  }

  /** Where documents read from a rinsed set came from (T-178d); RLS shows only documents the caller can see. */
  async documentProvenance(tenant: TenantContext, dealId: string, documentIds: readonly string[], requestId: string) {
    await this.access.require(tenant, dealId, canReadDocuments, { action: 'document.provenance.read', requestId });
    return { items: await this.rinseProvenance.forDocuments(tenant, dealId, documentIds) };
  }

  /** The rinsed sets that reached the pact, with their gap notes and source discrepancies (T-178d). */
  async rinseSets(tenant: TenantContext, dealId: string, page: { cursor?: string | undefined; limit: number }, requestId: string) {
    await this.access.require(tenant, dealId, canReadDocuments, { action: 'rinse_set.read', requestId });
    return this.rinseProvenance.sets(tenant, dealId, page);
  }
}
