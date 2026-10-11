import { describe, expect, it } from 'vitest';
import { comparableInputSchema, multipleJudgementInputSchema, percentToFraction } from './comparables';

const valid = {
  kind: 'PRECEDENT_TRANSACTION',
  name: 'Precedent A',
  targetName: 'Example Target',
  companyType: 'SOFTWARE_SAAS',
  enterpriseValue: '42,000,000',
  arr: '10000000',
  currency: 'USD',
  arrGrowth: '25%',
  nrr: '108',
  grr: '',
  sourceCitation: 'Press release, 2025-03-01',
  sourceUrl: '',
};

describe('comparable contracts', () => {
  it('turns typed percentages into fractions without floating point', () => {
    expect(percentToFraction('25')).toBe('0.2500');
    expect(percentToFraction('25%')).toBe('0.2500');
    expect(percentToFraction('108.5')).toBe('1.0850');
    expect(percentToFraction('-3.5')).toBe('-0.0350');
    expect(percentToFraction('0')).toBe('0.0000');
    expect(percentToFraction('abc')).toBeNull();
  });

  it('parses an entered comparable and requires its source', () => {
    expect(comparableInputSchema.parse(valid)).toMatchObject({ enterpriseValue: '42000000', arrGrowth: '0.2500', nrr: '1.0800', grr: null, sourceUrl: null, acquirerName: null });
    expect(comparableInputSchema.safeParse({ ...valid, sourceCitation: '' }).success).toBe(false);
    expect(comparableInputSchema.safeParse({ ...valid, enterpriseValue: '0' }).success).toBe(false);
    expect(comparableInputSchema.safeParse({ ...valid, sourceUrl: 'http://example.com' }).success).toBe(false);
    expect(comparableInputSchema.safeParse({ ...valid, kind: 'OWN_DEAL' }).success).toBe(false);
    expect(comparableInputSchema.safeParse({ ...valid, origin: 'SYNTHETIC' }).success).toBe(false);
  });

  it('needs a verdict and a rationale for a judgement', () => {
    expect(multipleJudgementInputSchema.parse({ verdict: 'HIGH', rationale: 'Above the range' })).toMatchObject({ years: 5, synthetic: 'include' });
    expect(multipleJudgementInputSchema.safeParse({ verdict: 'HIGH', rationale: '' }).success).toBe(false);
    expect(multipleJudgementInputSchema.safeParse({ verdict: 'MAYBE', rationale: 'x y z' }).success).toBe(false);
  });
});
