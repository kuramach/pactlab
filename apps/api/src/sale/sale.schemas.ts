import { z } from 'zod';

const money = z.string().trim().regex(/^\d{1,18}(\.\d{1,4})?$/, 'A positive amount, up to 4 decimals');

export const saleParamsSchema = z.strictObject({ dealId: z.uuid() });
export const bidParamsSchema = z.strictObject({ dealId: z.uuid(), bidId: z.uuid() });
export const questionParamsSchema = z.strictObject({ dealId: z.uuid(), questionId: z.uuid() });

/** The seller's settings: deadline, the shared view every bidder reads, and the NDA. */
export const updateProcessSchema = z.strictObject({
  offerDeadline: z.iso.datetime().nullable().optional(),
  sharedSummary: z.string().trim().max(8000).nullable().optional(),
  dataRoomUrl: z.url({ protocol: /^https$/ }).max(2000).nullable().optional(),
  ndaText: z.string().trim().max(20000).nullable().optional(),
});
export type UpdateProcessBody = z.infer<typeof updateProcessSchema>;

export const addBidSchema = z.strictObject({ firmName: z.string().trim().min(1).max(200) });
export type AddBidBody = z.infer<typeof addBidSchema>;

export const inviteBidderSchema = z.strictObject({ email: z.email().max(320).transform((value) => value.trim().toLowerCase()) });
export type InviteBidderBody = z.infer<typeof inviteBidderSchema>;

export const answerSchema = z.strictObject({
  answer: z.string().trim().min(1).max(8000),
  /** PRIVATE: only the asking bidder. ALL: every bidder, without naming who asked. */
  scope: z.enum(['PRIVATE', 'ALL']),
});
export type AnswerBody = z.infer<typeof answerSchema>;

export const askSchema = z.strictObject({ question: z.string().trim().min(3).max(4000) });
export type AskBody = z.infer<typeof askSchema>;

export const offerSchema = z.strictObject({
  price: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** For an investment round: the pre-money valuation offered. */
  preMoney: money.nullable().optional(),
  structure: z.string().trim().min(3).max(4000),
  conditions: z.string().trim().max(4000).nullable().optional(),
  validUntil: z.iso.date().nullable().optional(),
});
export type OfferBody = z.infer<typeof offerSchema>;

export const passSchema = z.strictObject({ reason: z.string().trim().max(2000).nullable().optional() });
export type PassBody = z.infer<typeof passSchema>;
