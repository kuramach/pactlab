import type { AiUsageRow, CostRate, HostingCostLine, StorageUsageRow } from '@pactlab/db';
import { describe, expect, it } from 'vitest';
import { linesFrom } from './cost-explorer';
import { actualSpend, meteredCost, rateOn, unallocated } from './cost-view';

const rate = (kind: CostRate['kind'], key: string, unitPrice: string, effectiveFrom: string): CostRate => ({ id: `${kind}-${key}-${effectiveFrom}`, kind, key, unitPrice, currency: 'USD', effectiveFrom, sourceNote: 'synthetic', createdAt: '2026-01-01T00:00:00.000Z' });
const MODEL = 'us.anthropic.claude-sonnet-5-5';
const ai = (over: Partial<AiUsageRow>): AiUsageRow => ({
  day: '2026-10-10',
  modelId: MODEL,
  organizationId: 'org-a',
  organizationName: 'Alpha (synthetic)',
  authMethod: 'EMAIL_CODE',
  dealId: 'deal-a',
  dealName: 'Pact A',
  userId: 'user-a',
  userEmail: 'a@alpha.example',
  runs: 1,
  inputTokens: 0,
  outputTokens: 0,
  ...over,
});

describe('Cost Explorer pages', () => {
  it('reads the environment tag and the AWS product; untagged spend is "untagged"', () => {
    const lines = linesFrom([
      {
        TimePeriod: { Start: '2026-10-01' },
        Estimated: true,
        Groups: [
          { Keys: ['pactlab:environment$prod', 'Amazon Relational Database Service'], Metrics: { UnblendedCost: { Amount: '12.345678', Unit: 'USD' } } },
          { Keys: ['pactlab:environment$', 'Tax'], Metrics: { UnblendedCost: { Amount: '1.5', Unit: 'USD' } } },
          { Keys: ['pactlab:environment$stage'], Metrics: {} },
        ],
      },
    ]);
    expect(lines).toEqual([
      { periodStart: '2026-10-01', environment: 'prod', service: 'Amazon Relational Database Service', amount: '12.345678', currency: 'USD', estimated: true },
      { periodStart: '2026-10-01', environment: 'untagged', service: 'Tax', amount: '1.5', currency: 'USD', estimated: true },
    ]);
  });
});

describe('real spend', () => {
  const line = (periodStart: string, environment: string, service: string, amount: string): HostingCostLine => ({ periodStart, environment, service, amount, currency: 'USD', estimated: false });
  it('totals by month (stacked by environment), environment and product, in exact decimals', () => {
    const view = actualSpend([
      line('2026-09-01', 'prod', 'Amazon RDS', '10.10'),
      line('2026-09-01', 'dev', 'Amazon RDS', '0.20'),
      line('2026-10-01', 'prod', 'Amazon RDS', '10.10'),
      line('2026-10-01', 'prod', 'Claude Sonnet 5.5 (Amazon Bedrock Edition)', '0.30'),
    ]);
    expect(view.total).toBe('20.70');
    expect(view.byMonth).toEqual([
      { month: '2026-09', total: '10.30', byEnvironment: { dev: '0.20', prod: '10.10' }, estimated: false },
      { month: '2026-10', total: '10.40', byEnvironment: { dev: '0.00', prod: '10.40' }, estimated: false },
    ]);
    expect(view.byEnvironment).toEqual([{ key: 'prod', label: 'prod', amount: '20.50' }, { key: 'dev', label: 'dev', amount: '0.20' }]);
    expect(view.byService[0]).toEqual({ key: 'Amazon RDS', label: 'Amazon RDS', amount: '20.40' });
    expect(view.bedrock).toHaveLength(1);
  });
});

describe('metered estimates', () => {
  const rates = [
    rate('BEDROCK_INPUT_PER_MTOK', MODEL, '3', '2026-01-01'),
    rate('BEDROCK_OUTPUT_PER_MTOK', MODEL, '15', '2026-01-01'),
    // A price change from 1 October: runs before it keep the old price.
    rate('BEDROCK_INPUT_PER_MTOK', MODEL, '2', '2026-10-01'),
    rate('S3_STORAGE_GB_MONTH', 'standard', '0.023', '2026-01-01'),
  ];

  it('uses the rate in force on the day', () => {
    expect(rateOn(rates, 'BEDROCK_INPUT_PER_MTOK', MODEL, '2026-09-30')?.unitPrice).toBe('3');
    expect(rateOn(rates, 'BEDROCK_INPUT_PER_MTOK', MODEL, '2026-10-01')?.unitPrice).toBe('2');
    expect(rateOn(rates, 'BEDROCK_INPUT_PER_MTOK', MODEL, '2025-12-31')).toBeNull();
  });

  it('prices AI by organization, pact, person and sign-in method, and storage by GB-month', () => {
    const storage: StorageUsageRow[] = [
      // 1 GiB held for 30 days = 1 GB-month.
      { organizationId: 'org-b', organizationName: 'Beta (synthetic)', authMethod: 'AUTH0', dealId: 'deal-b', dealName: 'Pact B', userId: 'user-b', userEmail: 'b@beta.example', documents: 3, byteDays: String(1024 ** 3 * 30) },
    ];
    const view = meteredCost({
      ai: [
        ai({ day: '2026-09-15', inputTokens: 1_000_000, outputTokens: 100_000 }), // 3 + 1.5
        ai({ day: '2026-10-15', inputTokens: 500_000, outputTokens: 0, runs: 2 }), // 1
        ai({ organizationId: 'org-b', organizationName: 'Beta (synthetic)', authMethod: 'AUTH0', dealId: 'deal-b', dealName: 'Pact B', userId: null, userEmail: null, inputTokens: 250_000, outputTokens: 0 }), // 0.5
      ],
      storage,
      rates,
      periodEnd: '2026-10-31',
    });
    expect(view).toMatchObject({ ai: '6.00', storage: '0.02', total: '6.02', missingRates: [] });
    expect(view.byOrganization.map((row) => [row.label, row.detail, row.total])).toEqual([
      ['Alpha (synthetic)', 'Email code', '5.50'],
      ['Beta (synthetic)', 'Company SSO', '0.52'],
    ]);
    expect(view.byPact.find((row) => row.key === 'deal-a')).toMatchObject({ runs: 3, inputTokens: 1_500_000, ai: '5.50' });
    expect(view.byPerson.find((row) => row.key === 'unknown')).toMatchObject({ label: 'Before per-person tracking', ai: '0.50' });
    expect(view.byAuthMethod.map((row) => [row.label, row.total])).toEqual([['Email code', '5.50'], ['Company SSO', '0.52']]);
    expect(view.byOrganization[1]?.gbMonths).toBe('1');
  });

  it('counts usage without a rate and names the missing rate, never guessing a price', () => {
    const view = meteredCost({ ai: [ai({ modelId: 'us.anthropic.claude-opus-5-5', inputTokens: 10, outputTokens: 10 })], storage: [], rates, periodEnd: '2026-10-31' });
    expect(view.ai).toBe('0.00');
    expect(view.byModel[0]).toMatchObject({ inputTokens: 10, outputTokens: 10 });
    expect(view.missingRates).toEqual(['BEDROCK_INPUT_PER_MTOK us.anthropic.claude-opus-5-5', 'BEDROCK_OUTPUT_PER_MTOK us.anthropic.claude-opus-5-5']);
  });

  it('the shared line is what AWS billed minus what is metered', () => {
    expect(unallocated('100.00', '6.02')).toBe('93.98');
  });
});
