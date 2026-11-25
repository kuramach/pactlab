import { pageQuerySchema } from '@pactlab/contracts';
import { MUSIC_ITEM_KINDS } from '@pactlab/domain';
import { z } from 'zod';

/** A figure as the document writes it, without %, currency or separators. */
const figure = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, 'A plain number as the document writes it, e.g. 50 or 412500');
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date as YYYY-MM-DD');
const text = z.string().trim().min(1).max(200);

/** The hold period the termination analysis runs on; absent, a stated hold or the pack's default. */
export const catalogQuerySchema = z.strictObject({ holdYears: z.coerce.number().int().min(1).max(30).optional() });
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const worksQuerySchema = pageQuerySchema.extend({ holdYears: z.coerce.number().int().min(1).max(30).optional() }).strict();
export type WorksQuery = z.infer<typeof worksQuerySchema>;

export const itemsQuerySchema = pageQuerySchema.extend({ status: z.enum(['PROPOSED', 'CONFIRMED', 'REJECTED']).optional() }).strict();
export type ItemsQuery = z.infer<typeof itemsQuerySchema>;

export const extractBodySchema = z.strictObject({ documentId: z.uuid() });
export type ExtractBody = z.infer<typeof extractBodySchema>;

/** A register entry entered by hand: still cited, and its figure and date year must be in the quote. */
export const itemBodySchema = z.strictObject({
  documentId: z.uuid(),
  pageNumber: z.number().int().min(1).max(10_000),
  quote: z.string().trim().min(12).max(600),
  kind: z.enum(MUSIC_ITEM_KINDS),
  work: text.nullable(),
  detail: text.nullable(),
  value: figure.nullable(),
  date: isoDate.nullable(),
});
export type ItemBody = z.infer<typeof itemBodySchema>;

export const decisionBodySchema = z.strictObject({
  decision: z.enum(['CONFIRM', 'REJECT']),
  /** On confirm, a corrected reading; the figure and the date's year must still be in the cited quote. */
  work: text.nullable().optional(),
  detail: text.nullable().optional(),
  value: figure.nullable().optional(),
  date: isoDate.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type DecisionBody = z.infer<typeof decisionBodySchema>;

export const itemParamsSchema = z.strictObject({ dealId: z.uuid(), itemId: z.uuid() });
