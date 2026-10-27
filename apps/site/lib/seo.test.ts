import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULES } from './content';
import { INDUSTRY_STORIES, PUBLISHED_INDUSTRIES } from './industry-stories';
import { AI_CRAWLERS, absolute, faqPageJsonLd, jsonLdScript, llmsText, organizationJsonLd, SITE_ROUTES, softwareApplicationJsonLd } from './seo';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../app');

/** Every page route the app defines, with dynamic segments expanded from the same content the pages use. */
function appRoutes(dir = APP): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return appRoutes(path);
    if (name !== 'page.tsx') return [];
    const route = `/${relative(APP, dir)}`.replace(/\/$/, '') || '/';
    if (route === '/product/[slug]') return MODULES.map((module) => `/product/${module.slug}`);
    if (route === '/industries/[slug]') return PUBLISHED_INDUSTRIES.map((industry) => `/industries/${industry.slug}`);
    return [route];
  });
}

describe('machine-readable site (T-085 Part 1)', () => {
  it('lists every page in the sitemap routes, and nothing that is not a page', () => {
    expect([...SITE_ROUTES].sort()).toEqual(appRoutes().sort());
    expect(SITE_ROUTES).toContain('/industries/venture-raise');
    expect(new Set(SITE_ROUTES).size).toBe(SITE_ROUTES.length);
  });

  it('builds absolute URLs with the trailing slash the static export serves', () => {
    expect(absolute('/')).toBe('https://pactlab.ai/');
    expect(absolute('/industries/hotels')).toBe('https://pactlab.ai/industries/hotels/');
  });

  it('names the major AI crawlers explicitly', () => {
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot']) expect(AI_CRAWLERS).toContain(bot);
  });

  it('describes every module and every industry in llms.txt, with links to their pages', () => {
    const text = llmsText();
    expect(text.startsWith('# Pactlab\n\n> ')).toBe(true);
    for (const module of MODULES) expect(text).toContain(`[${module.name}](${absolute(`/product/${module.slug}`)})`);
    for (const industry of PUBLISHED_INDUSTRIES) expect(text).toContain(`[${industry.name}](${absolute(`/industries/${industry.slug}`)})`);
    for (const link of text.match(/\]\((https:\/\/pactlab\.ai[^)]*)\)/g) ?? []) {
      const path = new URL(link.slice(2, -1)).pathname.replace(/\/$/, '') || '/';
      expect(SITE_ROUTES, link).toContain(path);
    }
  });

  it('emits schema.org JSON-LD that cannot break out of its script tag', () => {
    expect(organizationJsonLd()['@type']).toBe('Organization');
    expect(softwareApplicationJsonLd().featureList).toHaveLength(MODULES.length);
    const faq = faqPageJsonLd(INDUSTRY_STORIES['hotels']?.faq ?? []);
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(1);
    expect(faq.mainEntity[0]).toMatchObject({ '@type': 'Question', acceptedAnswer: { '@type': 'Answer' } });
    expect(jsonLdScript({ text: '</script><b>' })).not.toContain('<');
  });
});
