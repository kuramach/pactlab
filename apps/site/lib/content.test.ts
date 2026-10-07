import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { siteConfig } from './config';
import * as content from './content';
import { ICONS } from './icons';
import { INDUSTRY_STORIES } from './industry-stories';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../app');
const copy = JSON.stringify({ ...content, BANNED_WORDS: [] }).toLowerCase();

/** Static route for an href, e.g. /industries/fintech -> app/industries/[slug]/page.tsx. */
function routeExists(href: string): boolean {
  if (href === '/') return existsSync(join(APP, 'page.tsx'));
  const parts = href.split('/').filter(Boolean);
  const direct = join(APP, ...parts, 'page.tsx');
  const dynamic = join(APP, ...parts.slice(0, -1), '[slug]', 'page.tsx');
  return existsSync(direct) || existsSync(dynamic);
}

describe('brand voice', () => {
  it('uses the chosen tagline and descriptor', () => {
    expect(content.TAGLINE).toBe('AI rigor. Human judgment.');
    expect(content.DESCRIPTOR).toBe('Diligence for mergers and acquisitions');
  });

  it('never uses banned pitch-deck words', () => {
    for (const word of content.BANNED_WORDS) expect(copy).not.toContain(word);
  });

  it('makes no claims the product cannot back', () => {
    for (const claim of ['trusted by', 'our customers', '% faster', 'guarantee', 'certified', 'soc 2', 'iso 27001']) {
      expect(copy).not.toContain(claim);
    }
  });
});

describe('industries', () => {
  it('marks only the software baseline as available; packs are planned in order', () => {
    const available = content.INDUSTRIES.filter((industry) => industry.status === 'AVAILABLE');
    expect(available.map((industry) => industry.slug)).toEqual(['software-saas']);
    const planned = content.INDUSTRIES.filter((industry) => industry.status === 'PLANNED');
    expect(planned.map((industry) => industry.slug)).toEqual([
      'fintech',
      'healthcare',
      'telecom-media',
      'professional-services',
      'pharma-biotech',
      'ecommerce-dtc',
    ]);
    expect(planned.map((industry) => industry.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gives every industry a full value story', () => {
    for (const industry of content.INDUSTRIES) {
      expect(industry.questions.length).toBeGreaterThanOrEqual(3);
      expect(industry.transfers.length).toBeGreaterThanOrEqual(2);
      if (industry.status === 'PLANNED') expect(industry.adds.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('navigation', () => {
  it('every nav, module and industry link has a page', () => {
    const hrefs = [
      '/',
      ...content.NAV.map((item) => item.href),
      ...content.MODULES.map((module) => `/product/${module.slug}`),
      ...content.INDUSTRIES.map((industry) => `/industries/${industry.slug}`),
    ];
    for (const href of hrefs) expect(routeExists(href), href).toBe(true);
  });

  it('slugs are unique', () => {
    for (const list of [content.MODULES, content.INDUSTRIES]) {
      const slugs = list.map((entry) => entry.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('every icon used is registered', () => {
    const used = JSON.stringify(content).match(/"icon":"(\w+)"/g) ?? [];
    for (const match of used) expect(Object.keys(ICONS)).toContain(match.slice(8, -1));
  });
});

describe('siteConfig', () => {
  it('hides calls to action that are not configured', () => {
    expect(siteConfig({})).toEqual({ loginUrl: null, signUpUrl: null, contactHref: null });
    expect(siteConfig({ NEXT_PUBLIC_APP_URL: ' ', NEXT_PUBLIC_CONTACT_EMAIL: '' })).toEqual({ loginUrl: null, signUpUrl: null, contactHref: null });
  });

  it('builds sign-in and mailto links when configured', () => {
    expect(siteConfig({ NEXT_PUBLIC_APP_URL: 'https://app.example.test', NEXT_PUBLIC_CONTACT_EMAIL: 'pilots@example.test' })).toEqual({
      loginUrl: 'https://app.example.test/login',
      signUpUrl: 'https://app.example.test/signup',
      contactHref: 'mailto:pilots@example.test?subject=Pactlab%20pilot',
    });
  });

  it('rejects malformed values instead of shipping them', () => {
    expect(() => siteConfig({ NEXT_PUBLIC_CONTACT_EMAIL: 'not-an-email' })).toThrow();
  });
});

describe('industry stories', () => {
  it('every industry has a full marketing story and an illustration', () => {
    const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public/illustrations');
    for (const industry of content.INDUSTRIES) {
      const story = INDUSTRY_STORIES[industry.slug];
      expect(story, industry.slug).toBeDefined();
      expect(story!.pains.length).toBeGreaterThanOrEqual(3);
      expect(story!.walkthrough.length).toBeGreaterThanOrEqual(4);
      expect(story!.findings.length).toBeGreaterThanOrEqual(2);
      expect(story!.deliverables.length).toBeGreaterThanOrEqual(3);
      expect(story!.faq.length).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(publicDir, `${industry.slug}.svg`)), `${industry.slug}.svg`).toBe(true);
      // Walkthrough steps are steps of the real decision loop.
      for (const entry of story!.walkthrough) expect(content.FLOW.map((step) => step.step)).toContain(entry.step);
    }
  });

  it('keeps the same voice rules and says plainly that packs are planned', () => {
    const copy = JSON.stringify(INDUSTRY_STORIES).toLowerCase();
    for (const word of content.BANNED_WORDS) expect(copy).not.toContain(word);
    for (const claim of ['trusted by', 'our customers', '% faster', 'guarantee', 'certified']) expect(copy).not.toContain(claim);
    for (const industry of content.INDUSTRIES.filter((entry) => entry.status === 'PLANNED')) {
      expect(JSON.stringify(INDUSTRY_STORIES[industry.slug]!.faq)).toContain('is planned, not built');
    }
  });
});
