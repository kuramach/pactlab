import { ALL_FAQS, ALL_GUIDES, COMPARISONS } from '../answers';
import { CASE_STUDIES, type CaseStudy } from '../cases';
import * as content from '../content';
import type { Industry } from '../content';
import { INDUSTRY_STORIES } from '../industry-stories';
import { en as enUi } from '../../messages/en/ui';

/**
 * The English source of every page that exists in every language (ADR 0057).
 * Only what the translated pages show is here: the product-module pages,
 * pricing, trust, try, pilot and the legal pages stay in English.
 */
export const CONTENT_SOURCE = {
  tagline: content.TAGLINE,
  descriptor: content.DESCRIPTOR,
  positioning: content.POSITIONING,
  story: content.STORY,
  pillar: content.PILLAR,
  home: { eyebrow: content.HOME.eyebrow, body: content.HOME.body },
  flow: content.FLOW,
  principles: content.PRINCIPLES,
  sources: content.SOURCES,
  modelRouting: content.MODEL_ROUTING,
  pilot: { title: content.PILOT.title, body: content.PILOT.body },
  industryCore: content.INDUSTRY_CORE,
  plannedNote: content.PLANNED_NOTE,
  closing: content.CLOSING,
  announcement: content.ANNOUNCEMENT,
  nameStory: content.NAME_STORY,
  founder: content.FOUNDER,
  demos: content.DEMOS,
  carousel: content.CAROUSEL,
  nav: content.NAV,
  aboutPages: content.ABOUT_PAGES,
  /** Names and one-liners only: the module pages themselves are English. */
  modules: Object.fromEntries(content.MODULES.map((module) => [module.slug, { name: module.name, summary: module.summary }])) as Readonly<
    Record<string, { readonly name: string; readonly summary: string }>
  >,
  pactCards: Object.fromEntries(content.PACT_CARDS.map((card) => [card.id, { name: card.name, line: card.line }])) as Readonly<
    Record<string, { readonly name: string; readonly line: string }>
  >,
  pactSlides: content.PACT_SLIDE_COPY,
};
export type ContentSource = typeof CONTENT_SOURCE;

/** What an industry page shows; the pack definition behind it is English (it feeds the app, not the page). */
export type IndustryView = Pick<Industry, 'name' | 'summary' | 'dealShape' | 'questions' | 'transfers' | 'adds' | 'vocabulary'>;
export const industryView = ({ name, summary, dealShape, questions, transfers, adds, vocabulary }: Industry): IndustryView => ({
  name,
  summary,
  dealShape,
  questions,
  transfers,
  adds,
  ...(vocabulary ? { vocabulary } : {}),
});

/** The case-studies index: the studies themselves are told in English, every fact cited to an English source. */
export type CaseView = { readonly title: string; readonly line: string; readonly outcome: CaseStudy['outcome'] };
export const caseView = ({ title, line, outcome }: CaseStudy): CaseView => ({ title, line, outcome });

const bySlug = <T extends { readonly slug: string }, V>(items: readonly T[], view: (item: T) => V) =>
  Object.fromEntries(items.map((item) => [item.slug, view(item)])) as Readonly<Record<string, V>>;

/** The English source in catalog form: what every translation is checked against. */
export const SOURCE_CATALOG = {
  ui: enUi,
  content: CONTENT_SOURCE,
  industries: bySlug(content.INDUSTRIES, industryView),
  stories: INDUSTRY_STORIES,
  faqs: bySlug(ALL_FAQS, (page) => page),
  guides: bySlug(ALL_GUIDES, (guide) => guide),
  comparisons: bySlug(COMPARISONS, (comparison) => comparison),
  cases: bySlug(CASE_STUDIES, caseView),
} as const;

