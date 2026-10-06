import { z } from 'zod';

const email = z.string().trim().max(254).pipe(z.email());

export const startBodySchema = z.strictObject({ email });
export const verifyBodySchema = z.strictObject({ email, code: z.string().regex(/^\d{6}$/) });
export const selectOrganizationBodySchema = z.strictObject({ organizationId: z.uuid() });
