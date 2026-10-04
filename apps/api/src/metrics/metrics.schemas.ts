import { z } from 'zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

export const metricsQuerySchema = z.strictObject({ asOf: month.optional() });
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export const reconcileSchema = z.strictObject({ asOf: month.optional() });
export type ReconcileCommand = z.infer<typeof reconcileSchema>;

export const approvalParamsSchema = z.strictObject({
  dealId: z.uuid(),
  reconciliationId: z.string().regex(/^[0-9a-f]{64}$/),
});

export const approveSchema = z.strictObject({
  asOf: month,
  /** Reviewer's explanation of why the difference is accepted. */
  note: z.string().trim().min(3).max(2000),
});
export type ApproveCommand = z.infer<typeof approveSchema>;
