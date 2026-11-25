import { WITHDRAWAL_REASON_MAX, WITHDRAWAL_REASON_MIN } from '@pactlab/domain';
import { z } from 'zod';

/** Withdraw an import (T-154): a short reason is required and kept in its history. */
export const withdrawBodySchema = z.strictObject({ reason: z.string().trim().min(WITHDRAWAL_REASON_MIN).max(WITHDRAWAL_REASON_MAX) });
export type WithdrawBody = z.infer<typeof withdrawBodySchema>;

/** Re-import a withdrawn import: a corrected file (raw body, its name here), or the stored original again (no file). */
export const reimportQuerySchema = z.strictObject({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, 'A file name, not a path')
    .optional(),
});
export type ReimportQuery = z.infer<typeof reimportQuerySchema>;
