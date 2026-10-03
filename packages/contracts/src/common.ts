import { z } from 'zod';

export const uuidSchema = z.uuid();
export const isoCurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');

/** RFC 9457 problem details. `detail` must be safe for display; never include internals. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  requestId: z.string().optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
