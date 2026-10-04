import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { computeCohorts } from './cohorts';
import { FxTable } from './fx';
import { buildRevenueLedger } from './ledger';
import {
  computeSaasMetrics,
  prepareWorkspace,
  type MetricKey,
  type SaasMetricsReport,
} from './metrics';
import { draftFindingFor, reconcileArr, severityFor } from './reconcile';
import type { FxRateInput, RevenueLineInput, SourceRef } from './types';

let counter = 0;
function ref(id: string): SourceRef {
  return { evidenceId: `ev-${id}`, sourceRecordId: id, citationId: `cit-${id}` };
}

function line(
  overrides: Partial<RevenueLineInput> & { customerId: string; month?: string },
): RevenueLineInput {
  counter += 1;
  const { month = '2026-09', ...rest } = overrides;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const lineId = rest.lineId ?? `il_${String(counter).padStart(5, '0')}`;
  return {
    ref: ref(lineId),
    lineId,
    invoiceId: `in_${counter}`,
    customerName: `${rest.customerId} (synthetic)`,
    subscriptionId: `sub_${rest.customerId}`,
    currency: 'USD',
    amount: '100.00',
    interval: 'month',
    intervalCount: '1',
    periodStart: `${month}-01`,
    periodEnd: `${next}-01`,
    status: 'paid',
    ...rest,
  };
}

function fx(quote: string, rate: string, date: string): FxRateInput {
  return {
    ref: ref(`fx-${quote}-${date}`),
    baseCurrency: 'EUR',
    quoteCurrency: quote,
    rate,
    rateDate: date,
    source: 'ECB',
  };
}

