import type { MetadataRoute } from 'next';
import { SITE_ROUTES, absolute } from '../lib/seo';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_ROUTES.map((path) => ({ url: absolute(path), changeFrequency: 'monthly', priority: path === '/' ? 1 : 0.7 }));
}
