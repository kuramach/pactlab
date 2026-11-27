import { COMPARISONS, FAQS, GUIDES } from './answers';
import { FLOW, INDUSTRIES, MODEL_ROUTING, MODULES, PLANS, PRICING, PRINCIPLES, SOURCES, TRUST } from './content';
import { RELEASED_INDUSTRY_SLUGS } from './industry-stories';
import { absolute } from './seo';

/**
 * The site's published knowledge as help articles (T-175): what the chat assistant answers from. The site
 * stays the source; `packages/ai/src/support/site-corpus.generated.ts` is this, written out, and
 * `support-corpus.test.ts` fails when the two drift (run it with UPDATE_SUPPORT_CORPUS=1 to rewrite).
 * Released pages only, whatever the build's preview setting.
 */
export interface SiteArticle {
  readonly id: string;
  readonly kind: 'GUIDE' | 'FAQ' | 'PRODUCT' | 'HOW_IT_WORKS' | 'INDUSTRY' | 'PRICING' | 'TRUST';
  readonly locale: 'en';
  readonly title: string;
  readonly url: string;
  readonly text: string;
}

const lines = (...parts: (string | readonly string[] | undefined)[]) => parts.flat().filter((part): part is string => Boolean(part)).join('\n');
const features = (items: readonly { title: string; body: string }[]) => items.map((item) => `${item.title}: ${item.body}`);
/** Help ids are `<kind>:<lowercase slug>`. */
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function siteSupportArticles(): SiteArticle[] {
  const articles: SiteArticle[] = [];
  const add = (article: Omit<SiteArticle, 'locale'>) => articles.push({ ...article, locale: 'en' });

  add({
    id: 'how-it-works:loop',
    kind: 'HOW_IT_WORKS',
    title: 'How Pactlab works: evidence in, defensible terms out',
    url: absolute('/how-it-works'),
    text: lines(
      'Pactlab connects the deal’s sources, drafts the findings, and leaves every decision to a named person — keeping the chain of evidence intact from first record to final term.',
      `${SOURCES.title}. ${SOURCES.body}`,
      features(SOURCES.items),
      'The loop, the same for every deal and every industry:',
      FLOW.map((step) => `${step.step} — ${step.title}: ${step.body}`),
      `${PRINCIPLES.title} ${PRINCIPLES.body}`,
      features(PRINCIPLES.items),
    ),
  });
  add({ id: 'how-it-works:model-routing', kind: 'HOW_IT_WORKS', title: MODEL_ROUTING.title, url: absolute('/how-it-works'), text: lines(MODEL_ROUTING.body, MODEL_ROUTING.providers, features(MODEL_ROUTING.items), MODEL_ROUTING.howItWorks.body) });

  for (const module of MODULES) {
    add({ id: `product:${module.slug}`, kind: 'PRODUCT', title: module.name, url: absolute(`/product/${module.slug}`), text: lines(module.summary, module.question, module.intro, features(module.features), `What you get: ${module.output}`) });
  }
  for (const guide of GUIDES) {
    add({
      id: `guide:${guide.slug}`,
      kind: 'GUIDE',
      title: guide.title,
      url: absolute(`/guides/${guide.slug}`),
      text: lines(guide.intro, guide.sections.map((section) => lines(section.heading, section.body, section.points))),
    });
  }
  for (const page of FAQS) {
    page.items.forEach((item, index) => add({ id: `faq:${page.slug}-${index + 1}`, kind: 'FAQ', title: item.q, url: absolute(`/faq/${page.slug}`), text: item.a }));
  }
  for (const comparison of COMPARISONS) {
    add({ id: `guide:compare-${comparison.slug}`, kind: 'GUIDE', title: comparison.title, url: absolute(`/compare/${comparison.slug}`), text: lines(comparison.intro, comparison.rows.map((row) => `${row.topic}: ${row.pactlab}`), comparison.conclusion) });
  }
  for (const industry of INDUSTRIES.filter((entry) => RELEASED_INDUSTRY_SLUGS.includes(entry.slug))) {
    add({
      id: `industry:${industry.slug}`,
      kind: 'INDUSTRY',
      title: `${industry.name} in Pactlab`,
      url: absolute(`/industries/${industry.slug}`),
      text: lines(industry.summary, industry.dealShape, industry.questions, features(industry.adds), industry.pack ? [`Evidence: ${industry.pack.evidence.join('; ')}`, `Findings: ${industry.pack.findings.join('; ')}`, `Valuation: ${industry.pack.valuation.join('; ')}`] : undefined),
    });
  }
  add({ id: 'pricing:overview', kind: 'PRICING', title: PRICING.title, url: absolute('/pricing'), text: lines(PRICING.body, features(PRICING.notes)) });
  for (const plan of PLANS) {
    add({
      id: `pricing:${slug(plan.id)}`,
      kind: 'PRICING',
      title: `The ${plan.name} plan`,
      url: absolute('/pricing'),
      text: lines(`${plan.name}: ${plan.audience}.`, plan.price ? `${plan.price} ${plan.cadence}.` : `Price: ${plan.cadence}.`, plan.alternatives.length ? `Also: ${plan.alternatives.join('; ')}.` : undefined, plan.includes),
    });
  }
  add({ id: 'trust:overview', kind: 'TRUST', title: TRUST.title, url: absolute('/trust'), text: lines(TRUST.intro, features(TRUST.items)) });
  return articles;
}

/** The generated module's source, exactly as committed. */
export function renderSupportCorpusModule(articles: readonly SiteArticle[] = siteSupportArticles()): string {
  return [
    '// Generated from the marketing site by apps/site/lib/support-corpus.ts. Do not edit:',
    '// change the site content, then run `UPDATE_SUPPORT_CORPUS=1 pnpm --filter @pactlab/site test`.',
    "import type { HelpArticle } from './corpus';",
    '',
    `export const SITE_CORPUS: readonly HelpArticle[] = ${JSON.stringify(articles, null, 2)};`,
    '',
  ].join('\n');
}
