import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { CLINICS_CODING_ABOVE_POLICY, CLINICS_EQUIPMENT_PAST_LIFE, CLINICS_PROVIDER_CARRIES_SITE } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });

describe('small clinics rules (T-068)', () => {
  it('a site where one pseudonymous provider earns half or more of revenue', () => {
    const evidence = ['2026-08', '2026-09'].flatMap((month) => [
      row('clinics.volume_month', `${month}-a`, { month, site: 'Site 3', provider_ref: 'P07', revenue: '750' }),
      row('clinics.volume_month', `${month}-b`, { month, site: 'Site 3', provider_ref: 'P08', revenue: '250' }),
      row('clinics.volume_month', `${month}-c`, { month, site: 'Site 1', provider_ref: 'P01', revenue: '400' }),
      row('clinics.volume_month', `${month}-d`, { month, site: 'Site 1', provider_ref: 'P02', revenue: '600' }),
    ]);
    const found = CLINICS_PROVIDER_CARRIES_SITE.detect({ evidence, pages: [] });
    expect(found.map((entry) => entry.title)).toEqual(['One provider carries Site 1', 'One provider carries Site 3']);
    expect(found[1]?.description).toMatch(/^P07 earns 75\.0% of Site 3 revenue over the 2 months to September 2026/);
  });

  it('coding above policy needs every quarter well above the benchmark and the policy text', () => {
    const quarters = ['2026-Q1', '2026-Q2'].map((quarter, index) => row('clinics.coding_quarter', quarter, { quarter, high_complexity_share: index ? '0.36' : '0.31', policy_benchmark: '0.15' }));
    const policy = [{ documentId: 'p', pageNumber: 1, text: 'Highest-complexity codes are expected for about 15% of visits.' }];
    expect(CLINICS_CODING_ABOVE_POLICY.detect({ evidence: quarters, pages: policy })[0]?.description).toMatch(/^From 2026-Q1 to 2026-Q2, 31\.0%–36\.0% of visits/);
    expect(CLINICS_CODING_ABOVE_POLICY.detect({ evidence: quarters, pages: [] })).toEqual([]);
    expect(CLINICS_CODING_ABOVE_POLICY.detect({ evidence: [...quarters, row('clinics.coding_quarter', 'q3', { quarter: '2026-Q3', high_complexity_share: '0.16', policy_benchmark: '0.15' })], pages: policy })).toEqual([]);
  });

  it('equipment past its useful life at the latest month, dated by billing or patient volume', () => {
    const volume = row('clinics.volume_month', 'v', { month: '2026-09', site: 'Site 1', provider_ref: 'P01', revenue: '1' });
    const evidence = [
      volume,
      row('clinics.equipment', 'x', { asset: 'Panoramic X-ray unit', site: 'Site 1', acquired: '2014-05-01', useful_life_years: '10', status: 'in service' }),
      row('clinics.equipment', 'c', { asset: 'Dental chairs (6)', site: 'Site 2', acquired: '2021-09-01', useful_life_years: '12', status: 'in service' }),
    ];
    const [found] = CLINICS_EQUIPMENT_PAST_LIFE.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ title: 'Imaging equipment past its useful life', evidenceIds: ['x'] });
    expect(found?.description).toMatch(/^1 item is in service past its useful life at 2026-09-30: Panoramic X-ray unit at Site 1 \(acquired 2014-05-01, 10-year life, ended 2024-05-01\)/);
    expect(CLINICS_EQUIPMENT_PAST_LIFE.detect({ evidence: evidence.slice(1), pages: [] })).toEqual([]);
  });
});
