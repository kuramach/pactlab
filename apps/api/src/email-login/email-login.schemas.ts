import { z } from 'zod';

const email = z.string().trim().max(254).pipe(z.email());

export const startBodySchema = z.strictObject({ email });
/** "Stay signed in on this device" (T-112): 8 hours unless the person trusts the device. */
export const trustSchema = z.enum(['8h', '1d', '1w', '30d']).default('8h');
export type TrustChoice = z.infer<typeof trustSchema>;
/** A readable device name from the web app ("Chrome on macOS"); never the raw user agent. */
const deviceSchema = z.string().trim().max(80).regex(/^[\p{L}\p{N} .,()/_-]*$/u).optional();
const trusted = { trust: trustSchema, device: deviceSchema };

export const verifyBodySchema = z.strictObject({ email, code: z.string().regex(/^\d{6}$/), ...trusted });
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
  ...trusted,
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
export const sessionParamsSchema = z.strictObject({ sessionId: z.uuid() });
export const sessionPolicyBodySchema = z.strictObject({ maxTrustedHours: z.union([z.literal(0), z.literal(24), z.literal(168), z.literal(720)]) });
