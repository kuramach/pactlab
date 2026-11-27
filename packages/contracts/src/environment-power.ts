import { z } from 'zod';

/**
 * An environment's power state (ADR 0019, ADR 0063), as the Hosting cost page shows it. `paused`: the idle pause
 * (services at zero, database stopped). `hibernated`: snapshotted, with everything that bills by the hour deleted.
 */
export const ENVIRONMENT_POWER_STATES = ['awake', 'paused', 'waking', 'hibernating', 'hibernated', 'rebuilding'] as const;
export type EnvironmentPowerState = (typeof ENVIRONMENT_POWER_STATES)[number];

const money = z.string().regex(/^\d{1,7}\.\d{2}$/);

/** What an environment costs a month while hibernated (infra/cdk/lib/hibernation-cost.ts), as CDK publishes it. */
export const hibernatedCostSchema = z.object({
  lines: z.array(z.object({ item: z.string().max(100), low: money, high: money, basis: z.string().max(300) })).max(20),
  low: money,
  high: money,
  currency: z.literal('USD'),
});
export type HibernatedCost = z.infer<typeof hibernatedCostSchema>;

/** The hibernate workflow's record (scripts/hibernate-environment.sh); only what the page shows is read. */
export const hibernationRecordSchema = z.object({ snapshot: z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]{0,254}$/), at: z.string().datetime() });

export const environmentPowerSchema = z.object({
  environment: z.enum(['dev', 'qa', 'stage', 'prod']),
  /** Live has no pause or hibernation: always on. */
  alwaysOn: z.boolean(),
  power: z.enum(ENVIRONMENT_POWER_STATES).nullable(),
  /** When the state last changed. */
  since: z.string().datetime().nullable(),
  hibernation: hibernationRecordSchema.nullable(),
  costWhileHibernated: hibernatedCostSchema.nullable(),
  /** Set when the state could not be read (no role configured, or AWS refused): shown, never guessed. */
  unreadable: z.enum(['NOT_CONFIGURED', 'UNAVAILABLE']).nullable(),
});
export type EnvironmentPower = z.infer<typeof environmentPowerSchema>;
