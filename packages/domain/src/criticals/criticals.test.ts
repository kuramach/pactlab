import { describe, expect, it } from 'vitest';
import { COMPANY_TYPES } from '../pacts/types';
import { CRITICAL_DIRECTION_MAP, CRITICAL_METRIC_IDS, CRITICAL_METRICS, criticalMetricsFor, describeStructure, formatCriticalValue, percentToRatio, structureProblem } from './registry';

describe('the criticals registry (T-179)', () => {
  it('every metric names what would settle it, and only lookback metrics take a lookback', () => {
    for (const id of CRITICAL_METRIC_IDS) expect(CRITICAL_METRICS[id].settles.length).toBeGreaterThan(10);
    expect(structureProblem({ metric: 'CAP_RATE', comparator: 'AT_LEAST', threshold: '0.06', lookbackYears: 3, evenBand: null }, 'MULTIFAMILY')).toMatch(/single figure/);
    expect(structureProblem({ metric: 'OCCUPANCY', comparator: 'AT_LEAST', threshold: '0.9', lookbackYears: 3, evenBand: '0.02' }, 'MULTIFAMILY')).toBeNull();
  });

  it('a critical can target only a metric its company type evidences; "all types" only universal ones', () => {
    expect(criticalMetricsFor('MULTIFAMILY')).toContain('CAP_RATE');
    expect(criticalMetricsFor('SOFTWARE_SAAS')).not.toContain('CAP_RATE');
    expect(criticalMetricsFor(null)).toEqual(['DSCR']);
    expect(structureProblem({ metric: 'CAP_RATE', comparator: 'AT_LEAST', threshold: '0.06', lookbackYears: null, evenBand: null }, 'SOFTWARE_SAAS')).toMatch(/cannot|not a metric/);
    for (const type of COMPANY_TYPES) expect(criticalMetricsFor(type)).toContain('DSCR');
  });

  it('Bad is −1, Good +1 (confirmation), Even and No evidence 0 and raise nothing', () => {
    expect(CRITICAL_DIRECTION_MAP.BAD).toMatchObject({ defaultDirection: -1, raisesFinding: true });
    expect(CRITICAL_DIRECTION_MAP.GOOD).toMatchObject({ defaultDirection: 1, channel: 'CONFIRMATION' });
    expect(CRITICAL_DIRECTION_MAP.EVEN.raisesFinding).toBe(false);
    expect(CRITICAL_DIRECTION_MAP.NO_EVIDENCE.raisesFinding).toBe(false);
  });

  it('reads back the confirmed structure in the organization’s units', () => {
    expect(percentToRatio('6')).toBe('0.06');
    expect(percentToRatio('5.5')).toBe('0.055');
    expect(formatCriticalValue('0.0473', 'RATIO')).toBe('4.73%');
    expect(describeStructure({ metric: 'OCCUPANCY', comparator: 'AT_LEAST', threshold: '0.9', lookbackYears: 3, evenBand: '0.02' })).toBe('Occupancy (average for the year) ≥ 90.00% in each of the last 3 years (Even within 2.00 points)');
    expect(describeStructure({ metric: 'DSCR', comparator: 'AT_LEAST', threshold: '1.25', lookbackYears: null, evenBand: null })).toBe('Debt service coverage ratio ≥ 1.25x');
  });
});
