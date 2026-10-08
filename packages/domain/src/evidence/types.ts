import { permissionsForDealRole, type DealRole } from '../roles';

/** Persisted, audited per connection. Downstream logic never branches on mode. */
export const CONNECTION_MODES = ['FIXTURE', 'LIVE'] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export const SYNC_RUN_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

/**
 * Contributor boundary. BUYER_ONLY evidence is never visible to target
 * contributors; a deal lead may explicitly share an item.
 */
export const EVIDENCE_VISIBILITIES = ['BUYER_ONLY', 'SHARED'] as const;
export type EvidenceVisibility = (typeof EVIDENCE_VISIBILITIES)[number];

export const EVIDENCE_EDGE_TYPES = ['SUPERSEDES', 'DERIVED_FROM'] as const;
export type EvidenceEdgeType = (typeof EVIDENCE_EDGE_TYPES)[number];

/** Exact position of a record inside its source, e.g. one row of one CSV file. */
export type SourceLocator =
  | {
      readonly kind: 'csv_row';
      readonly dataset: string;
      /** 1-based data row number, excluding the header row. */
      readonly row: number;
    }
  | {
      /** One exact commit of one repository; never file contents. */
      readonly kind: 'git_commit';
      readonly repository: string;
      readonly commitSha: string;
    }
  | {
      /** One record of a provider API, e.g. a Jira issue or sprint. */
      readonly kind: 'provider_record';
      readonly system: string;
      readonly site: string;
      readonly resource: string;
      readonly id: string;
    };

/** Human-readable position of a locator, for lineage and citation display. */
export function describeLocator(locator: SourceLocator): string {
  switch (locator.kind) {
    case 'csv_row':
      return `${locator.dataset} row ${locator.row}`;
    case 'git_commit':
      return `${locator.repository} @ ${locator.commitSha.slice(0, 12)}`;
    case 'provider_record':
      return `${locator.system} ${locator.site} ${locator.resource} ${locator.id}`;
  }
}

/**
 * A provider record after normalization. Every record carries its source
 * system and source record id, so every evidence item resolves to its origin.
 */
export interface NormalizedEvidence {
  readonly evidenceType: string;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly observedAt: string | null;
  readonly canonical: Readonly<Record<string, string | null>>;
  readonly locator: SourceLocator;
  /** Verbatim source text the citation quotes; hashed, never returned to clients. */
  readonly quote: string;
}

/** A source problem surfaced explicitly instead of silently dropped or filled. */
export interface SourceIssue {
  readonly dataset: string;
  readonly row: number | null;
  readonly code:
    | 'MISSING_RECORD_ID'
    | 'DUPLICATE_RECORD_ID'
    | 'MISSING_COLUMN'
    | 'MALFORMED_CSV'
    | 'INVALID_DATE'
    | 'INVALID_VALUE'
    | 'MISSING_FIELD'
    | 'PERMISSION_DENIED';
  readonly detail: string;
}

export interface EvidencePull {
  readonly records: readonly NormalizedEvidence[];
  readonly issues: readonly SourceIssue[];
}

/**
 * Port the sync engine pulls normalized records through. Fixture and live
 * adapters implement it identically; the engine never sees the mode.
 */
export interface EvidenceSource {
  readonly provider: string;
  readonly version: string;
  pull(): Promise<EvidencePull>;
}

/** Deal roles on the buyer side of the contributor boundary. */
export function isBuyerSideRole(role: DealRole): boolean {
  return role !== 'TARGET_CONTRIBUTOR';
}

export function canSeeEvidence(role: DealRole, visibility: EvidenceVisibility): boolean {
  return visibility === 'SHARED' || isBuyerSideRole(role);
}

/**
 * Who may open the evidence browser. Target contributors may, but RLS limits
 * them to SHARED items; every other role needs EVIDENCE_READ.
 */
export function canBrowseEvidence(role: DealRole): boolean {
  return role === 'TARGET_CONTRIBUTOR' || permissionsForDealRole(role).has('EVIDENCE_READ');
}
