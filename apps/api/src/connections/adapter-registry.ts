import type { ConnectionRecord } from '@pactlab/db';
import { CsvFixtureAdapter } from './adapters/csv-fixture.adapter';
import { githubSyncAdapter, jiraSyncAdapter, type ProviderSyncAdapter } from './adapters/provider-sync.adapter';

export type ResolvedAdapter = CsvFixtureAdapter | ProviderSyncAdapter;

/** Providers a connection may be created for. */
export const SUPPORTED_PROVIDERS = ['csv', 'github', 'jira'] as const;

function datasetsOf(config: unknown): string[] {
  const datasets = (config as { datasets?: unknown } | null)?.datasets;
  return Array.isArray(datasets)
    ? datasets.filter((value): value is string => typeof value === 'string')
    : [];
}

/**
 * The only place that looks at (provider, mode). Everything downstream sees
 * the normalized adapter contract. Live CSV (uploaded files) is not built
 * yet; live GitHub and Jira adapters are configuration-only.
 */
export function resolveAdapter(
  connection: Pick<ConnectionRecord, 'provider' | 'mode' | 'config'>,
): ResolvedAdapter | null {
  switch (connection.provider) {
    case 'csv':
      return connection.mode === 'FIXTURE' ? new CsvFixtureAdapter(datasetsOf(connection.config)) : null;
    case 'github':
      return githubSyncAdapter(connection.mode, connection.config);
    case 'jira':
      return jiraSyncAdapter(connection.mode, connection.config);
    default:
      return null;
  }
}
