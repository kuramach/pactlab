import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSupportCorpusModule, siteSupportArticles } from './support-corpus';

const GENERATED = fileURLToPath(new URL('../../../packages/ai/src/support/site-corpus.generated.ts', import.meta.url));

describe('the help corpus the chat assistant answers from (T-175)', () => {
  it('is the site’s published content, written out unchanged', () => {
    const expected = renderSupportCorpusModule();
    if (process.env['UPDATE_SUPPORT_CORPUS'] === '1') writeFileSync(GENERATED, expected);
    expect(readFileSync(GENERATED, 'utf8'), 'site content changed: rerun with UPDATE_SUPPORT_CORPUS=1').toBe(expected);
  });

  it('covers the guides, FAQ, how it works, product, pricing and released industry pages, each with its address', () => {
    const articles = siteSupportArticles();
    const kinds = new Set(articles.map((article) => article.kind));
    for (const kind of ['GUIDE', 'FAQ', 'HOW_IT_WORKS', 'PRODUCT', 'PRICING', 'INDUSTRY', 'TRUST']) expect(kinds.has(kind as never), kind).toBe(true);
    expect(new Set(articles.map((article) => article.id)).size).toBe(articles.length);
    for (const article of articles) expect(article.url.startsWith('https://pactlab.ai/'), article.id).toBe(true);
    expect(articles.find((article) => article.id === 'product:valuation')?.url).toBe('https://pactlab.ai/product/valuation/');
  });
});
