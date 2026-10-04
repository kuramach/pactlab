import { describe, expect, it } from 'vitest';
import { evidenceQuery, isUuidParam, parseEvidenceFilters } from './filters';

describe('evidence filters', () => {
  it('keeps only supported filters and valid cursors', () => {
    const filters = parseEvidenceFilters({
      type: 'billing.customer',
      visibility: 'EVERYTHING',
      recordId: [' hc-cus-0001 ', 'x'],
      cursor: 'not-a-uuid',
      organizationId: 'smuggled',
    });
    expect(filters).toEqual({ type: 'billing.customer', recordId: 'hc-cus-0001' });
  });

  it('builds API queries and next-page links', () => {
    const cursor = '01900000-0000-7000-8000-0000000d0001';
    expect(evidenceQuery({ type: 'management.kpi', visibility: 'SHARED' }, { cursor })).toBe(
      `type=management.kpi&visibility=SHARED&cursor=${cursor}`,
    );
    expect(evidenceQuery({})).toBe('');
    expect(isUuidParam(cursor)).toBe(true);
    expect(isUuidParam('../admin')).toBe(false);
  });
});
