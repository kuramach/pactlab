import { PAGE_CURSOR_PATTERN, type Page } from '@pactlab/contracts';
import Link from 'next/link';
import { EN, type I18n } from '../../lib/i18n';

/**
 * The one pager for every list (T-126, CLAUDE.md "Lists are paginated"): "51–100 of 342" with
 * Previous and Next. The position lives in the URL (`cursor`, plus `trail` of earlier cursors so
 * Previous can step back), under a prefix when a page has several lists.
 */
export interface PagePosition {
  readonly cursor?: string;
  /** Cursors of the earlier pages, oldest first (page 1 has none). */
  readonly trail: readonly string[];
}

/** Deepest page a trail may describe; beyond it the URL would grow unreasonably long. */
export const MAX_TRAIL = 100;

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const keyOf = (prefix: string, name: string) => (prefix ? `${prefix}.${name}` : name);

/** Where the reader is in one list. Anything we cannot trust starts again at page 1. */
export function readPage(params: SearchParams, prefix = ''): PagePosition {
  const cursor = first(params[keyOf(prefix, 'cursor')]);
  const trail = (first(params[keyOf(prefix, 'trail')]) ?? '').split(',').filter(Boolean);
  if (!cursor || !PAGE_CURSOR_PATTERN.test(cursor) || trail.length > MAX_TRAIL || !trail.every((entry) => PAGE_CURSOR_PATTERN.test(entry))) return { trail: [] };
  return { cursor, trail };
}

/** The API query for this position: the cursor only (the trail stays in the browser's URL). */
export function pageApiQuery(position: PagePosition, limit?: number): string {
  const query = new URLSearchParams();
  if (position.cursor) query.set('cursor', position.cursor);
  if (limit) query.set('limit', String(limit));
  return query.toString();
}

export interface PagerLinks {
  /** "51–100 of 342"; null when nothing matches. */
  readonly windowLabel: string | null;
  /** Query strings for the neighbouring pages, keeping every other parameter; null when there is none. */
  readonly previous: string | null;
  readonly next: string | null;
}

/**
 * Position and neighbours of the current page. Pages before this one were full, so the window
 * starts at (pages before) × limit + 1. `keep` is every other parameter of the URL (filters, other lists).
 */
export function pagerLinks(page: Pick<Page<unknown>, 'nextCursor' | 'total' | 'limit'> & { itemCount: number }, position: PagePosition, keep: Record<string, string>, prefix = '', t: I18n = EN): PagerLinks {
  const before = position.cursor ? position.trail.length + 1 : 0;
  const start = before * page.limit + 1;
  const at = (cursor: string | undefined, trail: readonly string[]) => {
    const query = new URLSearchParams(Object.entries(keep).filter(([key]) => key !== keyOf(prefix, 'cursor') && key !== keyOf(prefix, 'trail')));
    if (cursor) {
      query.set(keyOf(prefix, 'cursor'), cursor);
      if (trail.length > 0) query.set(keyOf(prefix, 'trail'), trail.join(','));
    }
    return query.toString();
  };
  return {
    windowLabel: page.itemCount === 0 ? null : t.fill(t.m.common.pager.window, { start: t.number(start), end: t.number(start + page.itemCount - 1), total: t.number(page.total) }),
    previous: position.cursor ? at(position.trail.at(-1), position.trail.slice(0, -1)) : null,
    next: page.nextCursor ? at(page.nextCursor, position.cursor ? [...position.trail, position.cursor] : []) : null,
  };
}

/** Every other parameter of the current URL, for `keep`. */
export function keepParams(params: SearchParams): Record<string, string> {
  return Object.fromEntries(Object.entries(params).flatMap(([key, value]) => (typeof first(value) === 'string' ? [[key, first(value) as string]] : [])));
}

/** "51–100 of 342" with Previous and Next; an unavailable direction is shown disabled, never hidden. */
export function Pager({ label, links, base, t = EN }: { label: string; links: PagerLinks; base: string; t?: I18n }) {
  const words = t.m.common.pager;
  if (!links.windowLabel) return null;
  const href = (query: string) => (query ? `${base}?${query}` : base);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-4 px-3 py-2 text-sm">
      <span className="text-muted-foreground" data-numeric>
        {links.windowLabel}
      </span>
      {links.previous !== null ? (
        <Link href={href(links.previous)} className="font-medium hover:underline">
          {words.previous}
        </Link>
      ) : (
        <span aria-disabled="true" className="cursor-not-allowed text-muted-foreground/60">
          {words.previous}
        </span>
      )}
      {links.next !== null ? (
        <Link href={href(links.next)} className="font-medium hover:underline">
          {words.next}
        </Link>
      ) : (
        <span aria-disabled="true" className="cursor-not-allowed text-muted-foreground/60">
          {words.next}
        </span>
      )}
    </nav>
  );
}
