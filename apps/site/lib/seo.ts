import type { Metadata } from 'next';
import { TRY_PACKS } from './try';
import { DESCRIPTOR, HOME, INDUSTRY_CORE, MODULES, PILOT, PLANS, PRICING, TAGLINE, TRUST } from './content';
import { COMPARISONS, FAQS, GUIDES } from './answers';
import { API_ORIGIN, API_PAGE } from './api-docs';
import { CASE_STUDIES } from './cases';
import { INDUSTRY_STORIES, PUBLISHED_INDUSTRIES } from './industry-stories';
import { site } from './i18n/catalog';
import { HTML_LANG, isLocalizedPath, isPublishedLocale, localeHref, OG_LOCALE, PUBLISHED_LOCALES, type Locale } from './i18n/locales';

/**
 * Machine-readable surfaces for search engines and AI assistants (T-085
 * Part 1): page metadata, the route list behind the sitemap, robots rules,
 * llms.txt and schema.org JSON-LD. Everything is built from the site's own
 * content, so it cannot drift from the pages.
 */
export const SITE_URL = 'https://pactlab.ai';

/** Absolute URL for a site path, with the trailing slash the static export serves. */
export const absolute = (path: string) => new URL(path === '/' ? '/' : `${path.replace(/\/$/, '')}/`, SITE_URL).toString();

/** Every page on the site, in navigation order. */
export const SITE_ROUTES: readonly string[] = [
  '/',
  '/product',
  ...MODULES.map((module) => `/product/${module.slug}`),
  '/industries',
  ...PUBLISHED_INDUSTRIES.map((industry) => `/industries/${industry.slug}`),
  '/how-it-works',
  '/rinse',
  '/guides',
  ...GUIDES.map((guide) => `/guides/${guide.slug}`),
  '/case-studies',
  ...CASE_STUDIES.map((study) => `/case-studies/${study.slug}`),
  '/faq',
  ...FAQS.map((page) => `/faq/${page.slug}`),
  ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
  '/trust',
  '/api',
  '/pricing',
  '/try',
  ...TRY_PACKS.map((pack) => `/try/${pack.slug}`),
  '/pilot',
  '/about',
  '/about/story',
  '/about/vision',
  '/privacy',
  '/terms',
];

/**
 * AI crawlers named explicitly so the intent is unambiguous: the marketing
 * site wants to be read and cited by assistants (OpenAI, Anthropic,
 * Perplexity, Google, Common Crawl, Apple, Meta, Amazon).
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'CCBot',
  'Applebot-Extended',
  'meta-externalagent',
  'Amazonbot',
] as const;

/**
 * hreflang for a page (T-171): every published language it exists in, plus
 * x-default (English). Search engines index from these links; country
 * detection never decides what is canonical.
 */
export function languageAlternates(path: string): Record<string, string> | undefined {
  if (!isLocalizedPath(path)) return undefined;
  const languages: Record<string, string> = {};
  for (const locale of PUBLISHED_LOCALES) languages[HTML_LANG[locale]] = absolute(localeHref(locale, path));
  if (Object.keys(languages).length < 2) return undefined;
  return { ...languages, 'x-default': absolute(path) };
}

/** Title, description, canonical URL, hreflang and OpenGraph for one page, in one language. */
export function pageMetadata({
  title,
  description,
  path,
  image,
  locale = 'en',
}: {
  title?: string;
  description: string;
  /** The page's English (unprefixed) path. */
  path: string;
  image?: { url: string; alt: string };
  locale?: Locale;
}): Metadata {
  const url = absolute(localeHref(locale, path));
  const languages = isPublishedLocale(locale) ? languageAlternates(path) : undefined;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: url, ...(languages ? { languages } : {}) },
    // A translation awaiting its native review is reachable by URL only, never indexed.
    ...(isPublishedLocale(locale) ? {} : { robots: { index: false, follow: false } }),
    openGraph: {
      title: title ? `${title} · Pactlab` : `Pactlab — ${site(locale).content.tagline}`,
      description,
      url,
      siteName: 'Pactlab',
      type: 'website',
      locale: OG_LOCALE[locale],
      images: [image ?? { url: '/brand/icon-512.png', width: 512, height: 512, alt: 'Pactlab' }],
    },
  };
}

export const organizationJsonLd = (locale: Locale = 'en') => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Pactlab',
  url: SITE_URL,
  logo: absolute('/brand/pactlab-logo.svg').replace(/\/$/, ''),
  slogan: locale === 'en' ? TAGLINE : site(locale).content.tagline,
  description: locale === 'en' ? HOME.body : site(locale).content.home.body,
});

