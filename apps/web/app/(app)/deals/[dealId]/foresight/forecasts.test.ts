import type { ForesightForecastsView } from '@pactlab/contracts';
import { describe, expect, it } from 'vitest';
import { aiMissingReason } from './forecasts';

/** Why a metric has no AI forecast, in words (moved down from the browser test when e2e turned AI on, T-113). */
describe('aiMissingReason', () => {
  const view = (over: Partial<ForesightForecastsView>) => ({ status: 'READY', notes: [], refreshedAt: '2026-11-14T00:00:00Z', ...over }) as unknown as ForesightForecastsView;

  it('says plainly when AI is off in the environment', () => {
    expect(aiMissingReason(view({}), false)).toBe('AI is off in this environment.');
  });

  it('says when it is still being prepared, or when Claude could not be reached', () => {
    expect(aiMissingReason(view({ status: 'RUNNING' }), true)).toBe('Being prepared now.');
    expect(aiMissingReason(view({ notes: ['AI forecasts unavailable (throttled)'] }), true)).toMatch(/couldn’t be reached \(last tried 2026-11-14\)/);
  });
});
