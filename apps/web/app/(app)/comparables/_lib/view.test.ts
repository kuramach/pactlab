import { describe, expect, it } from 'vitest';
import { describeAskPlacement, describePlacement, describeSet, driverSignal, formatMultiple, fractionToPercentLabel, ordinal } from './view';

describe('comparables view helpers', () => {
  it('formats multiples and percentages without floating point', () => {
    expect(formatMultiple('4.00')).toBe('4.0×');
    expect(formatMultiple('5.04')).toBe('5.04×');
    expect(fractionToPercentLabel('0.2500')).toBe('25%');
    expect(fractionToPercentLabel('1.0850')).toBe('108.5%');
    expect(fractionToPercentLabel('-0.0350')).toBe('-3.5%');
    expect(fractionToPercentLabel(null)).toBe('—');
  });

  it('describes the set and placements in plain words', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(23)).toBe('23rd');
    expect(describeSet({ count: 16, filter: { companyType: 'SOFTWARE_SAAS', years: 5, synthetic: 'include' } })).toBe('16 software comparables from the last 5 years');
    expect(describeSet({ count: 1, filter: { companyType: 'ALL', years: 0, synthetic: 'include' } })).toBe('1 comparable of any date');
    expect(describePlacement({ multiple: '4.00', percentile: 27, position: 'MID' })).toBe('4.0× sits at the 27th percentile — in the middle half');
    expect(describeAskPlacement({ multiple: '5.04', percentile: 56, position: 'HIGH' })).toBe('The ask implies 5.04× — the 56th percentile, in the upper quarter');
  });

  it('summarizes drivers as a signal, not a decision', () => {
    const d = (comparison: 'STRONGER' | 'SIMILAR' | 'WEAKER' | null) => ({ key: 'NRR' as const, target: '1', median: '1', reportedBy: 3, comparison });
    expect(driverSignal([d('WEAKER'), d('WEAKER'), d('STRONGER')])).toBe('LOWER');
    expect(driverSignal([d('STRONGER'), d('SIMILAR')])).toBe('UPPER');
    expect(driverSignal([d('STRONGER'), d('WEAKER')])).toBe('MIXED');
    expect(driverSignal([d(null)])).toBeNull();
  });
});
