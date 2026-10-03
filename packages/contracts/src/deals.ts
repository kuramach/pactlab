import { TRANSACTION_TYPES } from '@pactlab/domain';
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
