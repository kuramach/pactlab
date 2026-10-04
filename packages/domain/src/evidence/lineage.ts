import type {
  ConnectionMode,
  EvidenceEdgeType,
  EvidenceVisibility,
  SourceLocator,
  SyncRunStatus,
} from './types';

/** API view of one evidence item. Raw provider payloads are never included. */
export interface EvidenceItemView {
  readonly id: string;
  readonly dealId: string;
  readonly evidenceType: string;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly observedAt: string | null;
  readonly contentHash: string;
  readonly visibility: EvidenceVisibility;
  readonly connectionId: string;
  readonly createdAt: string;
  readonly canonical: Readonly<Record<string, string | null>>;
}

export interface EvidenceLineage {
  readonly evidence: EvidenceItemView;
  /** Exact pointer into the source and the hash of the quoted source text. */
  readonly citations: readonly {
    readonly id: string;
    readonly locator: SourceLocator;
    readonly quoteHash: string;
  }[];
  readonly syncRun: {
    readonly id: string;
    readonly connectorVersion: string;
    readonly status: SyncRunStatus;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  };
  readonly lastSeenSyncRunId: string;
  readonly connection: {
    readonly id: string;
    readonly provider: string;
    readonly displayName: string;
    readonly mode: ConnectionMode;
  };
  /** Other versions / derivations reachable through evidence edges (both directions). */
  readonly related: readonly {
    readonly evidenceId: string;
    readonly edgeType: EvidenceEdgeType;
    readonly direction: 'OUTGOING' | 'INCOMING';
    readonly depth: number;
  }[];
}

export interface LineageStep {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

/**
 * Ordered trail from the source system down to the evidence item, as shown in
 * the evidence browser. Pure presentation of the stored lineage record.
 */
export function lineageTrail(lineage: EvidenceLineage): LineageStep[] {
  const { evidence, connection, syncRun, citations } = lineage;
  const citation = citations[0];
  return [
    {
      label: 'Source system',
      value: evidence.sourceSystem,
      detail: `Record ${evidence.sourceRecordId}`,
    },
    {
      label: 'Connection',
      value: connection.displayName,
      detail: `${connection.provider} · ${connection.mode} mode`,
    },
    {
      label: 'Sync run',
      value: syncRun.id,
      detail: `Connector ${syncRun.connectorVersion} · ${syncRun.status}${syncRun.completedAt ? ` · ${syncRun.completedAt}` : ''}`,
    },
    {
      label: 'Citation',
      value: citation ? `${citation.locator.dataset} row ${citation.locator.row}` : 'Missing',
      detail: citation
        ? `Quote sha256 ${citation.quoteHash.slice(0, 12)}…`
        : 'No resolvable citation',
    },
    {
      label: 'Evidence',
      value: evidence.evidenceType,
      detail: `Content sha256 ${evidence.contentHash.slice(0, 12)}…`,
    },
  ];
}
