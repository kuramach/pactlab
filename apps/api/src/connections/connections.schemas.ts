import { CONNECTION_MODES } from '@pactlab/domain';
import { z } from 'zod';
import { SUPPORTED_PROVIDERS } from './adapter-registry';

/** A reference into the managed secret store — never a secret value. */
const credentialRefSchema = z
  .string()
  .regex(/^secretref:[A-Za-z0-9/_+=.@-]{1,240}$/, 'Must be a secret reference');

export const createConnectionSchema = z.strictObject({
  provider: z.enum(SUPPORTED_PROVIDERS),
  displayName: z.string().trim().min(1).max(200),
  mode: z.enum(CONNECTION_MODES),
  credentialRef: credentialRefSchema.optional(),
  config: z.strictObject({
    datasets: z.array(z.string().max(200)).min(1).max(20),
  }),
});
export type CreateConnectionCommand = z.infer<typeof createConnectionSchema>;

export const setModeSchema = z.strictObject({
  mode: z.enum(CONNECTION_MODES),
  credentialRef: credentialRefSchema.optional(),
});
export type SetModeCommand = z.infer<typeof setModeSchema>;

export const dryRunSchema = z.strictObject({
  limit: z.number().int().min(1).max(1000).default(10),
});

export const connectionParamsSchema = z.strictObject({ dealId: z.uuid(), connectionId: z.uuid() });
export const syncRunParamsSchema = z.strictObject({ dealId: z.uuid(), runId: z.uuid() });
export const requestSyncRunSchema = z.strictObject({ connectionId: z.uuid() });
export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9:_.-]{8,200}$/);
