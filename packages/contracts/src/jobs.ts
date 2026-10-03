import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * Every async job carries the full job contract (spec §6). Workers establish
 * the tenant context from `organizationId`/`dealId` before any query.
 */
export const jobEnvelopeSchema = z.strictObject({
  jobId: uuidSchema,
  organizationId: uuidSchema,
  dealId: uuidSchema,
  type: z.string().min(1).max(100),
  schemaVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200),
  attempt: z.number().int().min(0),
  requestedBy: uuidSchema,
  correlationId: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
export type JobEnvelopeInput = z.input<typeof jobEnvelopeSchema>;

export const NOOP_JOB_TYPE = 'system.noop';
