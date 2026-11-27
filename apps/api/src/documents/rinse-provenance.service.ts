import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SourceIndex } from '@pactlab/ai';
import type { RinsedFolder } from '@pactlab/connectors';
import { rinseProvenanceEntry, type DocumentProvenanceView, type RinseManifestDocument, type RinseSetView, type RinseSourceDiscrepancy } from '@pactlab/contracts';
import { afterCursor, appendAuditEvent, toPage, withTenant, type PageRequest, type PrismaClient } from '@pactlab/db';
import { canDraftFindings, isBuyerSideRole, newId, permissionsForDealRole, RINSE_AUDIT_VERSION, type DealRole, type ProposedFinding, type TenantContext } from '@pactlab/domain';
import { FindingsService } from '../findings/findings.service';
import { PRISMA } from '../tokens';
import { handSourcedClaimSource, handSourcedClaimStatement, rinseSummary, type RinseSyncSummary } from './rinse-injection';

/** Who may record claims: the deal team (hand-sourced entries from a rinsed set become seller claims). */
const canRecordClaims = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && isBuyerSideRole(role);
/** Most documents a provenance lookup answers for at once (a document and the citations on one page). */
export const MAX_PROVENANCE_LOOKUP = 50;

type ReadSet = Extract<RinsedFolder, { status: 'READ' }>;

export interface RinseInjection {
  readonly origin: 'SYNC' | 'ARCHIVE';
  readonly sourceId: string | null;
  readonly visibility: 'SHARED' | 'BUYER_ONLY';
  /** The pact document each manifest entry's file became (new or an existing duplicate). */
  readonly documents: ReadonlyMap<string, string>;
  /** Documents filed from the manifest's classifications in this pass. */
  readonly filed: readonly string[];
}

/** A discrepancy's draft, by the canonical copy, the page and what it states. */
export const discrepancyFingerprint = (item: Pick<RinseSourceDiscrepancy, 'label' | 'page' | 'stated' | 'computed'>, documentId: string) =>
  `rinse:source-discrepancy:${documentId}:p${item.page}:${createHash('sha256').update(`${item.label}|${item.stated}|${item.computed}`).digest('hex').slice(0, 16)}`;

const titleOf = (document: RinseManifestDocument) => document.metadata.title ?? document.converted?.path ?? document.original?.path ?? document.id;

/**
 * First-class provenance for sets finished in Pactlab Rinse (T-178d, ADR 0058 addendum). One `rinse_sets`
 * row per manifest as it reached the pact (gap notes, source discrepancies, preparer), and one
 * `document_provenance` row per document linking the canonical copy, the seller's original and its
 * manifest entry. Hand-sourced entries become HAND_SOURCED seller claims; source discrepancies become
 * draft findings citing the page, for a person to decide. Shared by the sync and the archive import.
 */
