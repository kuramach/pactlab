import type { MetadataRoute } from 'next';
import { AI_CRAWLERS, absolute } from '../lib/seo';

export const dynamic = 'force-static';

/** Everyone may read the marketing site; AI crawlers are named so the welcome is explicit (T-085). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: [...AI_CRAWLERS], allow: '/' },
      { userAgent: '*', allow: '/' },
    ],
    sitemap: absolute('/sitemap.xml').replace(/\/$/, ''),
  };
}
