import { z } from 'zod';

/**
 * Regulatory & deal certainty inputs (T-091) that are not imports: the
 * agreement's certainty terms, the remedy buyer, regulator feedback, package
 * revisions and pledges. Every entry cites the document page it comes from,
 * so findings built on it stay traceable.
 */
const date = z.iso.date();
const money = z.string().regex(/^\d{1,18}(\.\d{1,4})?$/);

export const REGULATORY_ENTRY_KINDS = ['TERMS', 'BUYER', 'FEEDBACK', 'REVISION', 'COMMITMENT'] as const;
export type RegulatoryEntryKind = (typeof REGULATORY_ENTRY_KINDS)[number];

export const termsPayloadSchema = z.strictObject({
  signedOn: date,
  outsideDate: date,
  effortsStandard: z.enum(['REASONABLE_BEST_EFFORTS', 'HELL_OR_HIGH_WATER', 'COMMERCIALLY_REASONABLE']),
  divestitureCap: z.number().int().min(0).max(1_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  terminationFees: z.array(z.strictObject({ payer: z.enum(['ACQUIRER', 'TARGET']), amount: money, trigger: z.string().trim().min(3).max(500) })).max(10),
  /** The analyst's EV/EBITDA multiple for valuing divested sites (prices the remedy-cost line); optional. */
  ebitdaMultiple: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).nullable().default(null),
});
export const buyerPayloadSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  retailSitesOperated: z.number().int().min(0).max(1_000_000),
  yearsOperatingRetail: z.number().int().min(0).max(200),
  precedents: z.array(z.strictObject({ year: z.number().int().min(1900).max(2100), note: z.string().trim().min(3).max(1000), source: z.string().trim().min(3).max(500) })).max(20),
});
export const feedbackPayloadSchema = z.strictObject({
  round: z.number().int().min(1).max(50),
  date,
  regulator: z.string().trim().min(1).max(200),
  criticisms: z.array(z.strictObject({ topic: z.string().regex(/^[A-Z][A-Z_]{1,40}$/), substance: z.string().trim().min(3).max(2000) })).min(1).max(20),
});
export const revisionPayloadSchema = z.strictObject({
  revision: z.number().int().min(1).max(100),
  date,
  addresses: z.array(z.string().regex(/^[A-Z][A-Z_]{1,40}$/)).max(20),
});
export const commitmentPayloadSchema = z.strictObject({
  text: z.string().trim().min(3).max(2000),
  measurement: z.string().trim().min(1).max(1000).nullable(),
  enforcementParty: z.string().trim().min(1).max(500).nullable(),
  durationMonths: z.number().int().min(1).max(600).nullable(),
});

export const regulatoryCitationSchema = z.strictObject({
  documentId: z.uuid(),
  pageNumber: z.number().int().min(1).max(10_000),
  /** Copied exactly from the page; checked against the stored text. */
  quote: z.string().min(12).max(1000),
});

export const createRegulatoryEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('TERMS'), payload: termsPayloadSchema, citation: regulatoryCitationSchema }),
  z.strictObject({ kind: z.literal('BUYER'), payload: buyerPayloadSchema, citation: regulatoryCitationSchema }),
  z.strictObject({ kind: z.literal('FEEDBACK'), payload: feedbackPayloadSchema, citation: regulatoryCitationSchema }),
  z.strictObject({ kind: z.literal('REVISION'), payload: revisionPayloadSchema, citation: regulatoryCitationSchema }),
  z.strictObject({ kind: z.literal('COMMITMENT'), payload: commitmentPayloadSchema, citation: regulatoryCitationSchema }),
]);
export type CreateRegulatoryEntry = z.infer<typeof createRegulatoryEntrySchema>;
export type RegulatoryCitation = z.infer<typeof regulatoryCitationSchema>;
