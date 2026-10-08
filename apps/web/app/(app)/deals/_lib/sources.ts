import type { DealSource } from './api';

/** Plain-language provider names for the Sources view. */
export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  csv: 'Billing & KPI export',
  github: 'GitHub',
  jira: 'Jira',
  billing_upload: 'Billing export (uploaded)',
};

export type SourceHealth = 'synced' | 'issues' | 'failed' | 'never';

/**
 * Health is stated in words and never by colour alone (spec visual system).
 * `issues` means the source synced but reported gaps it did not fill.
 */
export function sourceHealth(source: Pick<DealSource, 'lastSyncRun'>): SourceHealth {
  const run = source.lastSyncRun;
  if (!run) return 'never';
  if (run.status === 'FAILED') return 'failed';
  if (run.status !== 'SUCCEEDED') return 'never';
  return run.issuesCount > 0 ? 'issues' : 'synced';
}

export const HEALTH_TEXT: Readonly<Record<SourceHealth, string>> = {
  synced: 'Synced',
  issues: 'Synced with source issues',
  failed: 'Last sync failed',
  never: 'Not synced yet',
};

/** Why a sync failed, without exposing provider payloads. */
export function failureHint(errorClass: string | null): string {
  if (errorClass === 'GitHubAdapterError' || errorClass === 'JiraAdapterError')
    return 'The provider refused the read — usually a missing permission on the installation.';
  return 'The sync stopped before writing evidence. Retry, or check the connection.';
}
