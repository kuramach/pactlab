import {
  createCsvEvidenceSource,
  normalizeCsv,
  type EvidenceSource,
  type NormalizedEvidence,
} from '@pactlab/domain';
import {
  boundedLimit,
  type ConnectionScope,
  type DryRunResult,
  type ProviderAdapter,
  type ValidationCheck,
  type ValidationResult,
} from '../contract';
import { INVOICE_LINE_COLUMNS, invoiceLineMapping, STRIPE_PROVIDER } from './invoice-line';

export const STRIPE_FIXTURE_VERSION = 'stripe-fixture-1';

/** Dry-run samples expose normalized fields only; verbatim source text stays server-side. */
export type StripeSample = Omit<NormalizedEvidence, 'quote'>;

export interface StripeFixtureOptions {
  /** Invoice-line export datasets, e.g. `TroubledCo/stripe-invoice-lines.csv`. */
  readonly datasets: readonly string[];
  /** Allow-listed fixture loader; rejects anything outside the synthetic tree. */
  readonly load: (dataset: string) => Promise<string>;
}

/**
 * Stripe invoice lines replayed from synthetic fixtures. Produces exactly the
 * normalized evidence a live Stripe pull produces; downstream code never
 * branches on mode.
 */
export class StripeFixtureAdapter implements ProviderAdapter<StripeSample> {
  readonly provider = STRIPE_PROVIDER;
  readonly mode = 'FIXTURE' as const;
  readonly version = STRIPE_FIXTURE_VERSION;

  constructor(private readonly options: StripeFixtureOptions) {}

  async validateConnection(_scope: ConnectionScope): Promise<ValidationResult> {
    let readable = this.options.datasets.length > 0;
    let mapped = readable;
    for (const dataset of this.options.datasets) {
      try {
        const text = await this.options.load(dataset);
        const header = (text.split(/\r?\n/, 1)[0] ?? '').split(',');
        if (!INVOICE_LINE_COLUMNS.every((column) => header.includes(column))) mapped = false;
        const { issues } = normalizeCsv(this.provider, invoiceLineMapping(dataset), text);
        if (
          issues.some((issue) => issue.code === 'MALFORMED_CSV' || issue.code === 'MISSING_COLUMN')
        )
          mapped = false;
      } catch {
        readable = false;
        mapped = false;
      }
    }
    const checks: ValidationCheck[] = [
      {
        name: 'reachability',
        status: readable ? 'PASS' : 'FAIL',
        detail: readable
          ? `${this.options.datasets.length} fixture dataset(s) readable`
          : 'One or more datasets are not available fixtures',
      },
      { name: 'credentials', status: 'SKIPPED', detail: 'Fixture mode uses no credentials' },
      { name: 'scopes', status: 'SKIPPED', detail: 'Fixture mode requires no provider scopes' },
      {
        name: 'mappings',
        status: mapped ? 'PASS' : 'FAIL',
        detail: mapped
          ? 'Invoice-line columns mapped'
          : 'Required invoice-line columns are missing or files are malformed',
      },
    ];
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  async dryRun(
    _scope: ConnectionScope,
    options: { limit: number },
  ): Promise<DryRunResult<StripeSample>> {
    const limit = boundedLimit(options.limit);
    const { records } = await this.evidenceSource().pull();
    return {
      sample: records.slice(0, limit).map(({ quote: _quote, ...record }) => record),
      truncated: records.length > limit,
    };
  }

  /** The same normalized records the sync engine ingests. */
  evidenceSource(): EvidenceSource {
    return createCsvEvidenceSource({
      provider: this.provider,
      version: this.version,
      datasets: this.options.datasets.map(invoiceLineMapping),
      load: this.options.load,
    });
  }
}
