import { z } from 'zod';

/** Request shapes of the billing endpoints (T-087). */
export const compSchema = z.strictObject({ kind: z.enum(['PACT', 'VENTURE_ROUND', 'SELL_SIDE']), packs: z.array(z.string().regex(/^[A-Z_]{2,40}$/)).max(14).default([]) });
export const organizationParams = z.strictObject({ organizationId: z.uuid() });
export const promoParams = z.strictObject({ id: z.uuid() });
export const fixtureSchema = z.strictObject({ session: z.string().regex(/^cs_fixture_[a-f0-9]{18}$/) });
