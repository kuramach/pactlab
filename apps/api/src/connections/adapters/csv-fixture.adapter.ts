import {
  boundedLimit,
  type ConnectionScope,
  type DryRunResult,
  type ProviderAdapter,
  type ValidationResult,
} from '@pactlab/connectors';
import {
  loadSyntheticManifest,
  readSyntheticDataset,
  SYNTHETIC_COMPANIES,
  type SyntheticCompany,
} from '@pactlab/db';
import {
  createCsvEvidenceSource,
  normalizeCsv,
  type CsvDatasetMapping,
  type EvidenceSource,
} from '@pactlab/domain';
import type { EvidenceSample } from './evidence-sample';

export const CSV_FIXTURE_VERSION = 'csv-fixture-1';

/** Dry-run samples expose normalized fields only; verbatim source text stays server-side. */
export type CsvSample = EvidenceSample;

function companyOf(dataset: string): SyntheticCompany | null {
  const company = dataset.split('/')[0];
  return (SYNTHETIC_COMPANIES as readonly string[]).includes(company ?? '')
    ? (company as SyntheticCompany)
    : null;
}

/**
 * CSV evidence from the synthetic fixture tree. Column mappings come from the
 * company manifest, so the fixture adapter returns exactly the normalized
 * shape a live CSV source returns.
 */
export class CsvFixtureAdapter implements ProviderAdapter<CsvSample> {
  readonly provider = 'csv';
  readonly mode = 'FIXTURE' as const;
  readonly version = CSV_FIXTURE_VERSION;

  constructor(private readonly datasets: readonly string[]) {}

  private async mappings(): Promise<{ mappings: CsvDatasetMapping[]; unknown: string[] }> {
    const mappings: CsvDatasetMapping[] = [];
    const unknown: string[] = [];
    for (const dataset of this.datasets) {
      const company = companyOf(dataset);
      const mapping = company
        ? (await loadSyntheticManifest(company)).datasets.find((entry) => entry.dataset === dataset)
        : undefined;
      if (mapping) mappings.push(mapping);
      else unknown.push(dataset);
    }
    return { mappings, unknown };
  }

  async validateConnection(_scope: ConnectionScope): Promise<ValidationResult> {
    const { mappings, unknown } = await this.mappings();
    let readable = unknown.length === 0 && mappings.length > 0;
    let mapped = readable;
    for (const mapping of mappings) {
      try {
        const { issues } = normalizeCsv(
          this.provider,
          mapping,
          await readSyntheticDataset(mapping.dataset),
        );
        if (
          issues.some((issue) => issue.code === 'MISSING_COLUMN' || issue.code === 'MALFORMED_CSV')
        )
          mapped = false;
      } catch {
        readable = false;
        mapped = false;
      }
    }
    const checks = [
      {
        name: 'reachability' as const,
        status: readable ? ('PASS' as const) : ('FAIL' as const),
        detail: readable
          ? `${mappings.length} fixture dataset(s) readable`
          : 'One or more datasets are not available fixtures',
      },
      {
        name: 'credentials' as const,
        status: 'SKIPPED' as const,
        detail: 'Fixture mode uses no credentials',
      },
      {
        name: 'scopes' as const,
        status: 'SKIPPED' as const,
        detail: 'Fixture mode requires no provider scopes',
      },
      {
        name: 'mappings' as const,
        status: mapped ? ('PASS' as const) : ('FAIL' as const),
        detail: mapped
          ? 'Record id and date columns mapped'
          : 'Required columns are missing or files are malformed',
      },
    ];
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  async dryRun(
    _scope: ConnectionScope,
    options: { limit: number },
  ): Promise<DryRunResult<CsvSample>> {
    const limit = boundedLimit(options.limit);
    const { records } = await (await this.evidenceSource()).pull();
    return {
      sample: records.slice(0, limit).map(({ quote: _quote, ...record }) => record),
      truncated: records.length > limit,
    };
  }

  /** The same normalized records the sync engine ingests. */
  async evidenceSource(_scope?: ConnectionScope): Promise<EvidenceSource> {
    const { mappings, unknown } = await this.mappings();
    if (unknown.length > 0) throw new Error('Connection references unknown fixture datasets');
    return createCsvEvidenceSource({
      provider: this.provider,
      version: this.version,
      datasets: mappings,
      load: readSyntheticDataset,
    });
  }
}
