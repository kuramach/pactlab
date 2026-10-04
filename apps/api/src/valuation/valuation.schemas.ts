import {
  ADJUSTMENT_POINTS,
  SENSITIVITY_VARIABLES,
} from '@pactlab/calculations';
import { z } from 'zod';
import { SUBMISSION_DECISIONS } from './valuation.repository';

/** Decimal strings only; the engine applies the per-field bounds. */
const decimal = z.string().regex(/^-?\d{1,18}(\.\d{1,12})?$/);

const methodSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('ARR_MULTIPLE'), arr: decimal, multiple: decimal }),
  z.strictObject({
    method: z.literal('DCF'),
    baseRevenue: decimal,
    years: z
      .array(z.strictObject({ growth: decimal, fcfMargin: decimal }))
      .min(1)
      .max(10),
    discountRate: decimal,
    terminal: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('GORDON'), growth: decimal }),
      z.strictObject({ kind: z.literal('EXIT_MULTIPLE'), revenueMultiple: decimal }),
    ]),
  }),
]);

const axisSchema = z.strictObject({
  variable: z.enum(SENSITIVITY_VARIABLES),
  values: z.array(decimal).min(1).max(9),
});

export const scenarioAssumptionsSchema = z.strictObject({
  assumptions: methodSchema,
  bridge: z.strictObject({
    cash: decimal,
    debt: decimal,
    debtLikeItems: decimal,
    workingCapitalAdjustment: decimal,
  }),
  stockConsiderationShare: decimal.default('0'),
  findingLinks: z
    .array(z.strictObject({ findingId: z.uuid(), point: z.enum(ADJUSTMENT_POINTS) }))
    .max(50)
    .default([]),
  lbo: z
    .strictObject({
      entryEbitda: decimal,
      leverageMultiple: decimal,
      exitEbitda: decimal,
      exitMultiple: decimal,
      holdYears: z.number().int().min(1).max(15),
      debtRepaid: decimal,
    })
    .nullable()
    .default(null),
  accretionDilution: z
    .strictObject({
      acquirerNetIncome: decimal,
      acquirerShares: decimal,
      acquirerSharePrice: decimal,
      targetNetIncome: decimal,
      pretaxSynergies: decimal,
      taxRate: decimal,
      cashInterestRate: decimal,
    })
    .nullable()
    .default(null),
  sensitivity: z.strictObject({ rows: axisSchema, columns: axisSchema }).nullable().default(null),
});

export const createScenarioSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  /** Defaults to the deal's base currency. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  values: scenarioAssumptionsSchema,
});
export type CreateScenarioBody = z.infer<typeof createScenarioSchema>;

export const updateAssumptionsSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  values: scenarioAssumptionsSchema,
});
export type UpdateAssumptionsBody = z.infer<typeof updateAssumptionsSchema>;

export const versionedCommandSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export type VersionedCommandBody = z.infer<typeof versionedCommandSchema>;

export const decideSubmissionSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  decision: z.enum(SUBMISSION_DECISIONS),
  rationale: z.string().trim().min(1).max(4_000),
});
export type DecideSubmissionBody = z.infer<typeof decideSubmissionSchema>;

export const scenarioParamsSchema = z.strictObject({ dealId: z.uuid(), scenarioId: z.uuid() });
export const submissionParamsSchema = z.strictObject({
  dealId: z.uuid(),
  scenarioId: z.uuid(),
  submissionId: z.uuid(),
});
