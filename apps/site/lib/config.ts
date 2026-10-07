import { z } from 'zod';

/**
 * Build-time, public settings. Calls to action that need them render only
 * when they are set: the site never ships a placeholder address or URL.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  NEXT_PUBLIC_CONTACT_EMAIL: z.email().optional(),
});

export interface SiteConfig {
  /** The app's /login: existing organizations sign in. */
  loginUrl: string | null;
  /** The app's /signup: a new organization is created and picks its sign-in method. */
  signUpUrl: string | null;
  /** mailto: link for pilot requests. */
  contactHref: string | null;
}

export function siteConfig(source: Record<string, string | undefined> = process.env): SiteConfig {
  const blankToUndefined = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  const parsed = schema.parse({
    NEXT_PUBLIC_APP_URL: blankToUndefined(source['NEXT_PUBLIC_APP_URL']),
    NEXT_PUBLIC_CONTACT_EMAIL: blankToUndefined(source['NEXT_PUBLIC_CONTACT_EMAIL']),
  });
  return {
    loginUrl: parsed.NEXT_PUBLIC_APP_URL ? new URL('/login', parsed.NEXT_PUBLIC_APP_URL).toString() : null,
    signUpUrl: parsed.NEXT_PUBLIC_APP_URL ? new URL('/signup', parsed.NEXT_PUBLIC_APP_URL).toString() : null,
    contactHref: parsed.NEXT_PUBLIC_CONTACT_EMAIL
      ? `mailto:${parsed.NEXT_PUBLIC_CONTACT_EMAIL}?subject=${encodeURIComponent('Pactlab pilot')}`
      : null,
  };
}
