import { BUYER_PERSONAS } from '@pactlab/calculations';
import { z } from 'zod';

export const personaBodySchema = z.strictObject({ persona: z.enum(BUYER_PERSONAS).nullable() });
export type PersonaBody = z.infer<typeof personaBodySchema>;

export const evaluateBodySchema = z.strictObject({ persona: z.enum(BUYER_PERSONAS) });
export type EvaluateBody = z.infer<typeof evaluateBodySchema>;

export const sellerNotesBodySchema = z.strictObject({
  notes: z.array(z.strictObject({ ordinal: z.number().int().min(0).max(100), sellerNote: z.string().trim().max(1000) })).max(100),
});
export type SellerNotesBody = z.infer<typeof sellerNotesBodySchema>;

/** The seller's answer to proposed terms: per term, accept, reject or counter with an amount. */
export const termResponsesBodySchema = z.strictObject({
  responses: z
    .array(
      z
        .strictObject({
          ordinal: z.number().int().min(0).max(100),
          decision: z.enum(['ACCEPT', 'REJECT', 'COUNTER']),
          counterAmount: z.string().regex(/^\d{1,18}(\.\d{1,2})?$/).optional(),
          note: z.string().trim().max(1000).default(''),
        })
        .refine((response) => (response.decision === 'COUNTER') === (response.counterAmount !== undefined), 'A counter needs an amount, and only a counter has one'),
    )
    .min(1)
    .max(100),
});
export type TermResponsesBody = z.infer<typeof termResponsesBodySchema>;

const TERM_LEVERS = ['PURCHASE_PRICE', 'PRICE_REDUCTION', 'REMEDIATION_COST', 'ESCROW', 'INDEMNITY', 'RETENTION', 'EARNOUT', 'SELLER_FINANCING'] as const;

/** A version the seller drafts (T-107): the purchase price first, then any terms they ask for. */
export const sellerDraftBodySchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  terms: z
    .array(z.strictObject({ lever: z.enum(TERM_LEVERS), amount: z.string().regex(/^\d{1,18}(\.\d{1,2})?$/), note: z.string().trim().max(1000).default('') }))
    .min(1)
    .max(20),
});
export type SellerDraftBody = z.infer<typeof sellerDraftBodySchema>;

export const evaluationParamsSchema = z.strictObject({ dealId: z.uuid(), evaluationId: z.uuid() });
export const batchParamsSchema = z.strictObject({ dealId: z.uuid(), batchId: z.uuid() });
