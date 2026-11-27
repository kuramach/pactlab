import { COMPANY_TYPES, CRITICAL_COMPARATORS, CRITICAL_MAX_LOOKBACK_YEARS, CRITICAL_METRIC_IDS } from '@pactlab/domain';
import { z } from 'zod';
import { uuidSchema } from './common';
import { pageQuerySchema } from './pagination';

/**
 * Deal Criticals (T-179, ADR 0060): the org library (standards by company type) and a pact's own
 * criticals and overrides. Thresholds and bands are decimal strings in the metric's unit: a ratio is a
 * fraction (6% is "0.06"), a multiple a number ("1.25"), years a number.
 */
const decimal = z.string().trim().regex(/^-?\d{1,12}(\.\d{1,6})?$/);

export const criticalStructureSchema = z.strictObject({
  metric: z.enum(CRITICAL_METRIC_IDS),
  comparator: z.enum(CRITICAL_COMPARATORS),
  threshold: decimal,
  lookbackYears: z.number().int().min(1).max(CRITICAL_MAX_LOOKBACK_YEARS).nullable(),
  evenBand: decimal.refine((value) => !value.startsWith('-'), 'The Even band is not negative').nullable(),
});
export type CriticalStructureInput = z.infer<typeof criticalStructureSchema>;

const words = z.string().trim().min(3).max(500);

/** A new critical: the organization's words (AI proposes the structure), a structure, or both. Nothing evaluates until confirmed. */
export const createCriticalBodySchema = z
  .strictObject({ words: words.optional(), structure: criticalStructureSchema.optional() })
  .refine((body) => body.words !== undefined || body.structure !== undefined, 'Write the critical in words, as a structure, or both');
export type CreateCriticalBody = z.infer<typeof createCriticalBodySchema>;

/** An org standard also names the company type it applies to, or ALL. */
export const createOrgCriticalBodySchema = z
  .strictObject({ companyType: z.enum([...COMPANY_TYPES, 'ALL']), words: words.optional(), structure: criticalStructureSchema.optional() })
  .refine((body) => body.words !== undefined || body.structure !== undefined, 'Write the critical in words, as a structure, or both');
export type CreateOrgCriticalBody = z.infer<typeof createOrgCriticalBodySchema>;

/** Editing creates a new version, PROPOSED again until confirmed. `version` is the one being edited. */
export const reviseCriticalBodySchema = z
  .strictObject({ version: z.number().int().min(1), words: words.optional(), structure: criticalStructureSchema.optional() })
  .refine((body) => body.words !== undefined || body.structure !== undefined, 'Change the words, the structure, or both');
export type ReviseCriticalBody = z.infer<typeof reviseCriticalBodySchema>;

/** A person confirms the structure (corrected or as proposed); only then does the critical evaluate. */
export const confirmCriticalBodySchema = z.strictObject({ version: z.number().int().min(1), structure: criticalStructureSchema });
export type ConfirmCriticalBody = z.infer<typeof confirmCriticalBodySchema>;

export const retireCriticalBodySchema = z.strictObject({ version: z.number().int().min(1), reason: z.string().trim().min(3).max(500) });
export type RetireCriticalBody = z.infer<typeof retireCriticalBodySchema>;

/** Tighten, loosen or switch off an org standard for one pact, always with a reason. */
export const overrideCriticalBodySchema = z
  .strictObject({ standardKey: uuidSchema, structure: criticalStructureSchema.nullable(), disabled: z.boolean().default(false), reason: z.string().trim().min(3).max(500) })
  .refine((body) => body.disabled === (body.structure === null), 'Give the structure this pact uses, or switch the standard off');
export type OverrideCriticalBody = z.infer<typeof overrideCriticalBodySchema>;

/** Remove an override: the pact goes back to the org standard. */
export const clearOverrideBodySchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export type ClearOverrideBody = z.infer<typeof clearOverrideBodySchema>;

export const criticalParamsSchema = z.strictObject({ criticalKey: uuidSchema });
export const dealCriticalParamsSchema = z.strictObject({ dealId: uuidSchema, criticalKey: uuidSchema });

export const criticalsLibraryQuerySchema = pageQuerySchema.extend({ companyType: z.enum([...COMPANY_TYPES, 'ALL']).optional() });
export type CriticalsLibraryQuery = z.infer<typeof criticalsLibraryQuerySchema>;
