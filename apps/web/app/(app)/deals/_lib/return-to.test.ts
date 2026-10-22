import { describe, expect, it } from 'vitest';
import { parseReturn, withReturn } from './return-to';

const deal = '01900000-0000-7000-8000-0000000a0001';
const other = '01900000-0000-7000-8000-0000000b0001';
const finances = `/deals/${deal}/finances?asOf=2026-09&open=metric-mrr#metric-mrr`;

describe('origin-aware return links', () => {
  it('a drill-down link carries its origin, keeping the target query', () => {
    expect(withReturn(`/deals/${deal}/evidence/e1`, finances)).toBe(`/deals/${deal}/evidence/e1?from=${encodeURIComponent(finances)}`);
    expect(withReturn('/x?a=1#top', '/deals/d')).toBe('/x?a=1&from=%2Fdeals%2Fd#top');
  });

  it('round-trips the reported path: Finances with its state', () => {
    expect(parseReturn(finances, deal)).toEqual({ href: finances, label: 'Finances' });
  });

  it('labels each deal section from the path, never from the URL', () => {
    expect(parseReturn(`/deals/${deal}/findings?status=DRAFT`, deal)?.label).toBe('Findings');
    expect(parseReturn(`/deals/${deal}/findings/f1`, deal)?.label).toBe('Finding');
    expect(parseReturn(`/deals/${deal}/evidence?type=t&cursor=c`, deal)?.label).toBe('Evidence');
    expect(parseReturn(`/deals/${deal}`, deal)?.label).toBe('Overview');
  });

  it('is absent when there is no origin', () => {
    expect(parseReturn(undefined, deal)).toBeNull();
    expect(parseReturn('', deal)).toBeNull();
    expect(parseReturn(['/deals/x'], deal)).toBeNull();
  });

  it('ignores anything outside this deal — never an open redirect', () => {
    for (const bad of [
      'https://evil.example/deals/' + deal,
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      `/deals/${other}/finances`,
      `/deals/${deal}evil/finances`,
      `/deals/${deal}/../${other}/finances`,
      `/deals/${deal}/%2e%2e/%2e%2e/admin`,
      `/deals/${deal}/finances\n`,
      `/deals/${deal}/settings-unknown`,
      '/settings',
      `/deals/${deal}/` + 'a'.repeat(3000),
    ]) {
      expect(parseReturn(bad, deal), bad).toBeNull();
    }
  });
});
