import { describe, expect, it } from 'vitest';
import { bestFeatureMatch, featureRequestReference, featureSimilarity, isTouchPath, proposeTask, REQUESTER_STATUS, screenFeatureRequest } from './feature-requests';

describe('feature requests (T-176)', () => {
  it('numbers references', () => expect(featureRequestReference(7)).toBe('FR-0007'));

  it('says "approved" means a task exists, not a date', () => {
    expect(REQUESTER_STATUS.APPROVED.text).toMatch(/task/);
    expect(REQUESTER_STATUS.APPROVED.text).toMatch(/not a date/);
  });

  it('suggests near-duplicates and leaves different asks alone', () => {
    const existing = [{ id: 'a', title: 'Export findings to Excel', description: 'I want to export the findings list to an Excel file' }, { id: 'b', title: 'Dark mode', description: 'A dark theme for the app' }];
    expect(bestFeatureMatch({ title: 'Excel export of findings', description: 'Let me export findings into excel' }, existing)?.id).toBe('a');
    expect(bestFeatureMatch({ title: 'Slack notifications for new findings', description: 'Tell my team in a channel' }, existing)).toBeNull();
    expect(featureSimilarity('', 'anything')).toBe(0);
  });

  it('screens spam on the public intake', () => {
    expect(screenFeatureRequest({ title: 'Export findings to Excel', description: 'So I can share them with my partner' })).toEqual({ ok: true });
    expect(screenFeatureRequest({ title: 'Cheap pills', description: 'visit http://a.example and https://b.example' })).toEqual({ ok: false, reason: 'LINKS' });
    expect(screenFeatureRequest({ title: 'aaaaaaaaaaaaaaaa', description: 'x' })).toEqual({ ok: false, reason: 'REPEATED' });
    expect(screenFeatureRequest({ title: 'BUY NOW BEST PRICE GUARANTEED LOWEST', description: 'CLICK HERE TODAY ONLY' })).toEqual({ ok: false, reason: 'SHOUTING' });
    expect(screenFeatureRequest({ title: 'hi', description: 'ok' })).toEqual({ ok: false, reason: 'TOO_SHORT' });
  });

  it('proposes a task from the surface, and accepts only repo paths in Touches', () => {
    expect(proposeTask({ surface: 'SITE', page: '/' }).touches).toContain('apps/site');
    expect(proposeTask({ surface: 'APP', page: '/findings' }).touches).toContain('apps/web');
    expect(isTouchPath('apps/web')).toBe(true);
    expect(isTouchPath('apps/web\nNeeds: x')).toBe(false);
    expect(isTouchPath('../etc')).toBe(false);
  });
});