export const softwareApplicationJsonLd = (locale: Locale = 'en') => {
  const { content, modules } = locale === 'en' ? { content: { descriptor: DESCRIPTOR, home: HOME }, modules: MODULES } : site(locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Pactlab',
    url: SITE_URL,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: content.descriptor,
    operatingSystem: 'Web',
    inLanguage: HTML_LANG[locale],
    description: content.home.body,
    featureList: modules.map((module) => `${module.name}: ${module.summary}`),
  };
};

export const faqPageJsonLd = (faq: readonly { readonly q: string; readonly a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
});

/** The pricing page's plans with a published price, as schema.org offers (USD, ADR 0025). */
export const offerCatalogJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'OfferCatalog',
  name: 'Pactlab plans',
  url: absolute('/pricing'),
  itemListElement: PLANS.filter((plan) => plan.price !== null).map((plan) => ({
    '@type': 'Offer',
    name: plan.name,
    description: `${plan.audience}. ${plan.cadence}.`,
    price: (plan.price ?? '').replace(/[$,]/g, ''),
    priceCurrency: 'USD',
  })),
});

/** JSON for a <script type="application/ld+json">, with "<" escaped so content can never close the tag. */
export const jsonLdScript = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

/** /llms.txt (llmstxt.org): what Pactlab is, in plain Markdown, with links to every page. */
export function llmsText(): string {
  const lines = [
    '# Pactlab',
    '',
    // The positioning first (T-120): who it is for and that it runs the whole deal.
    `> ${HOME.body} ${TAGLINE}`,
    '',
    'Pactlab serves private equity firms, corporate development teams and their advisors running a deal from first look to close, and founders preparing a raise (Venture Raise) who want to see what an investor will find first. ' +
      'It runs one decision loop: source evidence, reviewable findings with citations, explicit assumptions, valuation scenarios, proposed deal terms. ' +
      'Calculations are deterministic and every finding is accepted or rejected by a named person.',
    '',
    '## Product modules',
    '',
    ...MODULES.map((module) => `- [${module.name}](${absolute(`/product/${module.slug}`)}): ${module.summary}`),
    '',
    '## Industries',
    '',
    `${INDUSTRY_CORE.body}`,
    '',
    ...PUBLISHED_INDUSTRIES.map((industry) => {
      const story = INDUSTRY_STORIES[industry.slug];
      return `- [${industry.name}](${absolute(`/industries/${industry.slug}`)}): ${story?.subhead ?? industry.summary}`;
    }),
    '',
    '## Guides',
    '',
    ...GUIDES.map((guide) => `- [${guide.title}](${absolute(`/guides/${guide.slug}`)}): ${guide.description}`),
    '',
    '## Case studies',
    '',
    'What Pactlab learns from good and bad pact outcomes, and how each lesson becomes a check that protects future pacts.',
    '',
    ...CASE_STUDIES.map((study) => `- [${study.title}](${absolute(`/case-studies/${study.slug}`)}): ${study.description}`),
    '',
    '## Questions and answers',
    '',
    ...FAQS.map((page) => `- [${page.title}](${absolute(`/faq/${page.slug}`)}): ${page.description}`),
    ...COMPARISONS.map((comparison) => `- [${comparison.title}](${absolute(`/compare/${comparison.slug}`)}): ${comparison.description}`),
    '',
    '## More',
    '',
    `- [How it works](${absolute('/how-it-works')}): from source evidence to deal terms, with a person deciding at every step that matters.`,
    `- [Trust](${absolute('/trust')}): ${TRUST.intro}`,
    `- [API and MCP server](${absolute('/api')}): ${API_PAGE.metaDescription} Per-person OAuth (device flow or authorization code with PKCE), no shared keys; reference at ${API_ORIGIN}/v1/openapi.json.`,
    `- [Try it with synthetic data](${absolute('/try')}): pick a pact (${TRY_PACKS.map((pack) => pack.name).join(', ')}), download a synthetic data room and extracts, and follow the steps.`,
    `- [Pricing](${absolute('/pricing')}): ${PRICING.title} ${PLANS.map((plan) => `${plan.name}: ${plan.price ? `${plan.price} ${plan.cadence}` : 'talk to us'}`).join('; ')}. Counterparty guests are free.`,
    `- [Pilot](${absolute('/pilot')}): ${PILOT.body}`,
    `- [About](${absolute('/about')}): why the company is called Pactlab, its story and its vision.`,
    '',
  ];
  return lines.join('\n');
}

export interface Crumb {
  readonly label: string;
  readonly href: string;
}

export const breadcrumbJsonLd = (crumbs: readonly Crumb[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.label, item: absolute(crumb.href) })),
});
