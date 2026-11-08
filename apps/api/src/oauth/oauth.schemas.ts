import { z } from 'zod';

/** Request bodies of the OAuth endpoints the web app calls (T-084). */
export const decisionSchema = z.strictObject({ params: z.record(z.string(), z.string()), approve: z.boolean() });
export const checkSchema = z.strictObject({ params: z.record(z.string(), z.string()) });
export const grantParamsSchema = z.strictObject({ grantId: z.uuid() });
