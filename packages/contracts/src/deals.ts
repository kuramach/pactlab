import { OWNERSHIPS, PARTY_ROLES, TRANSACTION_TYPES } from '@pactlab/domain';
import { z } from 'zod';
import { isoCurrencySchema, uuidSchema } from './common';

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

export const dealSummarySchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string(),
  targetName: z.string(),
  transactionType: transactionTypeSchema,
  stage: z.string(),
  status: z.string(),
  baseCurrency: isoCurrencySchema,
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
});
export type DealSummary = z.infer<typeof dealSummarySchema>;

export const listDealsQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200).optional(),
});
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

export const listDealsResponseSchema = z.object({
  items: z.array(dealSummarySchema),
});
export type ListDealsResponse = z.infer<typeof listDealsResponseSchema>;

export const dealParamsSchema = z.strictObject({ dealId: uuidSchema });
