import { describe, expect, it } from 'vitest';
import { afterCursor, decodeCursor, encodeCursor, toPage } from './pagination';

const ID = '01900000-0000-7000-8000-000000000001';

describe('keyset pagination', () => {
  it('round-trips a cursor and refuses anything else', () => {
    expect(decodeCursor(encodeCursor('Acme', ID))).toEqual({ key: 'Acme', id: ID });
    expect(decodeCursor(encodeCursor(new Date('2026-11-16T00:00:00.000Z'), ID))).toEqual({ key: '2026-11-16T00:00:00.000Z', id: ID });
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify(['a', 'x'])).toString('base64url'))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('continues after the last row: earlier key, or the same key and an earlier id', () => {
    expect(afterCursor('name', encodeCursor('Beta', ID), { direction: 'asc' })).toEqual({ OR: [{ name: { gt: 'Beta' } }, { name: 'Beta', id: { gt: ID } }] });
    const created = afterCursor('createdAt', encodeCursor(new Date('2026-11-16T00:00:00.000Z'), ID), { asDate: true });
    expect(created).toEqual({ OR: [{ createdAt: { lt: new Date('2026-11-16T00:00:00.000Z') } }, { createdAt: new Date('2026-11-16T00:00:00.000Z'), id: { lt: ID } }] });
    expect(afterCursor('id', encodeCursor(null, ID))).toEqual({ id: { lt: ID } });
    expect(afterCursor('name', undefined)).toEqual({});
  });

  it('a page of limit + 1 rows has a next cursor at its last row; a short one has none', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `0190000${n}-0000-7000-8000-000000000000`, name: `n${n}` }));
    const full = toPage(rows, { limit: 2 }, 3, (row) => row.name, (row) => row.name);
    expect(full).toMatchObject({ items: ['n1', 'n2'], total: 3, limit: 2 });
    expect(decodeCursor(full.nextCursor!)).toEqual({ key: 'n2', id: rows[1]!.id });
    expect(toPage(rows, { limit: 5 }, 3, (row) => row.name, (row) => row.name).nextCursor).toBeNull();
  });
});
