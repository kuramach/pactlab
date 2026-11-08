import { z } from 'zod';

export const sideParamsSchema = z.strictObject({ dealId: z.uuid(), side: z.enum(['BUYER', 'SELLER']) });
export const signatoryBodySchema = z.strictObject({ userId: z.uuid() });
export type SignatoryBody = z.infer<typeof signatoryBodySchema>;

export const closeBatchParamsSchema = z.strictObject({ dealId: z.uuid(), batchId: z.uuid() });
export const esignBodySchema = z.strictObject({ agreementDocumentId: z.uuid().nullable().default(null) });
export type EsignBody = z.infer<typeof esignBodySchema>;

const money = z.string().regex(/^\d{1,18}(\.\d{1,2})?$/);

export const closingItemBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('CONDITION'), title: z.string().trim().min(2).max(200), ownerSide: z.enum(['BUYER', 'SELLER']) }),
  /** Funds transfer: the buyer pays outside Pactlab and records it; the seller confirms receipt. */
  z.strictObject({ kind: z.literal('FUNDS'), title: z.string().trim().min(2).max(200), amount: money, currency: z.string().regex(/^[A-Z]{3}$/) }),
]);
export type ClosingItemBody = z.infer<typeof closingItemBodySchema>;
export const itemParamsSchema = z.strictObject({ dealId: z.uuid(), itemId: z.uuid() });
export const paidBodySchema = z.strictObject({
  paidOn: z.iso.date(),
  reference: z.string().trim().min(1).max(120),
  proofDocumentId: z.uuid().nullable().default(null),
});
export type PaidBody = z.infer<typeof paidBodySchema>;
export const disputeBodySchema = z.strictObject({ note: z.string().trim().min(3).max(1000) });
export type DisputeBody = z.infer<typeof disputeBodySchema>;
export const docusignCallbackSchema = z.strictObject({ code: z.string().min(1).max(2000), state: z.string().min(1).max(500) });
