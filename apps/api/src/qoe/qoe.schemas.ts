import { QOE_ADJUSTMENT_CATEGORIES, QOE_INCLUSION_DECISIONS, QOE_RECURRENCE, QOE_VERIFICATION_STATUSES, QOE_WORKING_CAPITAL_COMPONENTS } from '@pactlab/domain';
import { z } from 'zod';

/** A typed figure: digits with optional thousands separators; stored as a plain decimal string. */
const figure = (signed: boolean) =>
  z
    .string()
    .trim()
    .transform((value) => value.replaceAll(',', ''))
    .pipe(z.string().regex(signed ? /^-?\d{1,18}(\.\d{1,4})?$/ : /^\d{1,18}(\.\d{1,4})?$/, 'A plain amount, e.g. 125000 or 125,000.50'));

/** Where a figure is stated: an exact quote from a stored document page, verified on entry. */
export const qoeCitationSchema = z.strictObject({ documentId: z.uuid(), pageNumber: z.number().int().min(1).max(10_000), quote: z.string().trim().min(3).max(2000) });
export type QoeCitationInput = z.infer<typeof qoeCitationSchema>;

const common = { label: z.string().trim().min(2).max(200), currency: z.string().regex(/^[A-Z]{3}$/), citation: qoeCitationSchema };
const period = z.string().trim().min(2).max(40);

export const qoeEntryBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('REPORTED_EBITDA'), period, amount: figure(true), ...common }),
  z.strictObject({
    kind: z.literal('ADJUSTMENT'),
    period,
    category: z.enum(QOE_ADJUSTMENT_CATEGORIES),
    // Signed: a positive adjustment raises EBITDA, a negative one lowers it; zero adjusts nothing.
    amount: figure(true).refine((value) => /[1-9]/.test(value), 'An adjustment of zero adjusts nothing'),
    rationale: z.string().trim().min(3).max(2000),
    ...common,
  }),
  z
    .strictObject({
      kind: z.literal('ADD_BACK'),
      period,
      category: z.enum(QOE_ADJUSTMENT_CATEGORIES),
      /** What the seller claims. Said, never merged with what was observed. */
      amount: figure(false),
      /** The seller's stated rationale. */
      rationale: z.string().trim().min(3).max(2000),
      recurrence: z.enum(QOE_RECURRENCE),
      verificationStatus: z.enum(QOE_VERIFICATION_STATUSES),
      verifiedAmount: figure(false).optional(),
      /** The evidence a verification rests on; required unless UNVERIFIED. */
      verificationCitation: qoeCitationSchema.optional(),
      ...common,
    })
    .refine((body) => (body.verificationStatus === 'PARTIALLY_VERIFIED') === (body.verifiedAmount !== undefined), 'A partially verified add-back needs the verified amount, and only it has one')
    .refine((body) => (body.verificationStatus !== 'UNVERIFIED') === (body.verificationCitation !== undefined), 'A verification cites its evidence; an unverified add-back has none'),
  z.strictObject({ kind: z.literal('WORKING_CAPITAL'), periodEnd: z.iso.date(), category: z.enum(QOE_WORKING_CAPITAL_COMPONENTS), amount: figure(false), ...common }),
]);
export type QoeEntryBody = z.infer<typeof qoeEntryBodySchema>;

export const qoeReviseBodySchema = z.strictObject({ entry: qoeEntryBodySchema, expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(500) });
export type QoeReviseBody = z.infer<typeof qoeReviseBodySchema>;

export const qoeWithdrawBodySchema = z.strictObject({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(500) });
export type QoeWithdrawBody = z.infer<typeof qoeWithdrawBodySchema>;

/** A reviewer's explicit call on an add-back: the only way an unverified one counts. */
export const qoeDecisionBodySchema = z.strictObject({ decision: z.enum(QOE_INCLUSION_DECISIONS), reason: z.string().trim().min(3).max(1000), expectedVersion: z.number().int().min(1) });
export type QoeDecisionBody = z.infer<typeof qoeDecisionBodySchema>;

export const qoeEntryParamsSchema = z.strictObject({ dealId: z.uuid(), entryKey: z.uuid() });
