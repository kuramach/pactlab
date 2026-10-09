import { describe, expect, it } from 'vitest';
import { describeAction } from './actions';

describe('describeAction', () => {
  it('uses plain language for known actions and a readable fallback otherwise', () => {
    expect(describeAction('pact.started')).toBe('Started a Pact');
    expect(describeAction('finding.review_recorded')).toBe('Finding review recorded');
  });
});
