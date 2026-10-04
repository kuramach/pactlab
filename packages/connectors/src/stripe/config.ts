import { z } from 'zod';

/** Non-secret Stripe connection settings. Keys live in the managed secret store only. */
export const stripeConnectionConfigSchema = z.strictObject({
  /** Fixture datasets to replay (FIXTURE mode). */
  datasets: z
    .array(z.string().regex(/^[A-Za-z]+\/[a-z0-9][a-z0-9-]*\.csv$/))
    .max(20)
    .default([]),
  /** Human label for the connected account; never an account id or key. */
  accountLabel: z.string().trim().min(1).max(120).optional(),
});
export type StripeConnectionConfig = z.infer<typeof stripeConnectionConfigSchema>;
