import type { CitableSource } from '../context';
import { GatewayPolicyError, type AiRunRecord, type ClaudeGateway } from '../gateway';
import { supportChatPrompt, type SupportAnswer } from '../prompts/support-chat';
import { APP_HELP } from './app-help';
import { featureCardArticles, type HelpArticle, type SupportAudience, type SupportLocale } from './corpus';
import { asksForAccountData, looksLikeFeatureRequest, unsupportedFigures } from './intent';
import { PUBLISHED_CORPUS_LOCALES, SUPPORT_MESSAGES } from './messages';
import { SupportIndex } from './search';

/** Help runs belong to no organization or pact: the platform scope for routing (no allow-list) and no deal. */
export const SUPPORT_PLATFORM_SCOPE = '00000000-0000-0000-0000-000000000000';

export type SupportSurface = 'SITE' | 'APP';

export interface SupportRequest {
  readonly surface: SupportSurface;
  readonly locale: SupportLocale;
  /** The path the person is on. Only its shape reaches the model (ids replaced), and it fills deep links. */
  readonly page: string;
  readonly question: string;
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
  /** In-app: the side the person's org role puts them on, to pitch steps at the right surface. */
  readonly audience: SupportAudience | null;
  /** In-app: the caller's organization, so its model allow-list applies. Site: null (platform scope). */
  readonly organizationId: string | null;
}

export interface SupportReply {
  kind: 'ANSWER' | 'STEPS' | 'DONT_KNOW' | 'BOUNDARY' | 'FEATURE_REQUEST' | 'UNAVAILABLE';
  text: string;
  steps: string[];
  citations: { title: string; href: string }[];
  deepLink: { label: string; href: string } | null;
  answeredIn: SupportLocale;
  localeNote: string | null;
  offerEmail: boolean;
  featureRequest: { summary: string } | null;
}

export interface SupportResult {
  readonly reply: SupportReply;
  /** The model call, for metering; null when the answer needed none. */
  readonly run: AiRunRecord | null;
}

