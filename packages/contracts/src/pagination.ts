import { z } from 'zod';

/**
 * Pagination (T-126, CLAUDE.md "Lists are paginated"): every list endpoint takes `?cursor=&limit=`
 * and answers with a `Page`. The cursor is opaque (base64url); clients pass back `nextCursor` as is.
 */
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;
export const PAGE_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,400}$/;

export const pageQuerySchema = z.object({
  cursor: z.string().regex(PAGE_CURSOR_PATTERN).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  readonly items: T[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  readonly nextCursor: string | null;
  /** Rows matching the filters, across all pages. */
  readonly total: number;
  /** The page size the API applied. */
  readonly limit: number;
}
