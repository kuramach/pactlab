import { z } from 'zod';
import { neutralizeMarkup, type CitableSource } from './context';
import { sha256Hex } from './hash';
import { injectionRegions, type InjectionSpan } from './injection';

/** Shortest quote accepted as support; shorter strings match too easily. */
export const MIN_QUOTE_LENGTH = 12;

/** What a model proposes: a source it was given and an exact quote from it. */
export const proposedCitationSchema = z.strictObject({
  citationId: z.uuid(),
  quote: z.string().min(MIN_QUOTE_LENGTH).max(600),
});
export type ProposedCitation = z.infer<typeof proposedCitationSchema>;

/** A citation the server verified against stored page text. */
export interface ResolvedCitation {
  readonly citationId: string;
  readonly documentId: string;
  readonly pageNumber: number;
  /** Exact source text covered by the quote (original characters). */
  readonly quote: string;
  readonly quoteHash: string;
  readonly charStart: number;
  readonly charEnd: number;
}

export type CitationFailure =
  'NO_CITATION' | 'UNKNOWN_SOURCE' | 'QUOTE_TOO_SHORT' | 'QUOTE_NOT_FOUND' | 'INJECTION_SPAN';

export type CitationCheck =
  | { readonly ok: true; readonly citation: ResolvedCitation }
  | { readonly ok: false; readonly reason: CitationFailure };

interface Normalized {
  readonly text: string;
  /** Original index of each normalized character. */
  readonly map: readonly number[];
}

/** Collapse whitespace and neutralize markup, keeping an index map back to the original. */
function normalize(text: string): Normalized {
  const chars: string[] = [];
  const map: number[] = [];
  // UTF-16 code units, so offsets line up with String#slice.
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (/\s/.test(char)) {
      if (chars.length > 0 && chars[chars.length - 1] !== ' ') {
        chars.push(' ');
        map.push(index);
      }
      continue;
    }
    chars.push(neutralizeMarkup(char));
    map.push(index);
  }
  if (chars[chars.length - 1] === ' ') {
    chars.pop();
    map.pop();
  }
  return { text: chars.join(''), map };
}

export function quoteHash(quote: string): string {
  return sha256Hex(normalize(quote).text);
}

interface IndexedSource {
  readonly source: CitableSource;
  readonly normalized: Normalized;
  readonly injections: readonly InjectionSpan[];
}

/**
 * Index of the exact sources supplied to one model call. Citations resolve
 * only against this index: a citation ID the model was not given, or a quote
 * that is not on the cited page, never resolves.
 */
export class SourceIndex {
  private readonly sources = new Map<string, IndexedSource>();

  constructor(sources: readonly CitableSource[]) {
    for (const source of sources) {
      this.sources.set(source.citationId, {
        source,
        normalized: normalize(source.text),
        injections: injectionRegions(source.text),
      });
    }
  }

  verify(proposed: { readonly citationId: string; readonly quote: string }): CitationCheck {
    const indexed = this.sources.get(proposed.citationId);
    if (!indexed) return { ok: false, reason: 'UNKNOWN_SOURCE' };
    const quote = normalize(proposed.quote).text;
    if (quote.length < MIN_QUOTE_LENGTH) return { ok: false, reason: 'QUOTE_TOO_SHORT' };
    const at = indexed.normalized.text.indexOf(quote);
    if (at === -1) return { ok: false, reason: 'QUOTE_NOT_FOUND' };
    const charStart = indexed.normalized.map[at] ?? 0;
    const charEnd = (indexed.normalized.map[at + quote.length - 1] ?? charStart) + 1;
    if (indexed.injections.some((span) => span.start < charEnd && charStart < span.end)) {
      return { ok: false, reason: 'INJECTION_SPAN' };
    }
    const { source } = indexed;
    return {
      ok: true,
      citation: {
        citationId: source.citationId,
        documentId: source.documentId,
        pageNumber: source.pageNumber,
        quote: source.text.slice(charStart, charEnd),
        quoteHash: sha256Hex(quote),
        charStart,
        charEnd,
      },
    };
  }

  /** Flagged injection regions across all sources, for the AI run record. */
  injectionSignals(): string[] {
    return [...this.sources.values()].flatMap(({ source, injections }) =>
      injections.map((span) => `${source.citationId}:${span.signal}`),
    );
  }
}

export interface GroundedItem<T> {
  readonly item: T;
  readonly citations: readonly ResolvedCitation[];
}

export interface RejectedItem<T> {
  readonly item: T;
  readonly reasons: readonly CitationFailure[];
}

/**
 * An item is grounded only if it has at least one citation and every one of
 * its citations resolves. Partially supported items are rejected whole.
 */
export function groundItems<T extends { readonly citations: readonly ProposedCitation[] }>(
  items: readonly T[],
  index: SourceIndex,
): { grounded: GroundedItem<T>[]; rejected: RejectedItem<T>[] } {
  const grounded: GroundedItem<T>[] = [];
  const rejected: RejectedItem<T>[] = [];
  for (const item of items) {
    const checks = item.citations.map((citation) => index.verify(citation));
    const failures = checks.flatMap((check) => (check.ok ? [] : [check.reason]));
    if (checks.length === 0) rejected.push({ item, reasons: ['NO_CITATION'] });
    else if (failures.length > 0) rejected.push({ item, reasons: failures });
    else
      grounded.push({
        item,
        citations: checks.flatMap((check) => (check.ok ? [check.citation] : [])),
      });
  }
  return { grounded, rejected };
}

/**
 * Re-verify a stored citation against the current page text (display and
 * acceptance time). A changed page makes the citation stale.
 */
export function citationStillValid(citation: ResolvedCitation, pageText: string): boolean {
  const covered = pageText.slice(citation.charStart, citation.charEnd);
  return covered === citation.quote && quoteHash(covered) === citation.quoteHash;
}
