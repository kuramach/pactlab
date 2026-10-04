import type {
  FxRateInput,
  ReportedFigure,
  RevenueLineInput,
  SourceRef,
} from '@pactlab/calculations';
import { INVOICE_LINE_EVIDENCE_TYPE, parseInvoiceLine } from '@pactlab/connectors';
import type { TransactionClient } from '@pactlab/db';

export const FX_RATE_EVIDENCE_TYPE = 'fx.rate';
export const MANAGEMENT_KPI_EVIDENCE_TYPE = 'management.kpi';

/** Upper bound on evidence rows one metrics computation reads. */
export const MAX_METRIC_EVIDENCE_ROWS = 20_000;

export class TooMuchEvidenceError extends Error {
  override name = 'TooMuchEvidenceError';
}

type Canonical = Record<string, string | null>;

interface ReportedArr extends ReportedFigure {
  readonly asOfDate: string | null;
}

/** Everything the metrics engine needs, read from current evidence under RLS. */
export interface MetricsEvidence {
  readonly baseCurrency: string;
  readonly lines: RevenueLineInput[];
  readonly fxRates: FxRateInput[];
  readonly reportedArr: ReportedArr[];
}

/**
 * Load the deal's billing, FX and management-KPI evidence. Only the newest
 * version of each source record counts; superseded versions stay in lineage.
 * Downstream code sees evidence types only, never the connection's mode.
 */
export async function loadMetricsEvidence(
  tx: TransactionClient,
  dealId: string,
): Promise<MetricsEvidence | null> {
  const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { baseCurrency: true } });
  if (!deal) return null;
  const rows = await tx.evidenceItem.findMany({
    where: {
      dealId,
      evidenceType: {
        in: [INVOICE_LINE_EVIDENCE_TYPE, FX_RATE_EVIDENCE_TYPE, MANAGEMENT_KPI_EVIDENCE_TYPE],
      },
    },
    select: {
      id: true,
      connectionId: true,
      evidenceType: true,
      sourceRecordId: true,
      canonical: true,
      citations: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
    orderBy: { id: 'asc' },
    take: MAX_METRIC_EVIDENCE_ROWS + 1,
  });
  if (rows.length > MAX_METRIC_EVIDENCE_ROWS) throw new TooMuchEvidenceError();

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    latest.set(`${row.connectionId}|${row.evidenceType}|${row.sourceRecordId}`, row);

  const evidence: MetricsEvidence = {
    baseCurrency: deal.baseCurrency,
    lines: [],
    fxRates: [],
    reportedArr: [],
  };
  for (const row of latest.values()) {
    const canonical = (row.canonical ?? {}) as Canonical;
    const ref: SourceRef = {
      evidenceId: row.id,
      sourceRecordId: row.sourceRecordId,
      citationId: row.citations[0]?.id ?? null,
    };
    if (row.evidenceType === INVOICE_LINE_EVIDENCE_TYPE) {
      const line = parseInvoiceLine(canonical);
      if (line) evidence.lines.push({ ref, ...line });
    } else if (row.evidenceType === FX_RATE_EVIDENCE_TYPE) {
      evidence.fxRates.push({
        ref,
        baseCurrency: canonical['base_currency'] ?? null,
        quoteCurrency: canonical['quote_currency'] ?? null,
        rate: canonical['rate'] ?? null,
        rateDate: canonical['rate_date'] ?? null,
        source: canonical['source'] ?? null,
      });
    } else if (canonical['metric']?.toUpperCase() === 'ARR') {
      evidence.reportedArr.push({
        ref,
        period: canonical['period'] ?? null,
        value: canonical['value'] ?? null,
        currency: canonical['currency']?.toUpperCase() ?? null,
        asOfDate: canonical['as_of'] ?? null,
      });
    }
  }
  return evidence;
}

/** The management ARR figure for the month: latest as-of date, then latest record. */
export function reportedArrFor(
  evidence: MetricsEvidence,
  asOfMonth: string,
): ReportedFigure | null {
  const matches = evidence.reportedArr
    .filter((figure) => figure.asOfDate?.slice(0, 7) === asOfMonth)
    .sort(
      (a, b) =>
        (b.asOfDate ?? '').localeCompare(a.asOfDate ?? '') ||
        b.ref.evidenceId.localeCompare(a.ref.evidenceId),
    );
  const figure = matches[0];
  return figure
    ? { ref: figure.ref, period: figure.period, value: figure.value, currency: figure.currency }
    : null;
}

/** Default as-of month: the latest management ARR report, else the latest billed month. */
export function defaultAsOfMonth(evidence: MetricsEvidence, now: Date = new Date()): string {
  const reported = evidence.reportedArr
    .map((figure) => figure.asOfDate?.slice(0, 7))
    .filter((month): month is string => !!month && /^\d{4}-\d{2}$/.test(month))
    .sort();
  const billed = evidence.lines
    .map((line) => line.periodStart?.slice(0, 7))
    .filter((month): month is string => !!month)
    .sort();
  const fallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
  return reported.at(-1) ?? billed.at(-1) ?? fallback;
}
