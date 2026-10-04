import { citationStillValid, sha256Hex, type ExtractedItem } from '@pactlab/ai';
import { newId } from '@pactlab/domain';
import type {
  DocumentFinding,
  DocumentFindingReview,
  DocumentPageRecord,
  NamedReviewer,
} from './documents.types';

export type DocumentFindingErrorCode =
  | 'HUMAN_REQUIRED'
  | 'RATIONALE_REQUIRED'
  | 'INVALID_TRANSITION'
  | 'CITATION_REQUIRED'
  | 'CITATION_STALE';

export class DocumentFindingError extends Error {
  constructor(readonly code: DocumentFindingErrorCode) {
    super(`Document finding: ${code}`);
    this.name = 'DocumentFindingError';
  }
}

/** Who is deciding. Only a named human may decide; AI is listed so the rule is explicit. */
export type DecisionActor =
  ({ readonly kind: 'HUMAN' } & NamedReviewer) | { readonly kind: 'AI'; readonly aiRunId: string };

export function findingFingerprint(
  documentId: string,
  item: Pick<ExtractedItem, 'kind' | 'subtype' | 'title'>,
) {
  return sha256Hex([documentId, item.kind, item.subtype, item.title.toLowerCase()].join('|'));
}

/** AI output enters only as DRAFT, whatever the model said. */
export function draftFromExtraction(input: {
  organizationId: string;
  dealId: string;
  documentId: string;
  createdBy: string;
  run: {
    id: string;
    promptId: string;
    promptVersion: string;
    promptHash: string;
    resolvedModelId: string;
  };
  item: ExtractedItem;
  now: Date;
}): DocumentFinding {
  const { item, run } = input;
  return {
    id: newId(),
    organizationId: input.organizationId,
    dealId: input.dealId,
    documentId: input.documentId,
    aiRunId: run.id,
    origin: 'AI_CONTRACT_EXTRACTION',
    kind: item.kind,
    subtype: item.subtype,
    domain: 'LEGAL',
    title: item.title,
    summary: item.summary,
    severity: item.severity,
    status: 'DRAFT',
    fingerprint: findingFingerprint(input.documentId, item),
    citations: item.citations,
    provenance: {
      promptId: run.promptId,
      promptVersion: run.promptVersion,
      promptHash: run.promptHash,
      resolvedModelId: run.resolvedModelId,
    },
    createdBy: input.createdBy,
    reviewer: null,
    decidedAt: null,
    version: 1,
    createdAt: input.now.toISOString(),
  };
}

/**
 * Citation gate for acceptance: at least one citation, and every citation
 * still matches the current text of its exact page. Purged or changed pages
 * make the citation stale.
 */
export function assertCitationsResolve(
  finding: Pick<DocumentFinding, 'citations'>,
  pages: ReadonlyMap<string, Pick<DocumentPageRecord, 'pageNumber' | 'text'>>,
): void {
  if (finding.citations.length === 0) throw new DocumentFindingError('CITATION_REQUIRED');
  for (const citation of finding.citations) {
    const page = pages.get(citation.citationId);
    if (
      !page ||
      page.text === null ||
      page.pageNumber !== citation.pageNumber ||
      !citationStillValid(citation, page.text)
    ) {
      throw new DocumentFindingError('CITATION_STALE');
    }
  }
}

/**
 * The only path to ACCEPTED or REJECTED. Requires a named human, a rationale
 * and a DRAFT finding; acceptance additionally requires resolvable exact-page
 * citations.
 */
export function decideDocumentFinding(input: {
  finding: DocumentFinding;
  decision: 'ACCEPT' | 'REJECT';
  actor: DecisionActor;
  rationale: string;
  pages: ReadonlyMap<string, Pick<DocumentPageRecord, 'pageNumber' | 'text'>>;
  now: Date;
}): { finding: DocumentFinding; review: DocumentFindingReview } {
  const { finding, actor } = input;
  if (actor.kind !== 'HUMAN' || actor.displayName.trim() === '' || actor.userId === '') {
    throw new DocumentFindingError('HUMAN_REQUIRED');
  }
  if (input.rationale.trim().length < 3) throw new DocumentFindingError('RATIONALE_REQUIRED');
  if (finding.status !== 'DRAFT') throw new DocumentFindingError('INVALID_TRANSITION');
  if (input.decision === 'ACCEPT') assertCitationsResolve(finding, input.pages);

  const reviewer: NamedReviewer = { userId: actor.userId, displayName: actor.displayName };
  const decidedAt = input.now.toISOString();
  return {
    finding: {
      ...finding,
      status: input.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
      reviewer,
      decidedAt,
      version: finding.version + 1,
    },
    review: {
      id: newId(),
      findingId: finding.id,
      decision: input.decision,
      reviewer,
      rationale: input.rationale.trim(),
      decidedAt,
    },
  };
}
