import { z } from 'zod';

/** Persisted, audited per deal. Downstream logic never branches on mode. */
export const CONNECTION_MODES = ['FIXTURE', 'LIVE'] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];
export const connectionModeSchema = z.enum(CONNECTION_MODES);

export interface ConnectionScope {
  readonly organizationId: string;
  readonly dealId: string;
  readonly connectionId: string;
  /** Reference to a secret in the managed store — never the secret itself. */
  readonly credentialRef: string | null;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIPPED';

export interface ValidationCheck {
  readonly name: 'reachability' | 'credentials' | 'scopes' | 'mappings';
  readonly status: CheckStatus;
  /** Safe, non-secret explanation suitable for the onboarding UI. */
  readonly detail: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly checks: readonly ValidationCheck[];
}

export interface DryRunResult<TRecord> {
  /** Bounded, read-only sample. A dry run never writes evidence or changes conclusions. */
  readonly sample: readonly TRecord[];
  readonly truncated: boolean;
}

/**
 * One normalized interface per provider family. Fixture and live adapters
 * implement the same contract; switching mode changes credentials and mode only.
 */
export interface ProviderAdapter<TRecord> {
  readonly provider: string;
  readonly mode: ConnectionMode;
  validateConnection(scope: ConnectionScope): Promise<ValidationResult>;
  dryRun(scope: ConnectionScope, options: { limit: number }): Promise<DryRunResult<TRecord>>;
}

export const DRY_RUN_MAX_LIMIT = 50;

export function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Dry-run limit must be a positive integer');
  return Math.min(limit, DRY_RUN_MAX_LIMIT);
}