/** The two indexes: the site's (published pages only) and the app's (pages, in-app help and What's-new cards). */
export function supportIndexes(siteArticles: readonly HelpArticle[], featureCards: Parameters<typeof featureCardArticles>[0]): Record<SupportSurface, SupportIndex> {
  return { SITE: new SupportIndex(siteArticles), APP: new SupportIndex([...siteArticles, ...APP_HELP, ...featureCardArticles(featureCards)]) };
}

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const DEAL_ID = /^\/deals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The page's shape, never its ids: `/deals/:id/sources/upload`. */
export function pageShape(page: string): string {
  return (page.split(/[?#]/)[0] ?? '/').replace(UUID_SEGMENT, '/:id');
}

/** An article's address for this person: a pact's own page uses the pact they are on, and only that. */
export function resolveHref(path: string, page: string): string {
  if (!path.includes(':dealId')) return path;
  const dealId = DEAL_ID.exec(page)?.[1];
  return dealId ? path.replace(':dealId', dealId) : '/deals';
}

function sourceText(article: HelpArticle): string {
  const steps = article.steps?.length ? `\nSteps:\n${article.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}` : '';
  return `${article.title}\n${article.text}${steps}`;
}

/**
 * One help question, start to finish (T-175): the boundary first, then the corpus, then the model, then
 * code checks what it said — every answer cites the corpus, states no price or date its sources do not, and
 * anything else becomes the don't-know. Nothing here can read a pact, deal or organization record.
 */
export async function answerSupportQuestion(gateway: ClaudeGateway, index: SupportIndex, request: SupportRequest): Promise<SupportResult> {
  const messages = SUPPORT_MESSAGES[request.locale];
  const fixed = (kind: 'DONT_KNOW' | 'BOUNDARY' | 'UNAVAILABLE', run: AiRunRecord | null = null): SupportResult => ({
    reply: {
      kind,
      text: kind === 'BOUNDARY' ? messages.boundary : kind === 'DONT_KNOW' ? messages.dontKnow : messages.unavailable,
      steps: [],
      citations: [],
      deepLink: null,
      answeredIn: request.locale,
      localeNote: null,
      offerEmail: true,
      featureRequest: null,
    },
    run,
  });

  if (asksForAccountData(request.question)) return fixed('BOUNDARY');

  const corpusLocale: SupportLocale = PUBLISHED_CORPUS_LOCALES.includes(request.locale) ? request.locale : 'en';
  const hits = index
    .search(request.question, { page: request.page, audience: request.audience, limit: 8 })
    .filter((hit) => hit.article.locale === corpusLocale)
    .slice(0, 5);
  if (hits.length === 0 && !looksLikeFeatureRequest(request.question)) return fixed('DONT_KNOW');

  const sources: CitableSource[] = hits.map((hit, position) => ({
    citationId: `S${position + 1}`,
    documentId: hit.article.id,
    documentName: hit.article.title,
    pageNumber: 1,
    text: sourceText(hit.article),
    classification: 'PUBLIC',
  }));
  const history = request.history
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.text.slice(0, 600)}`)
    .join('\n');
  const page = `surface=${request.surface}; page=${pageShape(request.page)}${request.audience ? `; side=${request.audience}` : ''}`;

  let response;
  try {
    response = await gateway.invoke(supportChatPrompt, {
      organizationId: request.organizationId ?? SUPPORT_PLATFORM_SCOPE,
      dealId: SUPPORT_PLATFORM_SCOPE,
      inputs: [
        { name: 'question', classification: 'PUBLIC', text: request.question },
        { name: 'history', classification: 'PUBLIC', text: history },
        { name: 'page', classification: 'PUBLIC', text: page },
      ],
      sources,
    });
  } catch (error) {
    if (error instanceof GatewayPolicyError) return fixed('UNAVAILABLE');
    throw error;
  }
  const output: SupportAnswer | null = response.output;
  if (!output) return fixed('UNAVAILABLE', response.run);

  if (output.kind === 'NEEDS_ACCOUNT') return fixed('BOUNDARY', response.run);
  if (output.kind === 'FEATURE_REQUEST' && output.featureSummary) {
    const summary = output.featureSummary.trim().replace(/[.!?]+$/, '');
    return {
      reply: { kind: 'FEATURE_REQUEST', text: messages.featureConfirm.replace('{summary}', summary), steps: [], citations: [], deepLink: null, answeredIn: request.locale, localeNote: null, offerEmail: false, featureRequest: { summary } },
      run: response.run,
    };
  }
  if (output.kind !== 'ANSWER' && output.kind !== 'STEPS') return fixed('DONT_KNOW', response.run);

  // Code, not the model, decides what counts as cited: only ids it was given, at least one.
  const byId = new Map(hits.map((hit, position) => [`S${position + 1}`, hit.article]));
  const cited = [...new Set(output.sources)].map((id) => byId.get(id)).filter((article): article is HelpArticle => Boolean(article));
  if (cited.length === 0) return fixed('DONT_KNOW', response.run);
  const steps = output.kind === 'STEPS' ? output.steps.map((step) => step.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean) : [];
  if (unsupportedFigures([output.answer, ...steps].join('\n'), cited.map(sourceText)).length > 0) return fixed('DONT_KNOW', response.run);

  const link = request.surface === 'APP' ? cited.find((article) => article.deepLink)?.deepLink : undefined;
  return {
    reply: {
      kind: steps.length > 0 ? 'STEPS' : 'ANSWER',
      text: output.answer,
      steps,
      citations: cited.map((article) => ({ title: article.title, href: resolveHref(article.url, request.page) })),
      deepLink: link ? { label: link.label, href: resolveHref(link.path, request.page) } : null,
      answeredIn: corpusLocale,
      localeNote: corpusLocale === request.locale ? null : messages.englishOnly,
      offerEmail: false,
      featureRequest: null,
    },
    run: response.run,
  };
}
