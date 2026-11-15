import { describe, expect, it } from 'vitest';
import { periodOf } from './hosting-cost';

describe('hosting cost periods', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  it('turns presets into whole UTC months, the end not included', () => {
    expect(periodOf('this-month', '', '', now)).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(periodOf('last-month', '', '', now)).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(periodOf('3m', '', '', now)).toEqual({ from: '2026-09-01', to: '2026-12-01' });
    expect(periodOf('12m', '', '', now)).toEqual({ from: '2025-12-01', to: '2026-12-01' });
  });
  it('takes custom dates only when they make a period', () => {
    expect(periodOf('custom', '2026-10-05', '2026-10-20', now)).toEqual({ from: '2026-10-05', to: '2026-10-20' });
    expect(periodOf('custom', '2026-10-20', '2026-10-05', now)).toEqual({ from: '2026-11-01', to: '2026-12-01' });
  });
});
