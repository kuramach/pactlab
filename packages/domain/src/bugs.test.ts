import { describe, expect, it } from 'vitest';
import { bugFingerprint, bugReference, scrubContext } from './bugs';

describe('bug reports (T-072)', () => {
  it('scrubs planted secrets, emails and people data before storage', () => {
    const scrubbed = JSON.stringify(
      scrubContext({
        url: '/deals/x?token=abc123secret&page=2',
        headers: { authorization: 'Bearer abcdefghijklmnop', cookie: 'sid=1', accept: 'text/html' },
        message: 'Failed for kumar@example.com with key AKIAABCDEFGHIJKLMNOP and ghp_abcdefghijklmnopqrstuv',
        body: { password: 'hunter2', apiKey: 'k', amount: '120000', salary: '99000', nested: { jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl' } },
        stripe: 'sk_live_51Habcdefghijk',
      }),
    );
    for (const planted of ['abc123secret', 'abcdefghijklmnop', 'sid=1', 'kumar@example.com', 'AKIAABCDEFGHIJKLMNOP', 'ghp_abcdefghijklmnopqrstuv', 'hunter2', '99000', 'eyJhbGci', 'sk_live_51H']) {
      expect(scrubbed, planted).not.toContain(planted);
    }
    expect(scrubbed).toContain('page=2');
    expect(scrubbed).toContain('120000');
    expect(scrubbed).toContain('text/html');
  });

  it('fingerprints the same failure the same way across deals', () => {
    const stack = (id: string) => `TypeError: x is undefined\n    at render (/app/deals/${id}/page.js:10:5)\n    at run (/app/react.js:99:1)`;
    const a = bugFingerprint({ errorName: 'TypeError', stack: stack('01900000-0000-7000-8000-00000000c003'), route: '/deals/01900000-0000-7000-8000-00000000c003/findings' });
    const b = bugFingerprint({ errorName: 'TypeError', stack: stack('01900000-0000-7000-8000-00000000a003'), route: '/deals/01900000-0000-7000-8000-00000000a003/findings' });
    expect(a).toBe(b);
    expect(bugFingerprint({ errorName: 'RangeError', stack: stack('x'), route: '/deals/x/findings' })).not.toBe(a);
  });

  it('formats references', () => {
    expect(bugReference(42)).toBe('PLB-0042');
    expect(bugReference(12345)).toBe('PLB-12345');
  });
});
