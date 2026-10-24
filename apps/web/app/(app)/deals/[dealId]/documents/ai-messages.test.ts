import { describe, expect, it } from 'vitest';
import { AI_UNAVAILABLE, aiOutcome } from './ai-messages';

describe('AI unavailable messages', () => {
  it('says an expired sign-in is a sign-in problem, not "try again"', () => {
    expect(aiOutcome('AI_ACCESS')).toBe('ai-access');
    expect(AI_UNAVAILABLE['ai-access']).toMatch(/sign-in has expired/);
    expect(AI_UNAVAILABLE['ai-access']).not.toMatch(/try again in a moment/);
    expect(aiOutcome('AI_THROTTLED')).toBe('ai-throttled');
    expect(aiOutcome('AI_UNAVAILABLE')).toBe('ai-failed');
    expect(aiOutcome(undefined)).toBe('ai-off');
  });
});
