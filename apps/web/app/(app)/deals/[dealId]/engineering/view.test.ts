import { describe, expect, it } from 'vitest';
import { displayName, percentLabel, TAG_LABELS, activityHref } from './view';

describe('engineering view helpers', () => {
  it('labels contributors pseudonymously unless names are shown', () => {
    expect(displayName({ label: 'Contributor 07', name: null })).toBe('Contributor 07');
    expect(displayName({ label: 'Contributor 07', name: 'Grace Okafor (synthetic)' })).toBe('Grace Okafor (synthetic) · Contributor 07');
  });
  it('formats ratios and explains every tag without judging people', () => {
    expect(percentLabel('0.0909')).toBe('9.1%');
    expect(percentLabel('0.5000')).toBe('50%');
    expect(percentLabel(null)).toBe('—');
    for (const tag of Object.values(TAG_LABELS)) expect(tag.help).not.toMatch(/poor|below par|underperform|fire/i);
  });
});

describe('drill-down links (T-129)', () => {
  it('opens a month of code or delivery, keeping filters', () => {
    expect(activityHref('d1', 'delivery', '2026-10')).toBe('/deals/d1/engineering/activity?kind=delivery&month=2026-10');
    expect(activityHref('d1', 'delivery', '2026-10', { type: 'Bug', status: undefined })).toBe('/deals/d1/engineering/activity?kind=delivery&month=2026-10&type=Bug');
    expect(activityHref('d1', 'code', '2026-09')).toBe('/deals/d1/engineering/activity?kind=code&month=2026-09');
  });
});
