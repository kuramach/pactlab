import { z } from 'zod';

const email = z.string().trim().max(254).pipe(z.email());

export const startSignupSchema = z.strictObject({
  email,
  displayName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(2).max(120),
  ssoRequested: z.boolean().default(false),
});
export type StartSignupBody = z.infer<typeof startSignupSchema>;

export const verifySignupSchema = z.strictObject({ email, code: z.string().regex(/^\d{6}$/) });
