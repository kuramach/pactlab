import { describe, expect, it } from 'vitest';
import { computeSaasMetrics } from '../metrics/metrics';
import { ENGINE_VALUATION_METHODS } from '../valuation/engine';
import { VALUATION_METHODS } from '../valuation/types';
import { METRIC_CALCULATORS, SAAS_METRICS_CALCULATOR } from './calculators';

describe('pack calculators and valuation methods', () => {
  it('the engine runs exactly the declared valuation methods', () => {
    expect([...ENGINE_VALUATION_METHODS].sort()).toEqual([...VALUATION_METHODS].sort());
  });

  it('the SaaS calculator is the existing engine, unchanged', () => {
    expect(Object.keys(METRIC_CALCULATORS)).toEqual(['saas-metrics', 'multifamily-metrics']);
    const input = {
      lines: [],
      fxRates: [],
      baseCurrency: 'USD',
      asOfMonth: '2026-09',
    };
    expect(SAAS_METRICS_CALCULATOR.compute(input)).toEqual(computeSaasMetrics(input));
    expect(SAAS_METRICS_CALCULATOR.version).toBe('saas-metrics-1');
  });
});
