import { z } from 'zod';

const email = z.string().trim().max(254).pipe(z.email());

export const startSignupSchema = z.strictObject({
  email,
  displayName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(2).max(120),
  ssoRequested: z.boolean().default(false),
  /** Signing up from a pact invitation (T-094 B12): the work-email rule and operator approval do not apply. */
  invitationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
});
export type StartSignupBody = z.infer<typeof startSignupSchema>;

export const verifySignupSchema = z.strictObject({ email, code: z.string().regex(/^\d{6}$/), invitationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() });
