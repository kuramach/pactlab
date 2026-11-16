import { z } from 'zod';

/** Request bodies of the OAuth endpoints the web app calls (T-084). */
export const decisionSchema = z.strictObject({ params: z.record(z.string(), z.string()), approve: z.boolean() });
export const checkSchema = z.strictObject({ params: z.record(z.string(), z.string()) });
export const grantParamsSchema = z.strictObject({ grantId: z.uuid() });

/** The device approval page (T-128): the code the person typed or followed a link with. */
export const deviceCheckSchema = z.strictObject({ userCode: z.string().max(32) });
export const deviceDecisionSchema = z.strictObject({ userCode: z.string().max(32), approve: z.boolean() });
export const apiAccessSchema = z.strictObject({ enabled: z.boolean() });
