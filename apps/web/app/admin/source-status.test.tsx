import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SourceStatusTable } from './source-status';

vi.mock('./actions', () => ({ checkSourcesNow: vi.fn() }));

const base = { source: 'imf-weo', label: 'IMF World Economic Outlook', checkedAt: '2026-11-18T08:30:00.000Z', lastOkAt: null, failingSince: null, detail: null };

describe('Admin → Health: public data sources (T-137 follow-up)', () => {
  it('says when nothing has been checked yet, and offers Check now', () => {
    const html = renderToStaticMarkup(<SourceStatusTable items={[]} />);
    expect(html).toContain('Not checked yet.');
    expect(html).toContain('Check now');
  });

  it('shows a reachable source with when it has been OK', () => {
    const html = renderToStaticMarkup(<SourceStatusTable items={[{ ...base, status: 'OK', lastOkAt: '2026-11-18T08:30:00.000Z' }]} />);
    expect(html).toContain('Reachable');
    expect(html).toContain('OK since 2026-11-18 08:30 UTC');
  });

  it('shows a failing source with since when and what came back', () => {
    const html = renderToStaticMarkup(<SourceStatusTable items={[{ ...base, status: 'FAILING', failingSince: '2026-11-17T02:30:00.000Z', detail: 'PROVIDER_ERROR · 403 text/html' }]} />);
    expect(html).toContain('Failing');
    expect(html).toContain('failing since 2026-11-17 02:30 UTC');
    expect(html).toContain('PROVIDER_ERROR · 403 text/html');
  });
});
