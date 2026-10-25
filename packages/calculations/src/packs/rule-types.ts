/**
 * The shape of a pack finding rule, mirrored from `@pactlab/domain`
 * (`findings/rules.ts`) so rule code can live here, next to the decimal
 * arithmetic, without this package depending on the domain. The API composes
 * these rules into the domain registry; the TypeScript types must stay
 * structurally identical (checked where the API assembles them).
 */
export interface PackRuleEvidence {
  readonly id: string;
  readonly evidenceType: string;
  readonly sourceRecordId: string;
  readonly canonical: Readonly<Record<string, string | null>>;
}

export interface PackRulePage {
  readonly documentId: string;
  readonly pageNumber: number;
  readonly text: string;
}

export interface PackRuleQuote {
  readonly documentId: string;
  readonly pageNumber: number;
  readonly quote: string;
}

export interface PackRuleProposal {
  readonly key: string;
  readonly domain: 'FINANCIAL' | 'COMMERCIAL' | 'OPERATIONAL' | 'REGULATORY' | 'LEGAL' | 'PROPERTY' | 'PEOPLE';
  readonly title: string;
  readonly description: string;
  readonly severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly direction: -1 | 0 | 1;
  readonly directionRationale?: string | null;
  readonly pricedRisk?: {
    readonly type: 'PRICE_REDUCTION' | 'ESCROW' | 'INDEMNITY' | 'REMEDIATION_COST';
    readonly currency: string;
    readonly low: string;
    readonly high: string;
    readonly basis: string;
  } | null;
  readonly valueConfirmation?: {
    readonly valueDriver: string;
    readonly impliedValue: { readonly low: string; readonly high: string; readonly currency: string } | null;
    readonly basis: string;
  } | null;
  readonly evidenceIds: readonly string[];
  readonly quotes?: readonly PackRuleQuote[];
  /** A statement the finding settles for the claims register (T-083). */
  readonly claim?: { readonly statement: string; readonly status: 'VERIFIED' | 'CONTRADICTED'; readonly rationale: string } | null;
}

export interface PackRule {
  readonly id: string;
  readonly version: string;
  readonly evidenceTypes: readonly string[];
  readonly readsDocuments?: boolean;
  readonly detect: (context: { readonly evidence: readonly PackRuleEvidence[]; readonly pages: readonly PackRulePage[] }) => readonly PackRuleProposal[];
}

/** Most links one finding cites (the findings API accepts up to 50). */
export const MAX_CITED = 40;

/** Page text with line breaks and runs of whitespace collapsed — PDFs wrap a clause across lines. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Sentences of a page (collapsed); "22.3 The Bank …" stays whole because a sentence break needs a space after the stop. */
export function sentences(text: string): string[] {
  return collapse(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(“"])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Exact quotes are capped; the citation check needs a substring, not the whole page. */
const MAX_QUOTE = 400;
const cap = (text: string) => (text.length > MAX_QUOTE ? text.slice(0, MAX_QUOTE) : text);

/** The first match of `pattern` on any page, with its collapsed text as the quote. */
export function findMatch(pages: readonly PackRulePage[], pattern: RegExp): { page: PackRulePage; match: RegExpMatchArray; quote: string } | null {
  for (const page of pages) {
    const match = collapse(page.text).match(pattern);
    if (match) return { page, match, quote: cap(match[0]) };
  }
  return null;
}

/** The first sentence on any page that passes `test`. Whitespace-insensitive, like the citation check. */
export function findSentence(pages: readonly PackRulePage[], test: (sentence: string) => boolean): { page: PackRulePage; quote: string } | null {
  for (const page of pages) {
    const sentence = sentences(page.text).find(test);
    if (sentence) return { page, quote: cap(sentence) };
  }
  return null;
}
