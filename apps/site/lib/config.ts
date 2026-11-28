import { z } from 'zod';

/**
 * Build-time, public settings. Calls to action that need them render only
 * when they are set: the site never ships a placeholder address or URL.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  NEXT_PUBLIC_CONTACT_EMAIL: z.email().optional(),
  /**
   * `public` (default): the production site, open to search engines and AI assistants.
   * `none`: an environment's copy (dev, qa, stage), never indexed.
   */
  NEXT_PUBLIC_SITE_INDEXING: z.enum(['public', 'none']).default('public'),
  /**
   * Cloudflare Web Analytics site token (T-085): public, cookieless, no personal data.
   * Letters and digits only, since it is written into an HTML attribute.
   */
  NEXT_PUBLIC_CF_BEACON_TOKEN: z.string().regex(/^[A-Za-z0-9]{16,64}$/).optional(),
});

export interface SiteConfig {
  /** The app's /login: existing organizations sign in. */
  loginUrl: string | null;
  /** The app's /signup: a new organization is created and picks its sign-in method. */
  signUpUrl: string | null;
  /** mailto: link for pilot requests. */
  contactHref: string | null;
  /** False on an environment's copy of the site: robots.txt disallows everything and pages carry noindex. */
  indexed: boolean;
  /** The help chat (T-175), served by the app at /assistant; null when the app's address is not set. */
  assistantUrl: string | null;
  /** Cloudflare Web Analytics token; null means no analytics script at all. */
  analyticsToken: string | null;
}

export function siteConfig(source: Record<string, string | undefined> = process.env): SiteConfig {
  const blankToUndefined = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  const parsed = schema.parse({
    NEXT_PUBLIC_APP_URL: blankToUndefined(source['NEXT_PUBLIC_APP_URL']),
    NEXT_PUBLIC_CONTACT_EMAIL: blankToUndefined(source['NEXT_PUBLIC_CONTACT_EMAIL']),
    NEXT_PUBLIC_SITE_INDEXING: blankToUndefined(source['NEXT_PUBLIC_SITE_INDEXING']),
    NEXT_PUBLIC_CF_BEACON_TOKEN: blankToUndefined(source['NEXT_PUBLIC_CF_BEACON_TOKEN']),
  });
  return {
    loginUrl: parsed.NEXT_PUBLIC_APP_URL ? new URL('/login', parsed.NEXT_PUBLIC_APP_URL).toString() : null,
    signUpUrl: parsed.NEXT_PUBLIC_APP_URL ? new URL('/signup', parsed.NEXT_PUBLIC_APP_URL).toString() : null,
    contactHref: parsed.NEXT_PUBLIC_CONTACT_EMAIL
      ? `mailto:${parsed.NEXT_PUBLIC_CONTACT_EMAIL}?subject=${encodeURIComponent('Pactlab pilot')}`
      : null,
    indexed: parsed.NEXT_PUBLIC_SITE_INDEXING === 'public',
    assistantUrl: parsed.NEXT_PUBLIC_APP_URL ? new URL('/assistant', parsed.NEXT_PUBLIC_APP_URL).toString() : null,
    analyticsToken: parsed.NEXT_PUBLIC_CF_BEACON_TOKEN ?? null,
  };
}
