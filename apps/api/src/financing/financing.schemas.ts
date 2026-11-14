import { ESCROW_DISPOSITIONS, TRANCHE_KINDS, TRANCHE_STATUSES } from '@pactlab/calculations';
import { z } from 'zod';

/** Request shapes of the financing endpoints (T-117). Money is a decimal string with its currency. */
const money = z.string().regex(/^\d{1,18}(\.\d{1,2})?$/).refine((value) => Number(value) > 0, 'More than zero');
const currency = z.string().regex(/^[A-Z]{3}$/);
const day = z.iso.date();

export const dealParamsSchema = z.strictObject({ dealId: z.uuid() });
export const trancheParamsSchema = z.strictObject({ dealId: z.uuid(), trancheId: z.uuid() });
export const documentParamsSchema = z.strictObject({ dealId: z.uuid(), documentId: z.uuid() });
export const planParamsSchema = z.strictObject({ dealId: z.uuid(), planId: z.uuid() });

export const planSchema = z.strictObject({ commitmentExpectedBy: day.nullable(), buyerNote: z.string().trim().max(2000).default('') });
export type PlanBody = z.infer<typeof planSchema>;

export const trancheSchema = z.strictObject({
  kind: z.enum(TRANCHE_KINDS),
  amount: money,
  currency,
  status: z.enum(TRANCHE_STATUSES),
  label: z.string().trim().max(120).default(''),
  buyerNote: z.string().trim().max(2000).default(''),
});
export type TrancheBody = z.infer<typeof trancheSchema>;

export const financingDocumentSchema = z.strictObject({
  purpose: z.enum(['PROOF_OF_FUNDS', 'PRE_QUALIFICATION', 'COMMITMENT_LETTER', 'SBA_PRE_QUALIFICATION', 'ESCROW_RECEIPT', 'BUYER_FINANCIALS', 'OTHER']),
  trancheId: z.uuid().nullable().default(null),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.literal('application/pdf'),
  // 10 MB of bytes is at most ~14 MB of base64.
  contentBase64: z.string().min(1).max(14_000_000),
});
export type FinancingDocumentBody = z.infer<typeof financingDocumentSchema>;

export const shareSchema = z.strictObject({ shared: z.boolean() });

export const escrowSchema = z.strictObject({
  amount: money,
  currency,
  holderKind: z.enum(['TITLE_COMPANY', 'ATTORNEY', 'BROKER', 'OTHER']),
  holderName: z.string().trim().min(2).max(160),
  depositDueOn: day.nullable(),
  hardOn: day.nullable(),
  refundConditions: z.string().trim().max(2000).default(''),
});
export type EscrowBody = z.infer<typeof escrowSchema>;

export const depositSchema = z.strictObject({ depositedOn: day, reference: z.string().trim().min(1).max(200), proofDocumentId: z.uuid().nullable().default(null) });
export type DepositBody = z.infer<typeof depositSchema>;
export const disputeSchema = z.strictObject({ note: z.string().trim().min(3).max(1000) });
export const dispositionSchema = z.strictObject({ disposition: z.enum(ESCROW_DISPOSITIONS) });
