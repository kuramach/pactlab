import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPARISONS, FAQS, GUIDES } from './answers';
import { CASE_STUDIES } from './cases';
import { BANNED_WORDS, MODULES } from './content';
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
    if (route === '/guides/[slug]') return GUIDES.map((guide) => `/guides/${guide.slug}`);
    if (route === '/case-studies/[slug]') return CASE_STUDIES.map((study) => `/case-studies/${study.slug}`);
    if (route === '/faq/[slug]') return FAQS.map((page) => `/faq/${page.slug}`);
    if (route === '/compare/[slug]') return COMPARISONS.map((comparison) => `/compare/${comparison.slug}`);
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

  it('links every answer page to real pages, and keeps the voice rules', () => {
    const pages = [...FAQS, ...GUIDES];
    for (const page of pages) for (const link of page.related) expect(SITE_ROUTES, `${page.slug} -> ${link.href}`).toContain(link.href);
    // Every guide leads to a pack or product page.
    for (const guide of GUIDES) expect(guide.related.some((link) => /^\/(industries|product)\//.test(link.href)), guide.slug).toBe(true);
    expect(FAQS.map((page) => page.slug)).toEqual(['acquirers', 'founders', 'advisors']);
    expect(GUIDES.length).toBeGreaterThanOrEqual(3);
    for (const guide of GUIDES) expect(guide.title.endsWith('?'), guide.slug).toBe(true);
    const copy = JSON.stringify({ FAQS, GUIDES, COMPARISONS }).toLowerCase();
    for (const word of BANNED_WORDS) expect(copy).not.toContain(word);
    for (const claim of ['trusted by', 'our customers', '% faster', 'guarantee', 'certified', 'best-in-class', 'leading']) expect(copy).not.toContain(claim);
    // Claims about another product carry their public source.
    for (const comparison of COMPARISONS) expect(comparison.sources.length, comparison.slug).toBeGreaterThanOrEqual(1);
  });

  it('cites every fact in a case study, frames the open litigation as allegation, and claims no outcome (T-092)', () => {
    expect(CASE_STUDIES.length).toBeGreaterThanOrEqual(1);
    for (const study of CASE_STUDIES) {
      const ids = study.sources.map((source) => source.id);
      const facts = [...study.deal, ...study.defects.map((defect) => defect.record), ...study.status.facts];
      for (const fact of facts) {
        expect(fact.sources.length, fact.text).toBeGreaterThanOrEqual(1);
        for (const id of fact.sources) expect(ids, fact.text).toContain(id);
      }
      // Every listed source is cited somewhere, and every link is https.
      for (const id of ids) expect(facts.some((fact) => fact.sources.includes(id)), `${study.slug} source ${id}`).toBe(true);
      for (const source of study.sources) expect(source.url.startsWith('https://'), source.url).toBe(true);
      expect(study.status.asOf).toMatch(/^\d{1,2} \w+ \d{4}$/);
      expect(study.status.facts.map((fact) => fact.text).join(' ')).toMatch(/alleg/);
      for (const defect of study.defects) expect(SITE_ROUTES, defect.href).toContain(defect.href);
      const copy = JSON.stringify({ defects: study.defects.map(({ check, how }) => ({ check, how })), line: study.line, description: study.description, lesson: study.lesson }).toLowerCase();
      for (const word of BANNED_WORDS) expect(copy).not.toContain(word);
      for (const claim of ['would have prevented', 'would have saved', 'would have caught', 'guarantee']) expect(copy).not.toContain(claim);
    }
  });
});
