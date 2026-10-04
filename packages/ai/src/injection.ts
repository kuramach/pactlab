/**
 * Heuristic detector for instructions embedded in untrusted content
 * (contracts, data-room files, provider payloads). Detection never grants
 * trust: content is always delimited as data. Flagged spans are reported on
 * the AI run and can never serve as the citation for a claim.
 */
export interface InjectionSpan {
  readonly start: number;
  readonly end: number;
  readonly signal: string;
}

const SIGNALS: readonly (readonly [string, RegExp])[] = [
  [
    'override-instructions',
    /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|system|all)\b[^.\n]{0,20}\b(instructions?|prompts?|directions?|rules?)\b/gi,
  ],
  ['role-impersonation', /(^|\n)\s*(system|assistant|developer)\s*(prompt|message)?\s*:/gi],
  ['persona-change', /\byou are now\b/gi],
  ['new-instructions', /\b(new|updated|override|additional)\s+instructions?\b/gi],
  [
    'approval-command',
    /\b(mark|set|record|treat)\b[^.\n]{0,30}\b(finding|findings|review|clause|answer|this)\b[^.\n]{0,20}\b(accepted|approved|resolved|verified)\b/gi,
  ],
  ['suppression', /\bdo not\s+(cite|mention|report|disclose|flag)\b/gi],
  ['delimiter-tag', /<\/?\s*(untrusted_source|system|instructions?|assistant)\b[^>]*>/gi],
];

export function detectInjection(text: string): InjectionSpan[] {
  const spans: InjectionSpan[] = [];
  for (const [signal, pattern] of SIGNALS) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length, signal });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Expand detections to the enclosing sentence or line so a quote of the
 * surrounding instruction text is caught too.
 */
export function injectionRegions(text: string): InjectionSpan[] {
  return detectInjection(text).map((span) => {
    const before = text.slice(0, span.start);
    const start = Math.max(before.lastIndexOf('\n'), before.search(/[.!?][^.!?]*$/)) + 1;
    const rest = text.slice(span.end);
    const stop = rest.search(/[.!?\n]/);
    return { ...span, start, end: stop === -1 ? text.length : span.end + stop + 1 };
  });
}
