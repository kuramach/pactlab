import { z } from 'zod';

/** Request shapes of the feature-card endpoints (T-155). */
export const cardParamsSchema = z.strictObject({ cardId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) });
