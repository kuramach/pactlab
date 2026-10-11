import { COMPANY_TYPES } from '@pactlab/domain';
import { z } from 'zod';
import { isoCurrencySchema } from './common';

export const COMPARABLE_KINDS = ['PRECEDENT_TRANSACTION', 'PUBLIC_PEER', 'OWN_DEAL'] as const;
export const COMPARABLE_ORIGINS = ['OWN_DEAL', 'ENTERED', 'PROVIDER', 'SYNTHETIC'] as const;
export const MULTIPLE_VERDICTS = ['IN_RANGE', 'HIGH', 'LOW'] as const;

const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

/** Money typed by people: thousands separators allowed, stored as a decimal string above zero. */
const positiveMoney = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().replaceAll(',', '') : value),
  z
    .string()
    .regex(/^\d{1,18}(\.\d{1,4})?$/, 'An amount such as 25000000 or 25,000,000')
    .refine((amount) => !/^0*(\.0*)?$/.test(amount), 'Must be above zero'),
);

/**
 * A percentage typed by people ("25", "25%", "-3.5") as a fraction decimal
 * string ("0.25"). The decimal point is moved in the string: no floating point.
 */
export function percentToFraction(input: string): string | null {
  const match = /^(-?)(\d{1,4})(?:\.(\d{1,2}))?%?$/.exec(input.trim());
  if (!match) return null;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const digits = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const padded = digits.padStart(5, '0');
  const integer = padded.slice(0, -4).replace(/^0+(?=\d)/, '');
  const value = `${integer}.${padded.slice(-4)}`;
  return /^0\.0000$/.test(value) ? '0.0000' : `${sign}${value}`;
}

const percentInput = z.preprocess(
  (value) => {
    if (typeof value !== 'string' || value.trim() === '') return value === '' ? null : value;
    return percentToFraction(value) ?? value;
  },
  z.string().regex(/^-?\d{1,2}\.\d{4}$/, 'A percentage such as 25 or 25%').nullable().default(null),
);

/** A comparable entered by a person. Its source is mandatory; the origin is set by the server. */
export const comparableInputSchema = z.strictObject({
  kind: z.enum(['PRECEDENT_TRANSACTION', 'PUBLIC_PEER']),
  name: z.string().trim().min(1).max(200),
  targetName: z.string().trim().min(1).max(200),
  acquirerName: z.preprocess(blankToNull, z.string().trim().max(200).nullable().default(null)),
  announcedOn: z.preprocess(blankToNull, z.iso.date().nullable().default(null)),
  companyType: z.enum(COMPANY_TYPES),
  region: z.preprocess(blankToNull, z.string().trim().max(100).nullable().default(null)),
  enterpriseValue: positiveMoney,
  arr: positiveMoney,
  currency: isoCurrencySchema,
  arrGrowth: percentInput,
  nrr: percentInput,
  grr: percentInput,
  sourceCitation: z.string().trim().min(3, 'Say where this comparable comes from').max(1000),
  sourceUrl: z.preprocess(blankToNull, z.url({ protocol: /^https$/ }).max(2000).nullable().default(null)),
});
export type ComparableEntry = z.infer<typeof comparableInputSchema>;

export const comparableParamsSchema = z.strictObject({ comparableId: z.uuid() });

/** Which comparables a benchmark uses. Defaults: the seller's company type, the last five years, synthetic included. */
export const benchmarkFilterSchema = z.object({
  companyType: z.enum([...COMPANY_TYPES, 'ALL']).optional(),
  years: z.coerce.number().int().min(0).max(30).default(5),
  synthetic: z.enum(['include', 'exclude']).default('include'),
});
export type BenchmarkFilter = z.infer<typeof benchmarkFilterSchema>;

export const benchmarkQuerySchema = benchmarkFilterSchema.extend({ scenarioId: z.uuid().optional() });
export type BenchmarkQuery = z.infer<typeof benchmarkQuerySchema>;

/** The deal lead's judgement of the asking price, made against a specific benchmark. */
export const multipleJudgementInputSchema = z.strictObject({
  verdict: z.enum(MULTIPLE_VERDICTS),
  rationale: z.string().trim().min(3, 'Say why, in a sentence').max(2000),
  scenarioId: z.uuid().optional(),
  companyType: z.enum([...COMPANY_TYPES, 'ALL']).optional(),
  years: z.coerce.number().int().min(0).max(30).default(5),
  synthetic: z.enum(['include', 'exclude']).default('include'),
});
export type MultipleJudgementInput = z.infer<typeof multipleJudgementInputSchema>;

export interface ComparableView {
  id: string;
  kind: (typeof COMPARABLE_KINDS)[number];
  origin: (typeof COMPARABLE_ORIGINS)[number];
  name: string;
  targetName: string;
  acquirerName: string | null;
  announcedOn: string | null;
  companyType: (typeof COMPANY_TYPES)[number];
  region: string | null;
  enterpriseValue: string;
  arr: string;
  currency: string;
  /** EV ÷ ARR, two decimal places. */
  multiple: string;
  arrGrowth: string | null;
  nrr: string | null;
  grr: string | null;
  sourceCitation: string | null;
  sourceUrl: string | null;
  provider: string | null;
  providerVersion: string | null;
  sourceDealId: string | null;
  status: 'ACTIVE' | 'RETIRED';
  recordedBy: string;
  recordedAt: string;
}

export interface MultiplePlacementView {
  multiple: string;
  percentile: number;
  position: 'BELOW_RANGE' | 'LOW' | 'MID' | 'HIGH' | 'ABOVE_RANGE';
}

export interface MultipleJudgementView {
  id: string;
  verdict: (typeof MULTIPLE_VERDICTS)[number];
  rationale: string;
  askingVersion: number | null;
  askingMultiple: string | null;
  benchmarkVersion: string;
  comparableSetHash: string;
  comparableCount: number;
  decidedBy: string;
  decidedByName: string | null;
  decidedAt: string;
  /** False when the ask or the comparable set has changed since. */
  current: boolean;
}

export interface BenchmarkView {
  version: string;
  filter: { companyType: (typeof COMPANY_TYPES)[number] | 'ALL'; years: number; synthetic: 'include' | 'exclude' };
  /** The scenario the multiple came from, if any. */
  scenario: { id: string; name: string; method: 'ARR_MULTIPLE' | 'DCF'; status: string } | null;
  target: {
    arr: { amount: string; currency: string } | null;
    arrSource: 'SCENARIO' | 'METRICS' | null;
    arrGrowth: string | null;
    nrr: string | null;
    grr: string | null;
    asOfMonth: string | null;
  };
  asking: { version: number; amount: string; currency: string; basis: 'ENTERPRISE_VALUE' | 'EQUITY_VALUE' } | null;
  count: number;
  syntheticCount: number;
  byOrigin: Record<(typeof COMPARABLE_ORIGINS)[number], number>;
  sufficient: boolean;
  stats: { min: string; p25: string; median: string; p75: string; max: string } | null;
  chosen: MultiplePlacementView | null;
  askingImplied: MultiplePlacementView | null;
  drivers: { key: 'ARR_GROWTH' | 'NRR' | 'GRR'; target: string | null; median: string | null; reportedBy: number; comparison: 'STRONGER' | 'SIMILAR' | 'WEAKER' | null }[];
  comparables: ComparableView[];
  comparableSetHash: string;
  judgement: MultipleJudgementView | null;
  canJudge: boolean;
  /** Whether this deal can be (or already is) one of the firm's own precedents. */
  ownDeal: { eligible: boolean; added: boolean };
}
