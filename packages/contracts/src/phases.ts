import type { POST_CLOSE_KINDS } from '@pactlab/domain';
import { CLAIM_STATUSES, POST_CLOSE_STATUSES, REVIEW_CADENCES, SCREENING_VERDICTS } from '@pactlab/domain';
import { z } from 'zod';
import { isoCurrencySchema } from './common';

const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);
const money = z.preprocess(
  (value) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim().replaceAll(',', '')) : value),
  z.string().regex(/^\d{1,18}(\.\d{1,4})?$/, 'An amount such as 25000000 or 25,000,000').nullable().default(null),
);
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));

/** Pre-Diligence intake: deliberately light, screening-grade only. */
export const screeningInputSchema = z
  .strictObject({
    intakeNotes: text(5000),
    headlineRevenue: money,
    headlineCurrency: z.preprocess(blankToNull, isoCurrencySchema.nullable().default(null)),
    valueLow: money,
    valueHigh: money,
    redFlags: z.array(z.string().trim().min(3).max(300)).max(30).default([]),
    expectedVersion: z.coerce.number().int().min(0),
  })
  .refine((value) => value.valueLow === null || value.valueHigh === null || Number(value.valueLow) <= Number(value.valueHigh), {
    path: ['valueHigh'],
    message: 'The high end must be at least the low end',
  });
export type ScreeningInput = z.infer<typeof screeningInputSchema>;

export const screeningVerdictSchema = z.strictObject({
  verdict: z.enum(SCREENING_VERDICTS),
  rationale: z.string().trim().min(3, 'Say why, in a sentence').max(2000),
  gaps: text(2000),
});
export type ScreeningVerdictInput = z.infer<typeof screeningVerdictSchema>;

export interface ScreeningView {
  dealId: string;
  stage: string;
  intakeNotes: string | null;
  headlineRevenue: string | null;
  headlineCurrency: string | null;
  valueLow: string | null;
  valueHigh: string | null;
  redFlags: { id: string; text: string }[];
  verdict: (typeof SCREENING_VERDICTS)[number] | null;
  rationale: string | null;
  gaps: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  version: number;
  /** The current asking price, for the screening-grade sanity view. */
  askingPrice: { amount: string; currency: string; basis: string } | null;
  canEdit: boolean;
  canDecide: boolean;
}

export const createClaimSchema = z.strictObject({
  statement: z.string().trim().min(3).max(1000),
  source: text(300),
});
export const updateClaimSchema = z.strictObject({
  expectedVersion: z.coerce.number().int().min(1),
  status: z.enum(CLAIM_STATUSES),
  rationale: text(2000),
  evidenceItemIds: z.array(z.uuid()).max(50).default([]),
  findingIds: z.array(z.uuid()).max(50).default([]),
});
export type CreateClaimInput = z.infer<typeof createClaimSchema>;
export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;

export interface ClaimView {
  id: string;
  statement: string;
  source: string | null;
  origin: 'SCREENING_RED_FLAG' | 'MANUAL' | 'PACK_RULE';
  status: (typeof CLAIM_STATUSES)[number];
  rationale: string | null;
  evidenceItemIds: string[];
  findings: { id: string; title: string; status: string }[];
  version: number;
  updatedByName: string | null;
  updatedAt: string;
}

export const updatePostCloseItemSchema = z.strictObject({
  expectedVersion: z.coerce.number().int().min(1),
  status: z.enum(POST_CLOSE_STATUSES),
  ownerUserId: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
  dueDate: z.preprocess(blankToNull, z.iso.date().nullable().default(null)),
  cadence: z.preprocess(blankToNull, z.enum(REVIEW_CADENCES).nullable().default(null)),
  note: text(2000),
});
export type UpdatePostCloseItemInput = z.infer<typeof updatePostCloseItemSchema>;

export interface PostCloseItemView {
  id: string;
  kind: (typeof POST_CLOSE_KINDS)[number];
  sourceType: 'FINDING';
  sourceId: string;
  title: string;
  action: string;
  ownerUserId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  cadence: (typeof REVIEW_CADENCES)[number] | null;
  status: (typeof POST_CLOSE_STATUSES)[number];
  note: string | null;
  version: number;
}

export interface PostCloseView {
  items: PostCloseItemView[];
  members: { userId: string; displayName: string }[];
  canEdit: boolean;
}

export const claimParamsSchema = z.strictObject({ dealId: z.uuid(), claimId: z.uuid() });
export const postCloseParamsSchema = z.strictObject({ dealId: z.uuid(), itemId: z.uuid() });
