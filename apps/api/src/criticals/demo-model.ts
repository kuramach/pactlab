import type { ModelRequest } from '@pactlab/ai';

/**
 * Synthetic model answers for Deal Criticals (T-179), used by the demo organization and tests so no
 * model is called: rule-based readings of the words and of the pages, shaped as a model would answer.
 */
const METRIC_WORDS: readonly [RegExp, string][] = [
  [/cap(?:italization)? rate/i, 'CAP_RATE'],
  [/occupancy.*low|lowest occupancy/i, 'OCCUPANCY_LOW'],
  [/occupancy|occupied/i, 'OCCUPANCY'],
  [/noi growth|net operating income growth/i, 'NOI_GROWTH'],
  [/rent growth/i, 'RENT_GROWTH'],
  [/expense ratio/i, 'EXPENSE_RATIO'],
  [/debt service coverage|dscr/i, 'DSCR'],
  [/anchor/i, 'ANCHOR_LEASE_YEARS'],
  [/net (?:revenue|dollar) retention|\bnrr\b|\bndr\b/i, 'NET_REVENUE_RETENTION'],
];

export function isCriticalPrompt(request: ModelRequest): boolean {
  return request.system.includes('red-line parameter, written in its own words') || request.system.includes('one metric an investment firm checks');
}

export function criticalModelResponse(request: ModelRequest): string {
  const prompt = request.messages[0]?.content ?? '';
  if (request.system.includes('red-line parameter, written in its own words')) {
    const words = /<words>([\s\S]*?)<\/words>/.exec(prompt)?.[1] ?? '';
    const metric = METRIC_WORDS.find(([pattern]) => pattern.test(words))?.[1] ?? null;
    const comparator = /at most|maximum|no more than|ceiling|below|under/i.test(words) ? 'AT_MOST' : /at least|minimum|no less than|floor|above|clear|or above|must be/i.test(words) ? 'AT_LEAST' : null;
    const threshold = /(\d+(?:\.\d+)?)\s*(?:%|x|years?|percent)/i.exec(words)?.[1] ?? /(\d+(?:\.\d+)?)/.exec(words)?.[1] ?? null;
    const lookback = /last (\d) years?/i.exec(words)?.[1];
    const band = /within (\d+(?:\.\d+)?) (?:points?|percentage points?)/i.exec(words)?.[1] ?? null;
    return JSON.stringify({
      metric,
      comparator,
      threshold,
      lookbackYears: lookback ? Number(lookback) : null,
      evenBand: band,
      question: metric && comparator && threshold ? null : 'Which metric and threshold does this critical set?',
    });
  }
  const metric = /Metric: (.+)/.exec(prompt)?.[1] ?? '';
  const terms = metric.toLowerCase().includes('debt service') ? /debt service coverage|dscr/i : metric.toLowerCase().includes('anchor') ? /anchor/i : /retention/i;
  const figures = [];
  for (const block of prompt.split('<untrusted_source ').slice(1)) {
    const citationId = /citation_id="([^"]+)"/.exec(block)?.[1] ?? '';
    const text = block.slice(block.indexOf('>') + 1, block.indexOf('</untrusted_source>'));
    for (const line of text.split('\n')) {
      if (!terms.test(line)) continue;
      const value = /(\d+(?:\.\d+)?)\s*(?:x|%|years?)/i.exec(line)?.[1];
      if (value && line.trim().length >= 12) figures.push({ value, period: null, citations: [{ citationId, quote: line.trim() }] });
    }
  }
  return JSON.stringify({ figures: figures.slice(0, 5) });
}
