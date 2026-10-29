import type { Metadata } from 'next';
import { DESCRIPTOR, HOME, INDUSTRY_CORE, MODULES, PILOT, TAGLINE, TRUST } from './content';
import { COMPARISONS, FAQS, GUIDES } from './answers';
import { CASE_STUDIES } from './cases';
import { INDUSTRY_STORIES, PUBLISHED_INDUSTRIES } from './industry-stories';

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
  '/guides',
  ...GUIDES.map((guide) => `/guides/${guide.slug}`),
  '/case-studies',
  ...CASE_STUDIES.map((study) => `/case-studies/${study.slug}`),
  '/faq',
  ...FAQS.map((page) => `/faq/${page.slug}`),
  ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
  '/trust',
  '/pilot',
  '/about',
  '/about/story',
  '/about/vision',
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

/** Title, description, canonical URL and OpenGraph for one page. */
export function pageMetadata({ title, description, path, image }: { title?: string; description: string; path: string; image?: { url: string; alt: string } }): Metadata {
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: absolute(path) },
    openGraph: {
      title: title ? `${title} · Pactlab` : `Pactlab — ${TAGLINE}`,
      description,
      url: absolute(path),
      siteName: 'Pactlab',
      type: 'website',
      images: [image ?? { url: '/brand/pactlab-symbol.png', width: 512, height: 512, alt: 'Pactlab' }],
    },
  };
}

export const organizationJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Pactlab',
  url: SITE_URL,
  logo: absolute('/brand/pactlab-symbol.png').replace(/\/$/, ''),
  slogan: TAGLINE,
  description: HOME.body,
});

export const softwareApplicationJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Pactlab',
  url: SITE_URL,
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: DESCRIPTOR,
  operatingSystem: 'Web',
  description: HOME.body,
  featureList: MODULES.map((module) => `${module.name}: ${module.summary}`),
});

export const faqPageJsonLd = (faq: readonly { readonly q: string; readonly a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
});

/** JSON for a <script type="application/ld+json">, with "<" escaped so content can never close the tag. */
export const jsonLdScript = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

/** /llms.txt (llmstxt.org): what Pactlab is, in plain Markdown, with links to every page. */
export function llmsText(): string {
  const lines = [
    '# Pactlab',
    '',
    `> ${DESCRIPTOR}. ${TAGLINE} ${HOME.body}`,
    '',
    'Pactlab serves acquirers and their advisors testing a deal before they sign it, and founders preparing a raise (Venture Raise) who want to see what an investor will find first. ' +
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
