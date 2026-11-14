import { BRAND_FONTS } from '@pactlab/domain';
import { z } from 'zod';

/** Request shapes of the brand endpoints (T-123). */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase());
export const brandWebsiteSchema = z.strictObject({
  websiteUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable(),
});
export const brandUpdateSchema = z.strictObject({ accentColor: hex.nullable(), primaryColor: hex.nullable(), font: z.enum(BRAND_FONTS) });
// 512 KB of bytes is at most ~700 KB of base64.
export const brandLogoSchema = z.strictObject({ contentBase64: z.string().min(1).max(700_000) });
export const brandLogoQuerySchema = z.strictObject({ which: z.enum(['current', 'draft']).default('current') });
export const brandSlugSchema = z.strictObject({ slug: z.string().regex(/^[a-z0-9-]{2,80}$/) });
