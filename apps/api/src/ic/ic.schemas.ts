import { z } from 'zod';

export const icDecisionSchema = z
  .strictObject({
    decision: z.enum(['APPROVE', 'APPROVE_WITH_CONDITIONS', 'DECLINE']),
    note: z.string().trim().min(3, 'Say why, in a sentence').max(4000),
    conditions: z.array(z.string().trim().min(3).max(1000)).max(20).default([]),
  })
  .refine((value) => (value.decision === 'APPROVE_WITH_CONDITIONS') === value.conditions.length > 0, {
    path: ['conditions'],
    message: 'Conditions go with “approve with conditions”, and only with it',
  });
export type IcDecisionInput = z.infer<typeof icDecisionSchema>;

export const icAddressSchema = z.strictObject({ note: z.string().trim().max(2000).nullable().default(null) });
export const icRequirementSchema = z.strictObject({ required: z.boolean().nullable() });
export const icSettingsSchema = z.strictObject({ required: z.boolean(), clearsConditions: z.boolean() });
export const icMemberSchema = z.strictObject({ member: z.boolean() });
export const icSubmissionParams = z.strictObject({ dealId: z.uuid(), submissionId: z.uuid() });
export const icConditionParams = z.strictObject({ dealId: z.uuid(), conditionId: z.uuid() });
export const icMemberParams = z.strictObject({ userId: z.uuid() });
