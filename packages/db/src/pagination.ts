/**
 * Keyset pagination (T-126). A page is ordered by one sort key and then `id` (UUIDv7, unique), both
 * descending unless asked otherwise; the cursor is the last row's (key, id), opaque to clients.
 * Keyset rather than offset: page N costs the same as page 1, and rows inserted meanwhile never
 * shift a page or repeat a row.
 */
export interface PageRequest {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface PageResult<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly total: number;
  readonly limit: number;
}

type Key = string | number | null;

/** Opaque cursor for a row: base64url of `[key, id]`. */
export function encodeCursor(key: Key | Date, id: string): string {
  const value = key instanceof Date ? key.toISOString() : key;
  return Buffer.from(JSON.stringify([value, id]), 'utf8').toString('base64url');
}

/**
 * The `[key, id]` a cursor names, or null when it is not one of ours (the page then starts over).
 * The id is a row's UUID, or with `textId` a short text key (an aggregate's group, such as a model ID).
 */
export function decodeCursor(cursor: string | undefined, options: { textId?: boolean } = {}): { key: Key; id: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== 'string') return null;
    const [key, id] = value as [unknown, string];
    if (key !== null && typeof key !== 'string' && typeof key !== 'number') return null;
    if (options.textId ? !/^[\x20-\x7e]{1,200}$/.test(id) : !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { key: key as Key, id };
  } catch {
    return null;
  }
}

/**
 * The Prisma `where` that continues after a cursor, for `orderBy: [{ [field]: dir }, { id: dir }]`.
 * `asDate` turns the stored key back into a Date for timestamp columns.
 */
export function afterCursor(field: string, cursor: string | undefined, options: { direction?: 'asc' | 'desc'; asDate?: boolean } = {}): Record<string, unknown> {
  const position = decodeCursor(cursor);
  if (!position) return {};
  const op = (options.direction ?? 'desc') === 'desc' ? 'lt' : 'gt';
  const key = options.asDate && typeof position.key === 'string' ? new Date(position.key) : position.key;
  if (field === 'id') return { id: { [op]: position.id } };
  return { OR: [{ [field]: { [op]: key } }, { [field]: key, id: { [op]: position.id } }] };
}

/** Rows fetched with `take: limit + 1` → the page and the cursor after it. */
export function toPage<R extends { id: string }, T>(rows: readonly R[], request: PageRequest, total: number, keyOf: (row: R) => Key | Date, map: (row: R) => T): PageResult<T> {
  const page = rows.slice(0, request.limit);
  const last = page.at(-1);
  return {
    items: page.map(map),
    nextCursor: rows.length > request.limit && last ? encodeCursor(keyOf(last), last.id) : null,
    total,
    limit: request.limit,
  };
}
