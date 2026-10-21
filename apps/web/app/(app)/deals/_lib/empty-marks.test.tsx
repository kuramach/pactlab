import { EmptyState } from '@pactlab/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMPTY_MARKS, EmptyMarkIcon, type EmptyMark } from './empty-marks';

describe('empty-state marks', () => {
  it('covers the deals, sources and evidence empty states with distinct icons', () => {
    expect(Object.keys(EMPTY_MARKS).sort()).toEqual(['deals', 'evidence', 'sources']);
    expect(new Set(Object.values(EMPTY_MARKS)).size).toBe(3);
  });

  it('renders each as a decorative mark above the title', () => {
    for (const name of Object.keys(EMPTY_MARKS) as EmptyMark[]) {
      const html = renderToStaticMarkup(<EmptyState title="Nothing yet" description="d" icon={<EmptyMarkIcon name={name} />} />);
      expect(html).toMatch(/<span aria-hidden="true" data-mark=""[^>]*><svg/);
      expect(html.indexOf('data-mark')).toBeLessThan(html.indexOf('Nothing yet'));
    }
  });
});
