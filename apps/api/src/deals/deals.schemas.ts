import { DEAL_ROLES, TRANSACTION_TYPES } from '@pactlab/domain';
import { z } from 'zod';

export const createDealSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  targetName: z.string().trim().min(1).max(200),
  transactionType: z.enum(TRANSACTION_TYPES),
  baseCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
});
export type CreateDealCommand = z.infer<typeof createDealSchema>;

/** Transaction type is fixed at creation; changing it is a versioned operation, not a patch. */
export const updateDealSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    targetName: z.string().trim().min(1).max(200).optional(),
    stage: z.enum(['SCREENING', 'DILIGENCE', 'NEGOTIATION', 'SIGNED', 'CLOSED']).optional(),
    status: z.enum(['ACTIVE', 'ON_HOLD', 'ARCHIVED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export type UpdateDealCommand = z.infer<typeof updateDealSchema>;

export const addMemberSchema = z.strictObject({
  userId: z.uuid(),
  role: z.enum(DEAL_ROLES),
});
export type AddMemberCommand = z.infer<typeof addMemberSchema>;

export interface DealMemberView {
  id: string;
  userId: string;
  displayName: string;
  role: (typeof DEAL_ROLES)[number];
  status: string;
  createdAt: string;
}
