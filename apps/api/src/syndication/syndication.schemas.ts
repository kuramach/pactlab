import { OFFERING_EXEMPTIONS, OFFERING_ITEM_KINDS, OFFERING_SOURCES } from '@pactlab/domain';
import { z } from 'zod';

/** A typed amount: digits with optional thousands separators, stored as a plain decimal. */
const amount = z
  .string()
  .trim()
  .transform((value) => value.replaceAll(',', ''))
  .pipe(z.string().regex(/^\d{1,18}(\.\d{1,4})?$/, 'A plain amount, e.g. 32000000 or 32,000,000'));
/** A percent as a number (6.25 for 6.25%), optionally negative for a downside growth path. */
const percent = (signed = false) => z.string().trim().regex(signed ? /^-?\d{1,2}(\.\d{1,4})?$/ : /^\d{1,2}(\.\d{1,4})?$/, 'A percent as a number, e.g. 6.25');
/** A figure as the document writes it, without % or ×. */
const figure = z.string().trim().regex(/^\d{1,6}(\.\d{1,4})?$/, 'A plain number as the document writes it, e.g. 8 or 1.85');

export const offeringBodySchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  purchasePrice: amount,
  loanAmount: amount,
  interestRatePct: percent(),
  equityRaise: amount,
  holdYears: z.number().int().min(1).max(30),
  sellingCostsPct: percent(),
  /** Empty: read the T-12 NOI from the imported operating statement. */
  noiYear1: amount.nullable(),
  downsideNoiGrowthPct: percent(true),
  baseNoiGrowthPct: percent(true),
  upsideNoiGrowthPct: percent(true),
  downsideExitCapPct: percent(),
  baseExitCapPct: percent(),
  upsideExitCapPct: percent(),
  exemption: z.enum(OFFERING_EXEMPTIONS),
});
export type OfferingBody = z.infer<typeof offeringBodySchema>;

export const extractBodySchema = z.strictObject({ documentId: z.uuid(), source: z.enum(OFFERING_SOURCES) });
export type ExtractBody = z.infer<typeof extractBodySchema>;

/** A term or claim entered by hand: still cited, and its figures must be in the quote. */
export const itemBodySchema = z.strictObject({
  documentId: z.uuid(),
  pageNumber: z.number().int().min(1).max(10_000),
  quote: z.string().trim().min(12).max(600),
  source: z.enum(OFFERING_SOURCES),
  kind: z.enum(OFFERING_ITEM_KINDS),
  label: z.string().trim().min(1).max(160).nullable(),
  value: figure.nullable(),
  hurdle: figure.nullable(),
});
export type ItemBody = z.infer<typeof itemBodySchema>;

export const decisionBodySchema = z.strictObject({
  decision: z.enum(['CONFIRM', 'REJECT']),
  /** On confirm, a corrected reading; every figure must still be in the cited quote. */
  value: figure.nullable().optional(),
  hurdle: figure.nullable().optional(),
  label: z.string().trim().min(1).max(160).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type DecisionBody = z.infer<typeof decisionBodySchema>;

export const itemParamsSchema = z.strictObject({ dealId: z.uuid(), itemId: z.uuid() });
