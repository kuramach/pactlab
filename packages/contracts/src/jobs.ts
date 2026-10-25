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

/** The BullMQ job id for an envelope: tenant-scoped idempotency key, so duplicate submissions collapse. */
export function queueJobId(envelope: Pick<JobEnvelope, 'organizationId' | 'dealId' | 'idempotencyKey'>): string {
  return `${envelope.organizationId}:${envelope.dealId}:${envelope.idempotencyKey}`.replaceAll(':', '_');
}

/** The queue every app enqueues to and the worker consumes. */
export const DEFAULT_JOB_QUEUE = 'pactlab-default';
