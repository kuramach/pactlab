import type { ConnectionRecord } from '@pactlab/db';
import { CsvFixtureAdapter } from './adapters/csv-fixture.adapter';

export type ResolvedAdapter = CsvFixtureAdapter;

/** Providers a connection may be created for. */
export const SUPPORTED_PROVIDERS = ['csv'] as const;

function datasetsOf(config: unknown): string[] {
  const datasets = (config as { datasets?: unknown } | null)?.datasets;
  return Array.isArray(datasets)
    ? datasets.filter((value): value is string => typeof value === 'string')
    : [];
}

/**
 * The only place that looks at (provider, mode). Everything downstream sees
 * the normalized adapter contract. Live CSV (uploaded files) is not built yet.
 */
export function resolveAdapter(
  connection: Pick<ConnectionRecord, 'provider' | 'mode' | 'config'>,
): ResolvedAdapter | null {
  if (connection.provider === 'csv' && connection.mode === 'FIXTURE')
    return new CsvFixtureAdapter(datasetsOf(connection.config));
  return null;
}