@Injectable()
export class RinseProvenanceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FindingsService) private readonly findings: FindingsService,
  ) {}

  async inject(tenant: TenantContext, dealId: string, role: DealRole, rinsed: ReadSet, context: RinseInjection, requestId: string): Promise<RinseSyncSummary> {
    const manifest = rinsed.manifest;
    const discrepancies: RinseSourceDiscrepancy[] = manifest.documents.flatMap((document) =>
      (document.audit?.sourceDiscrepancies ?? []).map((item) => ({ manifestDocumentId: document.id, documentId: context.documents.get(document.id) ?? null, title: titleOf(document), ...item })),
    );
    const claims = new Map<string, string>();
    const recordClaims = canRecordClaims(role);
    const hand = manifest.documents.filter((document) => document.source === 'HAND_ENTRY');

    await withTenant(this.prisma, tenant, async (tx) => {
      // Recorded once per manifest and visibility, however often its folder syncs.
      let set = await tx.rinseSet.findFirst({ where: { dealId, manifestSha256: rinsed.manifestSha256, visibility: context.visibility }, select: { id: true } });
      if (!set) {
        set = await tx.rinseSet.create({
          data: {
            id: newId(),
            organizationId: tenant.organizationId,
            dealId,
            manifestSetId: manifest.set.id,
            manifestSha256: rinsed.manifestSha256,
            name: manifest.set.name,
            pack: manifest.set.pack,
            preparedBy: manifest.set.preparedBy,
            readyAt: new Date(manifest.set.readyAt),
            generatorVersion: manifest.generator.version,
            origin: context.origin,
            documentSourceId: context.sourceId,
            visibility: context.visibility,
            documents: manifest.documents.length,
            gaps: manifest.gaps,
            sourceDiscrepancies: discrepancies as never,
            createdBy: tenant.userId,
          },
          select: { id: true },
        });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'rinse_set.recorded', targetType: 'rinse_set', targetId: set.id, outcome: 'SUCCEEDED', requestId });
      }
      const setId = set.id;
      const ids = [...context.documents.values()];
      // bounded: the documents of this one manifest (at most its document count)
      const recorded = ids.length ? await tx.documentProvenance.findMany({ where: { dealId, rinseSetId: setId, documentId: { in: ids } }, select: { documentId: true } }) : [];
      const has = new Set(recorded.map((row) => row.documentId));
      for (const document of manifest.documents) {
        const documentId = context.documents.get(document.id);
        if (!documentId || has.has(documentId)) continue;
        has.add(documentId);
        const canonical = document.converted ?? document.original;
        if (!canonical) continue;
        const converted = document.converted !== null && document.original !== null;
        await tx.documentProvenance.create({
          data: {
            id: newId(),
            organizationId: tenant.organizationId,
            dealId,
            documentId,
            rinseSetId: setId,
            manifestDocumentId: document.id,
            role: converted ? 'CONVERTED' : 'AS_IS',
            canonicalPath: canonical.path,
            canonicalSha256: canonical.sha256,
            originalPath: converted ? (document.original?.path ?? null) : null,
            originalSha256: converted ? (document.original?.sha256 ?? null) : null,
            originalSizeBytes: converted && document.original ? BigInt(document.original.sizeBytes) : null,
            originalMediaType: converted ? (document.original?.mediaType ?? null) : null,
            entry: rinseProvenanceEntry(document) as never,
            createdBy: tenant.userId,
          },
        });
      }

      if (recordClaims) {
        for (const document of hand) {
          const statement = handSourcedClaimStatement(document);
          const source = handSourcedClaimSource(document);
          if (!statement || !source) continue;
          // Idempotent: the same entry and revision is recorded once (MANUAL: recorded before T-178d).
          const existing = await tx.dealClaim.findFirst({ where: { dealId, origin: { in: ['HAND_SOURCED', 'MANUAL'] }, statement, source }, select: { id: true } });
          if (existing) {
            claims.set(document.id, existing.id);
            continue;
          }
          const claim = await tx.dealClaim.create({ data: { organizationId: tenant.organizationId, dealId, statement, source, origin: 'HAND_SOURCED', createdBy: tenant.userId, updatedBy: tenant.userId } });
          claims.set(document.id, claim.id);
          await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'claim.created', targetType: 'deal_claim', targetId: claim.id, outcome: 'SUCCEEDED', requestId });
        }
      }
    });

    // Diligence signal, drafted by the deal team's pass only; a seller's pass leaves them for the next one.
    if (canDraftFindings(role)) await this.draftDiscrepancies(tenant, dealId, discrepancies, requestId);
    return rinseSummary(manifest, claims, hand.length > 0 && !recordClaims, context.filed);
  }

  /** One draft finding per discrepancy whose page holds the figure, citing it. Never accepted here. */
  private async draftDiscrepancies(tenant: TenantContext, dealId: string, discrepancies: readonly RinseSourceDiscrepancy[], requestId: string): Promise<void> {
    const proposals: ProposedFinding[] = [];
    for (const item of discrepancies) {
      if (!item.documentId) continue;
      const documentId = item.documentId;
      const page = await withTenant(this.prisma, tenant, (tx) =>
        tx.documentPage.findFirst({ where: { dealId, documentId, pageNumber: item.page }, select: { text: true, document: { select: { fileName: true, dataClass: true, status: true } } } }),
      );
      if (!page?.text || page.document.status !== 'AVAILABLE') continue;
      const line = page.text.split('\n').find((row) => row.includes(item.label)) ?? item.label;
      const citationId = `${documentId}:${item.page}`;
      const check = new SourceIndex([{ citationId, documentId, documentName: page.document.fileName, pageNumber: item.page, text: page.text, classification: page.document.dataClass }]).verify({ citationId, quote: line.trim() });
      if (!check.ok) continue;
      const { documentId: citedDocument, pageNumber, quote, quoteHash, charStart, charEnd } = check.citation;
      proposals.push({
        domain: 'FINANCIAL',
        title: `The seller's original does not foot: ${item.label} (${item.title})`.slice(0, 160),
        description: `In the seller's own ${item.title}, ${item.label} on page ${item.page} states ${item.stated}, but the lines above it sum to ${item.computed}. Pactlab Rinse's conversion audit found it on the seller's machine before upload; the canonical copy reproduces the original as it is. What the gap means is for a person to decide.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        origin: 'HEURISTIC',
        fingerprint: discrepancyFingerprint(item, documentId),
        evidence: [{ evidenceItemId: null, documentCitation: { documentId: citedDocument, pageNumber, quote, quoteHash, charStart, charEnd }, commitSha: null, toolName: 'pactlab-rinse', toolVersion: RINSE_AUDIT_VERSION, rulesetVersion: null, path: null, lineStart: null, lineEnd: null }],
        pricedRisk: null,
        direction: 0,
      });
    }
    if (proposals.length) await this.findings.recordProposals(tenant, dealId, proposals, { kind: 'SYSTEM', component: `rinse@${RINSE_AUDIT_VERSION}` }, requestId);
  }

  /** Provenance for documents the caller can see (RLS), newest set first. */
  async forDocuments(tenant: TenantContext, dealId: string, documentIds: readonly string[]): Promise<DocumentProvenanceView[]> {
    if (documentIds.length === 0) return [];
    return withTenant(this.prisma, tenant, async (tx) => {
      // bounded: at most MAX_PROVENANCE_LOOKUP documents, one row per set each came from
      const rows = await tx.documentProvenance.findMany({
        where: { dealId, documentId: { in: documentIds.slice(0, MAX_PROVENANCE_LOOKUP) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { set: { select: { id: true, name: true, preparedBy: true, readyAt: true, origin: true } } },
      });
      return rows.map((row) => {
        const preparedBy = row.set.preparedBy as { name: string; organization: string };
        return {
          documentId: row.documentId,
          set: { id: row.set.id, name: row.set.name, preparedBy: { name: preparedBy.name, organization: preparedBy.organization }, readyAt: row.set.readyAt.toISOString(), origin: row.set.origin as 'SYNC' | 'ARCHIVE' },
          role: row.role as 'CONVERTED' | 'AS_IS',
          manifestDocumentId: row.manifestDocumentId,
          canonical: { path: row.canonicalPath, sha256: row.canonicalSha256 },
          original: row.originalPath && row.originalSha256 ? { path: row.originalPath, sha256: row.originalSha256, sizeBytes: row.originalSizeBytes === null ? null : Number(row.originalSizeBytes), mediaType: row.originalMediaType } : null,
          entry: row.entry as DocumentProvenanceView['entry'],
          recordedAt: row.createdAt.toISOString(),
        };
      });
    });
  }

  /** The rinsed sets that reached the pact, newest first, with the drafts their discrepancies became. */
  async sets(tenant: TenantContext, dealId: string, page: PageRequest) {
    return withTenant(this.prisma, tenant, async (tx) => {
      const where = { dealId };
      const [rows, total] = await Promise.all([
        tx.rinseSet.findMany({ where: { ...where, ...afterCursor('createdAt', page.cursor, { asDate: true }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.limit + 1 }),
        tx.rinseSet.count({ where }),
      ]);
      const fingerprints = rows.flatMap((row) => (row.sourceDiscrepancies as unknown as RinseSourceDiscrepancy[]).flatMap((item) => (item.documentId ? [discrepancyFingerprint(item, item.documentId)] : [])));
      // bounded: the drafts of the discrepancies on this page of sets
      const drafted = fingerprints.length ? await tx.finding.findMany({ where: { dealId, fingerprint: { in: fingerprints } }, select: { id: true, fingerprint: true } }) : [];
      return toPage(rows, page, total, (row) => row.createdAt, (row): RinseSetView => {
        const preparedBy = row.preparedBy as { name: string; organization: string };
        return {
          id: row.id,
          name: row.name,
          pack: row.pack,
          preparedBy: { name: preparedBy.name, organization: preparedBy.organization },
          readyAt: row.readyAt.toISOString(),
          origin: row.origin as 'SYNC' | 'ARCHIVE',
          documents: row.documents,
          gaps: row.gaps as unknown as RinseSetView['gaps'],
          sourceDiscrepancies: (row.sourceDiscrepancies as unknown as RinseSourceDiscrepancy[]).map((item) => ({
            ...item,
            findingId: item.documentId ? (drafted.find((finding) => finding.fingerprint === discrepancyFingerprint(item, item.documentId as string))?.id ?? null) : null,
          })),
          recordedAt: row.createdAt.toISOString(),
        };
      });
    });
  }
}
