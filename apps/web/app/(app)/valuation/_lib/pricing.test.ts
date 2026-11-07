import { describe, expect, it } from 'vitest';
import { formatDelta, latestByPersona, type EvaluationView } from './pricing';

describe('pricing view (T-105)', () => {
  it('formats compare deltas with a sign, and zero as same', () => {
    expect(formatDelta('1250000.00')).toMatch(/^\+1,250,000/);
    expect(formatDelta('-400000.00')).toMatch(/^−400,000/);
    expect(formatDelta('0.00')).toBe('same');
    expect(formatDelta(undefined)).toBe('same');
  });

  it('lines up the newest evaluation per persona, in persona order', () => {
    const evaluation = (id: string, persona: EvaluationView['persona']) => ({ id, persona }) as EvaluationView;
    const newestFirst = [evaluation('g2', 'GRAVE_DANCER'), evaluation('q1', 'QUALITY_COMPOUNDER'), evaluation('g1', 'GRAVE_DANCER')];
    expect(latestByPersona(newestFirst, ['QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER']).map((entry) => entry.id)).toEqual(['q1', 'g2']);
  });
});
