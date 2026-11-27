/**
 * The product-help corpus (T-175): Pactlab's own published knowledge, and nothing else. The chat
 * assistant answers only from these articles; its search index is built from this type alone, so no
 * pact, deal, document, finding or organization record can ever be retrieved by it.
 */

/** What kind of published knowledge an article is. A pact or organization record is none of these. */
export const KNOWLEDGE_KINDS = ['GUIDE', 'FAQ', 'PRODUCT', 'HOW_IT_WORKS', 'INDUSTRY', 'PRICING', 'TRUST', 'WHATS_NEW', 'APP_HELP'] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** Locales the surfaces run in (site T-171, app T-172). The corpus is English until a translation is published. */
export const SUPPORT_LOCALES = ['en', 'de', 'fr', 'ja'] as const;
export type SupportLocale = (typeof SUPPORT_LOCALES)[number];

/** Who an in-app article is pitched at; the caller's org role picks the surface, never their content. */
export type SupportAudience = 'BUYER' | 'SELLER' | 'ADMIN';

export interface HelpArticle {
  /** Stable, lowercase: `<kind>:<slug>`. */
  readonly id: string;
  readonly kind: KnowledgeKind;
  readonly locale: SupportLocale;
  readonly title: string;
  /**
   * Where it is published: an absolute https URL on pactlab.ai, or an app path (starts with "/"), which may
   * hold `:dealId` for a pact's own page (filled from the caller's current route, nothing else).
   */
  readonly url: string;
  readonly text: string;
  /** Numbered steps matched to the UI (APP_HELP): steps mode answers from these. */
  readonly steps?: readonly string[];
  /** The app screen the steps describe, linked from the answer. */
  readonly deepLink?: { readonly label: string; readonly path: string };
  /** App route patterns this help is about (`/deals/:dealId/sources/upload`): boosts it on that page. */
  readonly routes?: readonly string[];
  readonly audience?: readonly SupportAudience[];
}

/** What's-new cards (T-155) as articles: the API passes its registry in, so a shipped card is answerable at once. */
export function featureCardArticles(cards: readonly { id: string; title: string; body: string; href: string | null; linkLabel?: string }[]): HelpArticle[] {
  return cards.map((card) => ({
    id: `whats-new:${card.id}`,
    kind: 'WHATS_NEW',
    locale: 'en',
    title: `What's new: ${card.title}`,
    url: card.href ?? '/',
    text: card.body,
    ...(card.href ? { deepLink: { label: card.linkLabel ?? card.title, path: card.href } } : {}),
  }));
}

const ID = /^[a-z-]+:[a-z0-9-]+$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/**
 * The index admits published knowledge only: a known kind, a stable id, a published address, and no
 * identifiers that would mark a tenant record (a UUID or an email address in the text). Throws otherwise.
 */
export function assertKnowledgeOnly(articles: readonly HelpArticle[]): void {
  const seen = new Set<string>();
  for (const article of articles) {
    if (!(KNOWLEDGE_KINDS as readonly string[]).includes(article.kind)) throw new Error(`Not a knowledge article: ${article.id}`);
    if (!ID.test(article.id) || seen.has(article.id)) throw new Error(`Bad or repeated article id: ${article.id}`);
    if (!article.url.startsWith('https://pactlab.ai/') && !/^\/(?!\/)/.test(article.url)) throw new Error(`Not a published address: ${article.id}`);
    const body = [article.title, article.text, ...(article.steps ?? [])].join('\n');
    if (UUID.test(body) || EMAIL.test(body)) throw new Error(`Article carries a record identifier: ${article.id}`);
    seen.add(article.id);
  }
}
