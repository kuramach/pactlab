import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ fileBugReport: vi.fn() }));
vi.mock('./capture', () => ({ captureAppView: vi.fn(), pageContext: () => ({}) }));

import { BugReporter, isNoise } from './bug-reporter';

describe('the bug reporter opens only on a click (Kumar, 2026-11-25)', () => {
  it('renders the button and no prompt until the person clicks', () => {
    const html = renderToStaticMarkup(<BugReporter appVersion="1" environment="test" />);
    expect(html).toContain('aria-label="Report a bug"');
    expect(html).not.toContain('send a bug report');
    expect(html).not.toContain('bug-logged-dot');
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  });

  it('ignores browser noise that is not a Pactlab bug', () => {
    expect(isNoise({ name: 'Error', message: 'ResizeObserver loop completed with undelivered notifications.' })).toBe(true);
    expect(isNoise({ name: 'Error', message: 'Script error.' })).toBe(true);
    expect(isNoise({ name: 'AbortError', message: 'The operation was aborted.' })).toBe(true);
    expect(isNoise({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'id')" })).toBe(false);
  });
});
