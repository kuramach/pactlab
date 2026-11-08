import { z } from 'zod';

const email = z.string().trim().max(254).pipe(z.email());

export const startBodySchema = z.strictObject({ email });
export const verifyBodySchema = z.strictObject({ email, code: z.string().regex(/^\d{6}$/) });
export const selectOrganizationBodySchema = z.strictObject({ organizationId: z.uuid() });

/**
 * The browser's WebAuthn result, as @simplewebauthn/browser returns it (T-108). Checked
 * here for shape and size only; the library verifies everything that matters.
 */
const base64url = z.string().regex(/^[A-Za-z0-9_-]*$/).max(16_384);
const credentialShape = {
  id: base64url.min(16).max(1366),
  rawId: base64url,
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
};
export const passkeySignInBodySchema = z.strictObject({
  challengeId: z.uuid(),
  response: z.object({
    ...credentialShape,
    response: z.object({ clientDataJSON: base64url, authenticatorData: base64url, signature: base64url, userHandle: base64url.optional() }),
  }),
});
export const passkeyRegisterBodySchema = z.strictObject({
  challengeId: z.uuid(),
  name: z.string().trim().min(1).max(60),
  response: z.object({
    ...credentialShape,
    response: z.object({
      clientDataJSON: base64url,
      attestationObject: base64url,
      transports: z.array(z.string().max(20)).max(8).optional(),
      authenticatorData: base64url.optional(),
      publicKey: base64url.optional(),
      publicKeyAlgorithm: z.number().int().optional(),
    }),
  }),
});
export const passkeyParamsSchema = z.strictObject({ passkeyId: z.uuid() });
