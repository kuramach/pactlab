import { describe, expect, it } from 'vitest';
import { pageApiQuery, pagerLinks, readPage } from './pager';

describe('the shared pager (T-126)', () => {
  it('reads a position, and starts over on anything it cannot trust', () => {
    expect(readPage({ cursor: 'abc_-1', trail: 'x1,y2' })).toEqual({ cursor: 'abc_-1', trail: ['x1', 'y2'] });
    expect(readPage({ 'users.cursor': 'abc' }, 'users')).toEqual({ cursor: 'abc', trail: [] });
    expect(readPage({ cursor: 'bad cursor!' })).toEqual({ trail: [] });
    expect(readPage({ trail: 'x1' })).toEqual({ trail: [] });
    expect(pageApiQuery({ cursor: 'abc', trail: ['x'] }, 50)).toBe('cursor=abc&limit=50');
  });

  it('labels the window and links both ways, keeping other parameters', () => {
    const first = pagerLinks({ itemCount: 50, total: 120, limit: 50, nextCursor: 'c2' }, { trail: [] }, { tab: 'users', q: 'ann' });
    expect(first).toEqual({ windowLabel: '1–50 of 120', previous: null, next: 'tab=users&q=ann&cursor=c2' });
    const third = pagerLinks({ itemCount: 20, total: 120, limit: 50, nextCursor: null }, { cursor: 'c3', trail: ['c2'] }, { tab: 'users', cursor: 'c3', trail: 'c2' });
    expect(third).toEqual({ windowLabel: '101–120 of 120', previous: 'tab=users&cursor=c2', next: null });
    const second = pagerLinks({ itemCount: 50, total: 120, limit: 50, nextCursor: 'c3' }, { cursor: 'c2', trail: [] }, { tab: 'users', cursor: 'c2' });
    expect(second.previous).toBe('tab=users');
    expect(second.next).toBe('tab=users&cursor=c3&trail=c2');
    expect(pagerLinks({ itemCount: 0, total: 0, limit: 50, nextCursor: null }, { trail: [] }, {}).windowLabel).toBeNull();
  });

  it('keeps several lists apart by prefix', () => {
    const links = pagerLinks({ itemCount: 50, total: 80, limit: 50, nextCursor: 'o2' }, { trail: [] }, { 'pacts.cursor': 'p2' }, 'orgs');
    expect(links.next).toBe('pacts.cursor=p2&orgs.cursor=o2');
  });
});
