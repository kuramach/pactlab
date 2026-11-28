import { DEAL_PHASES, OWNERSHIPS, PARTY_ROLES, TRANSACTION_TYPES } from '@pactlab/domain';
import { z } from 'zod';
import { pageQuerySchema } from './pagination';
import { isoCurrencySchema, uuidSchema } from './common';

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

/** The languages a pact can work in (T-174b): its emails and generated documents when the reader chose none. */
export const WORKING_LANGUAGES = ['en', 'de', 'fr', 'ja'] as const;
export type WorkingLanguage = (typeof WORKING_LANGUAGES)[number];
export const workingLanguageSchema = z.enum(WORKING_LANGUAGES);
/** A stored working language as the contract's type; anything else (never written: a CHECK holds it) reads as none. */
export const workingLanguageOf = (value: string | null | undefined): WorkingLanguage | null =>
  (WORKING_LANGUAGES as readonly string[]).includes(value ?? '') ? (value as WorkingLanguage) : null;

export const dealSummarySchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string(),
  targetName: z.string(),
  transactionType: transactionTypeSchema,
  stage: z.string(),
  /** Pre-Diligence, Diligence or Post-Close, derived from the stage (T-071). */
  phase: z.enum(DEAL_PHASES),
  status: z.string(),
  baseCurrency: isoCurrencySchema,
  /** T-174b: null follows the organization's default (English until one is stored). */
  workingLanguage: workingLanguageSchema.nullable().optional(),
  createdAt: z.iso.datetime(),
  /** Buyer and seller, when the deal was started as a Pact (list responses only). */
  parties: z
    .array(
      z.object({
        role: z.enum(PARTY_ROLES),
        name: z.string(),
        ownership: z.enum(OWNERSHIPS),
        ticker: z.string().nullable(),
      }),
    )
    .optional(),
  /** Current asking price, buyer side only (list responses only). */
  askingPrice: z
    .object({ amount: z.string(), currency: z.string(), basis: z.enum(['ENTERPRISE_VALUE', 'EQUITY_VALUE']) })
    .nullable()
    .optional(),
  /** The caller's own role on the deal (list responses only): who may delete it. */
  myRole: z.string().nullable().optional(),
  /** BUYER or SELLER: who opened the pact (T-097). */
  initiatedBy: z.string().optional(),
});
export type DealSummary = z.infer<typeof dealSummarySchema>;

/** My deals, a page at a time (T-126): searched by name or target, narrowed by phase in the database. */
export const listDealsQuerySchema = pageQuerySchema
  .extend({
    q: z.string().trim().min(1).max(200).optional(),
    phase: z.enum(['PRE', 'DILIGENCE', 'POST']).optional(),
  })
  .strict();
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

export const listDealsResponseSchema = z.object({
  items: z.array(dealSummarySchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
  limit: z.number().int(),
});

/** Counts for the home page across every pact. */
export interface DealsSummaryView {
  total: number;
  active: number;
  byStage: Record<string, number>;
}
export type ListDealsResponse = z.infer<typeof listDealsResponseSchema>;

export const dealParamsSchema = z.strictObject({ dealId: uuidSchema });
