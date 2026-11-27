import { assertKnowledgeOnly, type HelpArticle, type SupportAudience } from './corpus';

/**
 * Deterministic keyword search over the help corpus (T-175). The corpus is small and public, so it is
 * ranked in memory: BM25 over title (weighted twice), text and steps, a boost for help about the page
 * the person is on, and a smaller one for help pitched at their role. Same question, same articles.
 */
const STOP = new Set(
  'a an and are as at be by can could do does for from has have how i in is it its me my of on or our so that the their them then there these they this to us was we what when where which who why will with would you your about into just get got need want please tell'.split(' '),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem);
}

/** Light suffix stripping so "mapping", "maps" and "mapped" meet; never below three letters. */
function stem(word: string): string {
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 's']) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) return suffix === 'ies' || suffix === 'ied' ? `${word.slice(0, -suffix.length)}y` : word.slice(0, -suffix.length);
  }
  return word;
}

/** `/deals/<id>/sources/upload` matches the pattern `/deals/:dealId/sources/upload`. */
export function routeMatches(pattern: string, path: string): boolean {
  const want = pattern.split('/').filter(Boolean);
  const have = (path.split(/[?#]/)[0] ?? '').split('/').filter(Boolean);
  return want.length === have.length && want.every((part, index) => part.startsWith(':') || part === have[index]);
}

export interface SupportHit {
  readonly article: HelpArticle;
  readonly score: number;
}

export class SupportIndex {
  private readonly docs: { article: HelpArticle; terms: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(readonly articles: readonly HelpArticle[]) {
    assertKnowledgeOnly(articles);
    this.docs = articles.map((article) => {
      const words = [...tokens(article.title), ...tokens(article.title), ...tokens(article.text), ...(article.steps ?? []).flatMap(tokens)];
      const terms = new Map<string, number>();
      for (const word of words) terms.set(word, (terms.get(word) ?? 0) + 1);
      for (const word of terms.keys()) this.df.set(word, (this.df.get(word) ?? 0) + 1);
      return { article, terms, length: words.length };
    });
    this.avgLength = this.docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, this.docs.length);
  }

  /**
   * Articles that share words with the question, best first (at most `limit`). Page and role only lift
   * an article that already matches a word; they never return help the question did not ask about.
   */
  search(question: string, options: { page?: string; audience?: SupportAudience | null; limit?: number } = {}): SupportHit[] {
    const query = [...new Set(tokens(question))];
    if (query.length === 0) return [];
    const n = this.docs.length;
    const hits: SupportHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const word of query) {
        const tf = doc.terms.get(word);
        if (!tf) continue;
        const idf = Math.log(1 + (n - (this.df.get(word) ?? 0) + 0.5) / ((this.df.get(word) ?? 0) + 0.5));
        score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (doc.length / this.avgLength))));
      }
      if (score === 0) continue;
      if (options.page && doc.article.routes?.some((route) => routeMatches(route, options.page as string))) score *= 1.6;
      if (options.audience && doc.article.audience?.includes(options.audience)) score *= 1.15;
      hits.push({ article: doc.article, score });
    }
    // Ties break on the id, so the same question always reads the same articles.
    return hits.sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id)).slice(0, options.limit ?? 5);
  }
}
