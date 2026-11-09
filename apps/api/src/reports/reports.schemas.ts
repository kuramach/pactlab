import { z } from 'zod';

/** Request shapes of the reports endpoints (T-110). */
export const generateReportSchema = z
  .strictObject({ scope: z.enum(['EXECUTIVE', 'PACT']), dealId: z.uuid().optional() })
  .refine((value) => (value.scope === 'PACT') === Boolean(value.dealId), { message: 'A pact report names its pact; an executive report does not.' });
export const reportHistoryQuerySchema = z.strictObject({ scope: z.enum(['EXECUTIVE', 'PACT']).optional(), dealId: z.uuid().optional() });
export const reportParamsSchema = z.strictObject({ id: z.uuid() });
