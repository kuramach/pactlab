import type { MetadataRoute } from 'next';
import { siteConfig } from '../lib/config';
import { AI_CRAWLERS, absolute } from '../lib/seo';

export const dynamic = 'force-static';

/**
 * Everyone may read the marketing site; AI crawlers are named so the welcome is explicit (T-085).
 * An environment's copy (dev, qa, stage) is closed to every crawler.
 */
export default function robots(): MetadataRoute.Robots {
  if (!siteConfig().indexed) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [
      { userAgent: [...AI_CRAWLERS], allow: '/' },
      { userAgent: '*', allow: '/' },
    ],
    sitemap: absolute('/sitemap.xml').replace(/\/$/, ''),
  };
}
