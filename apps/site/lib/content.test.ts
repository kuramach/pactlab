import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { siteConfig } from './config';
import * as content from './content';
import { ICONS } from './icons';
import { INDUSTRY_STORIES, isPublishedHref, PUBLISHED_INDUSTRIES, WRITTEN_INDUSTRIES } from './industry-stories';

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
    expect(siteConfig({})).toEqual({ loginUrl: null, signUpUrl: null, contactHref: null, indexed: true });
    expect(siteConfig({ NEXT_PUBLIC_APP_URL: ' ', NEXT_PUBLIC_CONTACT_EMAIL: '' })).toEqual({ loginUrl: null, signUpUrl: null, contactHref: null, indexed: true });
  });

  it('builds sign-in and mailto links when configured', () => {
    expect(siteConfig({ NEXT_PUBLIC_APP_URL: 'https://app.example.test', NEXT_PUBLIC_CONTACT_EMAIL: 'pilots@example.test' })).toEqual({
      loginUrl: 'https://app.example.test/login',
      signUpUrl: 'https://app.example.test/signup',
      contactHref: 'mailto:pilots@example.test?subject=Pactlab%20pilot',
      indexed: true,
    });
  });

  it('closes an environment copy of the site to search engines; production stays open', async () => {
    expect(siteConfig({ NEXT_PUBLIC_SITE_INDEXING: 'none' }).indexed).toBe(false);
    expect(siteConfig({ NEXT_PUBLIC_SITE_INDEXING: 'public' }).indexed).toBe(true);
    expect(() => siteConfig({ NEXT_PUBLIC_SITE_INDEXING: 'sometimes' })).toThrow();
    const { default: robots } = await import('../app/robots');
    const previous = process.env['NEXT_PUBLIC_SITE_INDEXING'];
    try {
      process.env['NEXT_PUBLIC_SITE_INDEXING'] = 'none';
      expect(robots()).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
      delete process.env['NEXT_PUBLIC_SITE_INDEXING'];
      expect(JSON.stringify(robots())).toContain('"allow":"/"');
    } finally {
      if (previous === undefined) delete process.env['NEXT_PUBLIC_SITE_INDEXING'];
      else process.env['NEXT_PUBLIC_SITE_INDEXING'] = previous;
    }
  });

  it('rejects malformed values instead of shipping them', () => {
    expect(() => siteConfig({ NEXT_PUBLIC_CONTACT_EMAIL: 'not-an-email' })).toThrow();
  });
});

