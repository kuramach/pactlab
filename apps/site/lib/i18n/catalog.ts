import { ALL_FAQS, ALL_GUIDES, COMPARISONS, live, type Comparison, type FaqPage, type Guide } from '../answers';
import { CASE_STUDIES, type CaseStudy } from '../cases';
import * as content from '../content';
import type { Industry } from '../content';
import { INDUSTRY_STORIES, PUBLISHED_INDUSTRIES, type IndustryStory } from '../industry-stories';
import { en as enUi, type Messages } from '../../messages/en/ui';
import { CONTENT_SOURCE, SOURCE_CATALOG, type CaseView, type ContentSource, type IndustryView } from './source';
import { de } from '../../messages/de';
import { fr } from '../../messages/fr';
import { ja } from '../../messages/ja';
import type { Locale, TranslatedLocale } from './locales';
import { localize, type Localized } from './localize';

/** One language's words for the whole translated surface. Every key is required: TypeScript and the completeness test both check. */
export interface Catalog {
  readonly ui: Localized<Messages>;
  readonly content: Localized<ContentSource>;
  readonly industries: Readonly<Record<string, Localized<IndustryView>>>;
  readonly stories: Readonly<Record<string, Localized<IndustryStory>>>;
  readonly faqs: Readonly<Record<string, Localized<FaqPage>>>;
  readonly guides: Readonly<Record<string, Localized<Guide>>>;
  readonly comparisons: Readonly<Record<string, Localized<Comparison>>>;
  readonly cases: Readonly<Record<string, Localized<CaseView>>>;
}

export const CATALOGS: Readonly<Record<TranslatedLocale, Catalog>> = { de, fr, ja };

/** A site in one language: the same pages, slugs and links, with every word from that language's catalog. */
export interface Site {
  readonly locale: Locale;
  readonly ui: Messages;
  readonly content: ContentSource;
  readonly modules: readonly (content.ProductModule & { readonly name: string; readonly summary: string })[];
  /** Published industries, in navigation order. */
  readonly industries: readonly Industry[];
  readonly stories: Readonly<Record<string, IndustryStory>>;
  readonly faqs: readonly FaqPage[];
  readonly guides: readonly Guide[];
  readonly comparisons: readonly Comparison[];
  readonly cases: readonly CaseStudy[];
}

const records = <V>(source: Readonly<Record<string, V>>, overlay: Readonly<Record<string, Localized<V>>>, name: string) =>
  Object.fromEntries(Object.entries(source).map(([key, value]) => [key, localize(value, overlay[key] as Localized<V>, `${name}.${key}`)])) as Record<string, V>;

function build(locale: Locale): Site {
  if (locale === 'en') {
    return {
      locale,
      ui: enUi,
      content: CONTENT_SOURCE,
      modules: content.MODULES,
      industries: PUBLISHED_INDUSTRIES,
      stories: INDUSTRY_STORIES,
      faqs: live(ALL_FAQS),
      guides: live(ALL_GUIDES),
      comparisons: COMPARISONS,
      cases: CASE_STUDIES,
    };
  }
  const catalog = CATALOGS[locale];
  // The ui catalog is type-checked whole; the overlays are checked here, at build time, and throw on any gap.
  const words = localize(CONTENT_SOURCE, catalog.content, `${locale}.content`);
  const industries = records(SOURCE_CATALOG.industries, catalog.industries, `${locale}.industries`);
  const faqs = records(SOURCE_CATALOG.faqs, catalog.faqs, `${locale}.faqs`);
  const guides = records(SOURCE_CATALOG.guides, catalog.guides, `${locale}.guides`);
  const comparisons = records(SOURCE_CATALOG.comparisons, catalog.comparisons, `${locale}.comparisons`);
  const cases = records(SOURCE_CATALOG.cases, catalog.cases, `${locale}.cases`);
  return {
    locale,
    ui: localize(enUi, catalog.ui, `${locale}.ui`),
    content: words,
    modules: content.MODULES.map((module) => ({ ...module, ...words.modules[module.slug] })),
    industries: PUBLISHED_INDUSTRIES.map((industry) => ({ ...industry, ...industries[industry.slug] })),
    stories: records(INDUSTRY_STORIES, catalog.stories, `${locale}.stories`),
    faqs: live(ALL_FAQS.map((page) => faqs[page.slug] ?? page)),
    guides: live(ALL_GUIDES.map((guide) => guides[guide.slug] ?? guide)),
    comparisons: COMPARISONS.map((comparison) => comparisons[comparison.slug] ?? comparison),
    cases: CASE_STUDIES.map((study) => ({ ...study, ...cases[study.slug] })),
  };
}

const SITES = new Map<Locale, Site>();

/** The site in one language, built once per build. */
export function site(locale: Locale): Site {
  let built = SITES.get(locale);
  if (!built) {
    built = build(locale);
    SITES.set(locale, built);
  }
  return built;
}