function metric(report: SaasMetricsReport, key: MetricKey) {
  const found = report.metrics.find((m) => m.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
}

describe('FX table', () => {
  const { table, issues } = FxTable.fromRates([
    fx('USD', '1.1700', '2026-09-30'),
    fx('GBP', '0.8660', '2026-09-30'),
    fx('USD', '1.1720', '2026-08-31'),
    { ...fx('USD', '1.1', '2026-09-29'), baseCurrency: 'USD' },
    fx('CHF', 'abc', '2026-09-30'),
  ]);

  it('cross-converts through the euro with a recorded ten-place rate', () => {
    const lookup = table.rate('GBP', 'USD', '2026-09-30');
    expect(lookup).toMatchObject({
      ok: true,
      rate: { rate: '1.3510392610', rateDate: '2026-09-30', source: 'ECB' },
    });
    if (lookup.ok)
      expect(lookup.rate.refs.map((r) => r.sourceRecordId)).toEqual([
        'fx-GBP-2026-09-30',
        'fx-USD-2026-09-30',
      ]);
  });

  it('uses the fixing in force on the date, never a later one', () => {
    expect(table.rate('EUR', 'USD', '2026-09-15')).toMatchObject({
      ok: false,
      reason: 'STALE_FX_RATE',
    });
    expect(table.rate('EUR', 'USD', '2026-09-05')).toMatchObject({
      ok: true,
      rate: { rate: '1.1720000000', rateDate: '2026-08-31' },
    });
    expect(table.rate('EUR', 'USD', '2026-08-30')).toMatchObject({
      ok: false,
      reason: 'NO_FX_RATE',
    });
    expect(table.rate('USD', 'USD', '2020-01-01')).toMatchObject({
      ok: true,
      rate: { rate: '1', refs: [] },
    });
  });

  it('reports invalid rate rows instead of using them', () => {
    expect(issues.map((issue) => issue.reason)).toEqual(['INVALID_FX_RATE', 'INVALID_FX_RATE']);
  });
});

describe('revenue ledger', () => {
  it('normalizes annual lines to monthly and measures at month-end', () => {
    const ledger = buildRevenueLedger([
      line({
        customerId: 'a',
        amount: '1200.00',
        interval: 'year',
        periodStart: '2026-01-20',
        periodEnd: '2027-01-20',
      }),
    ]);
    expect(ledger.entries[0]).toMatchObject({ firstMonth: '2026-01', lastMonth: '2026-12' });
    expect(ledger.entries[0]?.monthlyAmount.toFixed()).toBe('100');
  });

  it('excludes, and explains, everything that is not contracted recurring revenue', () => {
    const base = line({ customerId: 'a', lineId: 'il_00000' });
    const ledger = buildRevenueLedger([
      base,
      { ...line({ customerId: 'a' }), subscriptionId: base.subscriptionId, invoiceId: 'in_other' },
      line({ customerId: 'b', status: 'void' }),
      line({ customerId: 'c', status: 'uncollectible' }),
      line({ customerId: 'd', interval: null, intervalCount: null }),
      line({ customerId: 'e', amount: null }),
      line({ customerId: 'f', currency: null }),
      line({ customerId: 'g', periodEnd: null }),
      line({ customerId: 'h', amount: '-5.00' }),
      line({ customerId: 'i', interval: 'week' }),
      line({ customerId: 'j', amount: '1e3' }),
      { ...line({ customerId: 'k' }), customerId: null },
      line({ customerId: 'l', status: 'refunded' }),
    ]);
    expect(ledger.entries.map((entry) => entry.lineId)).toEqual(['il_00000']);
    expect(ledger.exclusions.map((e) => e.reason).sort()).toEqual(
      [
        'DUPLICATE_LINE',
        'INVALID_AMOUNT',
        'INVALID_PERIOD',
        'INVOICE_UNCOLLECTIBLE',
        'INVOICE_VOID',
        'MISSING_AMOUNT',
        'MISSING_CURRENCY',
        'MISSING_CUSTOMER',
        'NON_POSITIVE_AMOUNT',
        'NON_RECURRING',
        'UNKNOWN_STATUS',
        'UNSUPPORTED_INTERVAL',
      ].sort(),
    );
  });

  it('is independent of input order', () => {
    const lines = [
      line({ customerId: 'a' }),
      line({ customerId: 'b', amount: '50.10' }),
      line({ customerId: 'a', amount: '0.20' }),
    ];
    const forward = computeSaasMetrics({
      lines,
      fxRates: [],
      baseCurrency: 'USD',
      asOfMonth: '2026-09',
    });
    const reverse = computeSaasMetrics({
      lines: [...lines].reverse(),
      fxRates: [],
      baseCurrency: 'USD',
      asOfMonth: '2026-09',
    });
    expect(reverse).toEqual(forward);
    expect(metric(forward, 'MRR').value).toBe('150.30');
  });
});

describe('SaaS metrics', () => {
  // a: steady 100; b: 100 → 150; c: 200 → 120; d: churns in Sep; e: new in Sep; f: returns in Sep.
  const months = ['2025-09', '2025-10', '2026-07', '2026-08', '2026-09'];
  const lines: RevenueLineInput[] = [];
  for (const month of months) {
    lines.push(line({ customerId: 'a', month }));
    lines.push(line({ customerId: 'b', month, amount: month === '2026-09' ? '150.00' : '100.00' }));
    lines.push(line({ customerId: 'c', month, amount: month === '2026-09' ? '120.00' : '200.00' }));
    if (month !== '2026-09') lines.push(line({ customerId: 'd', month, amount: '50.00' }));
  }
  lines.push(line({ customerId: 'e', month: '2026-09', amount: '80.00' }));
  lines.push(line({ customerId: 'f', month: '2025-10', amount: '30.00' }));
  lines.push(line({ customerId: 'f', month: '2026-09', amount: '40.00' }));
  const input = { lines, fxRates: [], baseCurrency: 'USD', asOfMonth: '2026-09' };
  const report = computeSaasMetrics(input);

  it('computes MRR, ARR, customers and ARPA with their inputs', () => {
    expect(metric(report, 'MRR').value).toBe('490.00');
    expect(metric(report, 'ARR').value).toBe('5880.00');
    expect(metric(report, 'ACTIVE_CUSTOMERS').value).toBe('5');
    expect(metric(report, 'ARPA').value).toBe('98.00');
    expect(metric(report, 'ARR').inputs).toHaveLength(5);
    expect(metric(report, 'ARR').formula).toBe('MRR × 12');
  });

  it('builds the month-over-month MRR bridge', () => {
    expect(report.bridge).toMatchObject({
      opening: { amount: '450.00' },
      newMrr: { amount: '80.00' },
      expansion: { amount: '50.00' },
      contraction: { amount: '80.00' },
      churned: { amount: '50.00' },
      reactivation: { amount: '40.00' },
      closing: { amount: '490.00' },
    });
    const bridge = report.bridge!;
    const m = (value: { amount: string }) => Money.of(value.amount, 'USD');
    const rolled = m(bridge.opening)
      .add(m(bridge.newMrr))
      .add(m(bridge.expansion))
      .add(m(bridge.reactivation))
      .subtract(m(bridge.contraction))
      .subtract(m(bridge.churned));
    expect(rolled.toFixed()).toBe(bridge.closing.amount);
  });

  it('computes trailing-twelve-month NRR, GRR and logo retention', () => {
    // Year-ago set {a, b, c, d} = 450; now 100 + 150 + 120 + 0 = 370; GRR uses min: 100 + 100 + 120 = 320.
    expect(metric(report, 'NRR').value).toBe('0.8222');
    expect(metric(report, 'GRR').value).toBe('0.7111');
    expect(metric(report, 'LOGO_RETENTION').value).toBe('0.7500');
  });

  it('reports retention as unavailable without twelve months of history', () => {
    const short = computeSaasMetrics({
      ...input,
      lines: lines.filter((l) => l.periodStart! >= '2026-07'),
    });
    expect(metric(short, 'NRR')).toMatchObject({
      value: null,
      unavailableReason: expect.stringContaining('2025-09'),
    });
  });

  it('computes customer concentration', () => {
    expect(metric(report, 'TOP_CUSTOMER_SHARE').value).toBe('0.3061');
    expect(metric(report, 'TOP_5_CUSTOMER_SHARE').value).toBe('1.0000');
    expect(report.customers[0]).toMatchObject({
      customerId: 'b',
      arr: { amount: '1800.00' },
      share: '0.3061',
    });
  });

  it('builds revenue cohorts', () => {
    const cohorts = computeCohorts(input);
    const opening = cohorts.rows[0]!;
    expect(opening).toMatchObject({
      cohort: '2025-09',
      openingBalance: true,
      customers: 4,
      startingMrr: { amount: '450.00' },
    });
    expect(opening.cells.at(-1)).toMatchObject({
      month: '2026-09',
      revenueRetention: '0.8222',
      logoRetention: '0.7500',
    });
    expect(cohorts.rows.find((row) => row.cohort === '2026-09')).toMatchObject({
      customers: 1,
      openingBalance: false,
    });
  });

  it('converts each month at that month-end fixing and lists unconvertible lines', () => {
    const gbp = computeSaasMetrics({
      lines: [
        line({ customerId: 'uk', currency: 'GBP', amount: '1000.00' }),
        line({ customerId: 'ca', currency: 'CAD' }),
      ],
      fxRates: [
        fx('USD', '1.1700', '2026-09-30'),
        fx('GBP', '0.8660', '2026-09-30'),
        fx('USD', '1.0000', '2026-10-30'),
        fx('GBP', '1.0000', '2026-10-30'),
      ],
      baseCurrency: 'USD',
      asOfMonth: '2026-09',
    });
    expect(metric(gbp, 'MRR').value).toBe('1351.04');
    expect(gbp.customers[0]?.contributions[0]).toMatchObject({
      original: { amount: '1000.00', currency: 'GBP' },
      converted: { amount: '1351.04', currency: 'USD' },
      fx: { rate: '1.3510392610', rateDate: '2026-09-30' },
    });
    expect(gbp.exclusions).toEqual([
      expect.objectContaining({ reason: 'NO_FX_RATE', customerId: 'ca', month: '2026-09' }),
    ]);
  });
});

describe('ARR reconciliation', () => {
  const lines = [
    line({ customerId: 'a', amount: '1000.00' }),
    line({ customerId: 'b', amount: '5000.00', status: 'void' }),
    line({
      customerId: 'c',
      amount: '9000.00',
      interval: null,
      intervalCount: null,
      periodStart: '2026-09-15',
      periodEnd: '2026-09-15',
    }),
  ];
  const input = { lines, fxRates: [], baseCurrency: 'USD', asOfMonth: '2026-09' };
  const reported = (value: string | null) => ({
    ref: ref('kpi-arr'),
    period: '2026-Q3',
    value,
    currency: 'USD',
  });
  const run = (value: string | null, overrides = input) => {
    const ws = prepareWorkspace(overrides);
    return reconcileArr(ws, computeSaasMetrics(overrides, ws), reported(value));
  };

  it('reconciles within tolerance without a finding', () => {
    const result = run('12100.00');
    expect(result).toMatchObject({
      status: 'RECONCILED',
      calculated: { amount: '12000.00' },
      delta: { amount: '-100.00' },
      deltaRatio: '-0.0083',
    });
    expect(draftFindingFor(result)).toBeNull();
  });

  it('turns a difference into a cited draft finding that explains the gap', () => {
    const result = run('81000.00');
    expect(result).toMatchObject({
      status: 'DIFFERENCE',
      delta: { amount: '-69000.00' },
      deltaRatio: '-0.8519',
    });
    expect(result.explanation).toEqual([
      expect.objectContaining({
        reason: 'INVOICE_VOID',
        basis: 'ANNUALIZED_MRR',
        amount: { amount: '60000.00', currency: 'USD' },
      }),
      expect.objectContaining({
        reason: 'NON_RECURRING',
        basis: 'BILLED_AMOUNT',
        amount: { amount: '9000.00', currency: 'USD' },
      }),
    ]);
    const finding = draftFindingFor(result)!;
    expect(finding).toMatchObject({
      status: 'DRAFT',
      severity: 'CRITICAL',
      requiresHumanReview: true,
      reconciliationId: result.reconciliationId,
    });
    expect(finding.title).toBe('Reported ARR exceeds billing-supported ARR by 85.19%');
    expect(finding.evidence[0]).toMatchObject({
      evidenceId: 'ev-kpi-arr',
      citationId: 'cit-kpi-arr',
    });
    expect(finding.evidence.map((e) => e.evidenceId)).toHaveLength(4);
    expect(finding.evidence.every((e) => e.citationId)).toBe(true);
  });

  it('changes its id when any input changes', () => {
    const first = run('81000.00');
    expect(run('81000.00').reconciliationId).toBe(first.reconciliationId);
    expect(run('81000.01').reconciliationId).not.toBe(first.reconciliationId);
    const changed = { ...input, lines: [...lines, line({ customerId: 'z' })] };
    expect(run('81000.00', changed).reconciliationId).not.toBe(first.reconciliationId);
  });

  it('cannot reconcile a missing reported value', () => {
    expect(run(null).status).toBe('REPORTED_VALUE_MISSING');
    const ws = prepareWorkspace(input);
    expect(reconcileArr(ws, computeSaasMetrics(input, ws), null).status).toBe('NO_REPORTED_FIGURE');
  });

  it('grades severity by relative size', () => {
    expect(['0.02', '-0.07', '0.3', '-0.9'].map(severityFor)).toEqual([
      'LOW',
      'MEDIUM',
      'HIGH',
      'CRITICAL',
    ]);
  });
});
