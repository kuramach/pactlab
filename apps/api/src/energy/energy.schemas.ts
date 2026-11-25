import { pageQuerySchema } from '@pactlab/contracts';
import { ENERGY_ITEM_KINDS } from '@pactlab/domain';
import { z } from 'zod';

/** A figure as the document writes it, without %, currency, units or separators. */
const figure = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, 'A plain number as the document writes it, e.g. 12 or 42000000');
const text = z.string().trim().min(1).max(200);
const holdYears = z.coerce.number().int().min(1).max(30).optional();

/** The hold period the lease and PPA analyses run on; absent, a stated hold or the pack's default. */
export const energyQuerySchema = z.strictObject({ holdYears });
export type EnergyQuery = z.infer<typeof energyQuerySchema>;

export const assetsQuerySchema = pageQuerySchema.extend({ holdYears }).strict();
export type AssetsQuery = z.infer<typeof assetsQuerySchema>;

export const itemsQuerySchema = pageQuerySchema.extend({ status: z.enum(['PROPOSED', 'CONFIRMED', 'REJECTED']).optional() }).strict();
export type ItemsQuery = z.infer<typeof itemsQuerySchema>;

export const extractBodySchema = z.strictObject({ documentId: z.uuid() });
export type ExtractBody = z.infer<typeof extractBodySchema>;

/** An entry typed by hand: still cited, and its figure must be in the quote. */
export const itemBodySchema = z.strictObject({
  documentId: z.uuid(),
  pageNumber: z.number().int().min(1).max(10_000),
  quote: z.string().trim().min(12).max(600),
  kind: z.enum(ENERGY_ITEM_KINDS),
  asset: text.nullable(),
  detail: z.string().trim().min(1).max(40).nullable(),
  value: figure,
});
export type ItemBody = z.infer<typeof itemBodySchema>;

export const decisionBodySchema = z.strictObject({
  decision: z.enum(['CONFIRM', 'REJECT']),
  /** On confirm, a corrected reading; the figure must still be in the cited quote. */
  asset: text.nullable().optional(),
  detail: z.string().trim().min(1).max(40).nullable().optional(),
  value: figure.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type DecisionBody = z.infer<typeof decisionBodySchema>;

export const itemParamsSchema = z.strictObject({ dealId: z.uuid(), itemId: z.uuid() });
