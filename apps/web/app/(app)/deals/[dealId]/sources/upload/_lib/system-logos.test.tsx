import { BILLING_SYSTEMS } from '@pactlab/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { markFor, monogramOf, SYSTEM_MARKS, SystemLogo } from './system-logos';

describe('billing system logos', () => {
  it('maps every system id the API can return', () => {
    for (const system of BILLING_SYSTEMS) expect(SYSTEM_MARKS[system], system).toBeDefined();
    expect(Object.keys(SYSTEM_MARKS).sort()).toEqual([...BILLING_SYSTEMS].sort());
  });

  it('draws brand marks from a recorded source, never an external image', () => {
    for (const mark of Object.values(SYSTEM_MARKS)) {
      if (mark.kind !== 'brand') continue;
      expect(mark.source).toMatch(/^https:\/\//);
      expect(mark.path).toMatch(/^M/);
    }
    const html = Object.keys(SYSTEM_MARKS).map((system) => renderToStaticMarkup(<SystemLogo system={system} label={system} />)).join('');
    expect(html).not.toMatch(/<img|(?:src|href)="https?:/);
  });

  it('is decorative and always renders something', () => {
    for (const system of Object.keys(SYSTEM_MARKS)) {
      const html = renderToStaticMarkup(<SystemLogo system={system} label={system} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toMatch(/<svg|<span class="text-\[11px\]/);
    }
  });

  it('falls back to a monogram for an id it does not know', () => {
    expect(markFor('xero', 'Xero Accounting')).toEqual({ kind: 'monogram', letters: 'XA' });
    expect(monogramOf('Zuora')).toBe('ZU');
    expect(monogramOf('')).toBe('?');
  });
});
