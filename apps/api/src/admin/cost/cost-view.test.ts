import type { HostingCostLine } from '@pactlab/db';
import { describe, expect, it } from 'vitest';
import { linesFrom } from './cost-explorer';
import { actualSpend, unallocated } from './cost-view';


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

describe('the shared line', () => {
  it('is what AWS billed minus what is metered', () => {
    expect(unallocated('100.00', '6.02')).toBe('93.98');
  });
});
