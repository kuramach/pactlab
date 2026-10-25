import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { siteConfig } from './config';
import * as content from './content';
import { ICONS } from './icons';
import { INDUSTRY_STORIES, PUBLISHED_INDUSTRIES } from './industry-stories';

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
  it('presents every pack as available, numbered in spec order', () => {
    expect(content.INDUSTRIES.filter((industry) => industry.status !== 'AVAILABLE')).toEqual([]);
    const packs = content.INDUSTRIES.filter((industry) => industry.pack !== null);
    expect(packs.map((industry) => industry.slug)).toEqual([
      'fintech',
      'healthcare',
      'telecom-media',
      'professional-services',
      'pharma-biotech',
      'ecommerce-dtc',
      'multifamily',
      'commercial-property',
      'hotels',
      'small-clinics',
      'hospitals',
      'venture-raise',
    ]);
    expect(packs.map((industry) => industry.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('gives every industry a full value story', () => {
    for (const industry of content.INDUSTRIES) {
      expect(industry.questions.length).toBeGreaterThanOrEqual(3);
      expect(industry.transfers.length).toBeGreaterThanOrEqual(2);
      if (industry.pack) expect(industry.adds.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('pack registry', () => {
  it('defines all twelve packs with evidence, finding types and valuation notes', () => {
    const packs = content.INDUSTRIES.filter((industry) => industry.pack !== null);
    expect(packs).toHaveLength(12);
    for (const industry of packs) {
      expect(industry.pack, industry.slug).not.toBeNull();
      expect(industry.pack!.evidence.length, industry.slug).toBeGreaterThan(0);
      expect(industry.pack!.findings.length, industry.slug).toBeGreaterThan(0);
      expect(industry.pack!.valuation.length, industry.slug).toBeGreaterThan(0);
      for (const entry of [...industry.pack!.evidence, ...industry.pack!.findings, ...industry.pack!.valuation]) expect(entry.trim()).not.toBe('');
    }
    expect(content.INDUSTRIES.find((industry) => industry.slug === 'software-saas')!.pack).toBeNull();
  });

  it('groups the real-estate cluster and the healthcare extensions (ADR 0008)', () => {
    const cluster = (name: string) => content.INDUSTRIES.filter((industry) => industry.pack?.cluster === name).map((industry) => industry.slug);
    expect(cluster('real-estate')).toEqual(['multifamily', 'commercial-property', 'hotels']);
    expect(cluster('healthcare')).toEqual(['healthcare', 'small-clinics', 'hospitals']);
  });

  it('records upside as confirmed value, never a price increase', () => {
    expect(JSON.stringify(content.INDUSTRIES).toLowerCase()).not.toMatch(/raises? the price|increases? the price/);
    const multifamily = content.INDUSTRIES.find((industry) => industry.slug === 'multifamily')!;
    expect(multifamily.pack!.valuation.join(' ')).toContain('never a price increase');
  });
});

describe('navigation', () => {
  it('every nav, module and industry link has a page', () => {
    const hrefs = [
      '/',
      ...content.NAV.map((item) => item.href),
      ...content.MODULES.map((module) => `/product/${module.slug}`),
      ...PUBLISHED_INDUSTRIES.map((industry) => `/industries/${industry.slug}`),
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

  it('every module and industry has its own mark', () => {
    for (const list of [content.MODULES, content.INDUSTRIES]) {
      const marks = list.map((entry) => entry.icon);
      for (const mark of marks) expect(ICONS[mark]).toBeDefined();
      expect(new Set(marks).size).toBe(marks.length);
    }
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
  it('every pack has a page, and every story belongs to a listed industry', () => {
    // The index, navigation and footer list PUBLISHED_INDUSTRIES: a pack without a story would be missing from them.
    expect(PUBLISHED_INDUSTRIES.map((industry) => industry.slug)).toEqual(content.INDUSTRIES.map((industry) => industry.slug));
    expect(PUBLISHED_INDUSTRIES).toHaveLength(13);
    for (const slug of Object.keys(INDUSTRY_STORIES)) {
      expect(content.INDUSTRIES.map((industry) => industry.slug), slug).toContain(slug);
      expect(routeExists(`/industries/${slug}`), slug).toBe(true);
    }
  });

  it('every published industry has a full marketing story and an illustration', () => {
    const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public/illustrations');
    for (const industry of PUBLISHED_INDUSTRIES) {
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

  it('keeps the same voice rules and reads as available', () => {
    const copy = JSON.stringify(INDUSTRY_STORIES).toLowerCase();
    for (const word of content.BANNED_WORDS) expect(copy).not.toContain(word);
    for (const claim of ['trusted by', 'our customers', '% faster', 'guarantee', 'certified']) expect(copy).not.toContain(claim);
    for (const phrase of ['planned', 'not built', 'coming soon', 'would be', 'design partner']) expect(copy).not.toContain(phrase);
    for (const industry of PUBLISHED_INDUSTRIES) expect(INDUSTRY_STORIES[industry.slug]!.faq.length, industry.slug).toBeGreaterThanOrEqual(3);
  });
});
