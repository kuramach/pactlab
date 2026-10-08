import { CONNECTION_MODES } from '@pactlab/domain';
import { z } from 'zod';
import { githubConnectionConfigSchema, jiraConnectionConfigSchema } from '@pactlab/connectors';
import type { SUPPORTED_PROVIDERS } from './adapter-registry';

/** Every supported provider has a create schema below. */
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/** A reference into the managed secret store — never a secret value. */
const credentialRefSchema = z
  .string()
  .regex(/^secretref:[A-Za-z0-9/_+=.@-]{1,240}$/, 'Must be a secret reference');

const common = {
  displayName: z.string().trim().min(1).max(200),
  mode: z.enum(CONNECTION_MODES),
  credentialRef: credentialRefSchema.optional(),
};

/** Provider-specific, non-secret settings; identical in FIXTURE and LIVE mode. */
export const createConnectionSchema = z.discriminatedUnion('provider', [
  z.strictObject({
    provider: z.literal('csv'),
    ...common,
    config: z.strictObject({ datasets: z.array(z.string().max(200)).min(1).max(20) }),
  }),
  z.strictObject({ provider: z.literal('github'), ...common, config: githubConnectionConfigSchema }),
  z.strictObject({ provider: z.literal('jira'), ...common, config: jiraConnectionConfigSchema }),
]);
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

/**
 * Connect a repository live: through Pactlab's GitHub App (installed by the
 * seller) or a seller's fine-grained token. The token is stored once in the
 * secret store and never returned, logged or audited.
 */
export const connectGitHubSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('APP'), repository: githubConnectionConfigSchema.shape.repository }),
  z.strictObject({
    method: z.literal('TOKEN'),
    repository: githubConnectionConfigSchema.shape.repository,
    token: z.string().trim().regex(/^[A-Za-z0-9_]{20,255}$/, 'A GitHub token'),
  }),
]);
export type ConnectGitHubCommand = z.infer<typeof connectGitHubSchema>;