describe('industry stories', () => {
  it('every pack has a written page, and every story belongs to a listed industry', () => {
    expect(WRITTEN_INDUSTRIES.map((industry) => industry.slug)).toEqual(content.INDUSTRIES.map((industry) => industry.slug));
    expect(WRITTEN_INDUSTRIES).toHaveLength(13);
    for (const slug of Object.keys(INDUSTRY_STORIES)) {
      expect(content.INDUSTRIES.map((industry) => industry.slug), slug).toContain(slug);
      expect(routeExists(`/industries/${slug}`), slug).toBe(true);
    }
  });

  it('publishes only the released packs: Software & SaaS, Multifamily and Venture Raise (Kumar, 2026-11-01 and 2026-11-09)', () => {
    expect(PUBLISHED_INDUSTRIES.map((industry) => industry.slug)).toEqual(['software-saas', 'multifamily', 'venture-raise']);
    expect(isPublishedHref('/industries/hospitals')).toBe(false);
    expect(isPublishedHref('/industries/multifamily')).toBe(true);
    expect(isPublishedHref('/product')).toBe(true);
  });

  it('previews every written pack in an environment copy of the site (dev, qa)', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_PACK_PREVIEW', 'true');
    try {
      const preview = await import('./industry-stories');
      expect(preview.PUBLISHED_INDUSTRIES).toHaveLength(13);
      const answers = await import('./answers');
      expect(answers.FAQS.map((page) => page.slug)).toContain('founders');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
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

describe('pacts carousel (T-086)', () => {
  const publicDir = join(APP, '../public');

  it('shows 13 pacts in order: the core deal first, every pack, the founder side last', () => {
    expect(content.PACT_CARDS.map((card) => card.id)).toEqual([
      'technology',
      ...content.INDUSTRIES.filter((industry) => industry.pack !== null && industry.slug !== 'venture-raise').map((industry) => industry.slug),
      'venture-raise',
    ]);
  });

  it('links every shown card to a page that renders, with an existing illustration', () => {
    for (const card of content.PACT_CARDS.filter((pact) => isPublishedHref(pact.href))) {
      expect(routeExists(card.href), card.href).toBe(true);
      // Industry pages render only for published stories; anything else would 404.
      const slug = /^\/industries\/(.+)$/.exec(card.href)?.[1];
      if (slug) expect(PUBLISHED_INDUSTRIES.map((industry) => industry.slug), card.href).toContain(slug);
      expect(existsSync(join(publicDir, card.image.replace(/^\/illustrations\//, 'illustrations/'))), card.image).toBe(true);
      expect(card.line.length, card.id).toBeLessThanOrEqual(90);
    }
  });

  it('gives every shown pact a full slide in the top slider', () => {
    for (const card of content.PACT_CARDS.filter((pact) => isPublishedHref(pact.href))) {
      const slide = content.pactSlide(card);
      expect(slide.link.href).toBe(card.href);
      expect(slide.image).toBe(card.image);
      expect(slide.points.length, card.id).toBeGreaterThanOrEqual(3);
      expect(content.CAROUSEL.map((message) => message.id)).not.toContain(slide.id);
      expect(slide.group).toBe('pact');
    }
  });

  it('features at most three published pacts, all with written slide copy', () => {
    expect(content.FEATURED_PACTS.length).toBeGreaterThan(0);
    for (const id of content.FEATURED_PACTS) expect(content.PACT_CARDS.map((card) => card.id)).toContain(id);
    const shown = content.FEATURED_PACTS.filter((id) => isPublishedHref(content.PACT_CARDS.find((card) => card.id === id)!.href));
    expect(shown.length).toBeGreaterThan(0);
    expect(content.MAX_FEATURED_PACTS).toBe(3);
    expect(routeExists('/industries')).toBe(true);
  });

  it('alternates platform and pact slides in the top slider, keeping every slide once', () => {
    const pacts = content.PACT_CARDS.filter((pact) => isPublishedHref(pact.href)).map(content.pactSlide);
    const slides = content.heroSlides(pacts);
    expect(slides).toHaveLength(content.CAROUSEL.length + pacts.length);
    expect(slides[0]?.group).toBe('platform');
    if (pacts.length > 0) expect(slides[1]?.group).toBe('pact');
    expect(slides.filter((slide) => slide.group === 'platform').map((slide) => slide.id)).toEqual(content.CAROUSEL.map((slide) => slide.id));
    for (const slide of slides) expect(slide.short.length, slide.id).toBeLessThanOrEqual(14);
  });
});

describe('new features and pricing (2026-11-09)', () => {
  it('presents close, reports and the AI assistant as product modules', () => {
    expect(content.MODULES.map((module) => module.slug)).toEqual(['revenue', 'technology', 'delivery', 'documents', 'findings', 'valuation', 'close', 'reports', 'assistant']);
    expect(content.CAROUSEL.map((slide) => slide.id)).toContain('assistant');
    expect(existsSync(join(APP, '../public/illustrations/slide-assistant.svg'))).toBe(true);
    expect(content.TRUST.items.map((item) => item.title)).toContain('Passkeys');
  });

  it('shows the launch price book from ADR 0025, with Firm and Enterprise on request', () => {
    expect(content.PLANS.map((plan) => [plan.name, plan.price])).toEqual([
      ['Pact', '$2,500'],
      ['Team', '$1,500'],
      ['Venture Raise', '$99'],
      ['Firm and Enterprise', null],
    ]);
    expect(content.PLANS.find((plan) => plan.id === 'team')!.cadence).toContain('$18,000');
    expect(content.NAV.map((item) => item.href)).toContain('/pricing');
    expect(routeExists('/pricing')).toBe(true);
  });
});

describe('try it with synthetic data (2026-11-13)', async () => {
  const { TRY_PACKS, trySteps } = await import('./try');
  it('offers every published pack, with its data room and one extract per import target, at the pinned demo data', () => {
    expect(TRY_PACKS.map((pack) => pack.slug)).toEqual(PUBLISHED_INDUSTRIES.map((industry) => industry.slug));
    for (const pack of TRY_PACKS) {
      expect(pack.dataRoomUrl).toMatch(new RegExp(`^https://raw\\.githubusercontent\\.com/kuramach/pactlab-demo-data/[0-9a-f]{40}/${pack.slug}/USD/dataroom\\.zip$`));
      expect(pack.extracts.length, pack.slug).toBeGreaterThan(0);
      expect(trySteps(pack).length).toBeGreaterThanOrEqual(6);
      expect(routeExists(`/try/${pack.slug}`) || existsSync(join(APP, 'try', '[slug]', 'page.tsx'))).toBe(true);
    }
    expect(content.NAV.map((item) => item.href)).toContain('/try');
  });
});
