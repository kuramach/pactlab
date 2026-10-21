import { describe, expect, it } from 'vitest';
import { engineeringReport, type CodeActivity, type DeliveryActivity } from '.';

const code = (key: string, month: string, commits: number, areas: Record<string, number>): CodeActivity => ({
  contributorKey: key,
  month,
  commits,
  additions: commits * 10,
  deletions: commits,
  areas,
});
const work = (key: string, month: string, values: Partial<DeliveryActivity>): DeliveryActivity => ({
  contributorKey: key,
  month,
  issuesResolved: 0,
  pointsResolved: 0,
  issuesCreated: 0,
  comments: 0,
  resolvedReopened: 0,
  sprints: 0,
  ...values,
});

// Six people: dev-a alone maintains billing; lead commits little but coordinates; dev-f went quiet.
const CODE: CodeActivity[] = [
  code('dev-a', '2026-07', 12, { billing: 12 }),
  code('dev-a', '2026-08', 10, { billing: 10 }),
  code('dev-b', '2026-08', 6, { web: 6 }),
  code('dev-c', '2026-08', 5, { web: 3, api: 2 }),
  code('dev-d', '2026-09', 7, { api: 5, web: 1, infra: 1 }),
  code('lead', '2026-09', 1, { infra: 1 }),
  code('dev-f', '2026-02', 4, { api: 4 }),
];
const DELIVERY: DeliveryActivity[] = [
  work('lead', '2026-08', { issuesCreated: 18, comments: 40, issuesResolved: 6, pointsResolved: 20 }),
  work('lead', '2026-09', { issuesCreated: 12, comments: 30, issuesResolved: 4, pointsResolved: 10 }),
  work('dev-b', '2026-08', { issuesResolved: 5, pointsResolved: 25, resolvedReopened: 1 }),
  work('dev-c', '2026-09', { issuesResolved: 4, pointsResolved: 20, issuesCreated: 1, comments: 2 }),
];
const statuses = new Map([
  ['dev-a', 'CURRENT'],
  ['dev-b', 'CURRENT'],
  ['dev-c', 'CURRENT'],
  ['dev-d', 'CURRENT'],
  ['lead', 'CURRENT'],
  ['dev-f', 'DEPARTED'],
] as const);

const report = () => engineeringReport({ code: CODE, delivery: DELIVERY, statuses, asOfMonth: '2026-09' });

describe('engineeringReport', () => {
  it('summarizes the team by month, area and bus factor', () => {
    const result = report();
    expect(result.window).toEqual({ from: '2025-10', to: '2026-09' });
    expect(result.months.find((month) => month.month === '2026-08')).toEqual({
      month: '2026-08',
      commits: 21,
      codeContributors: 3,
      deliveryContributors: 2,
      issuesResolved: 11,
      pointsResolved: 45,
      reopenRate: '0.0909',
    });
    expect(result.areas.find((area) => area.area === 'billing')).toEqual({ area: 'billing', commits: 22, contributors: 1, busFactor: 1 });
    // dev-a alone holds 22 of 45 commits; with dev-d (7) they pass half.
    expect(result.busFactor).toBe(2);
    expect(result.unmatchedOrDepartedShare).toBe('0.0889');
  });

  it('describes each contributor with tags, never a score or a rank', () => {
    const { profiles, keepList } = report();
    const byKey = Object.fromEntries(profiles.map((profile) => [profile.contributorKey, profile]));
    expect(byKey['dev-a']).toMatchObject({ tags: ['CRITICAL_OWNER', 'BUILDER'], areasSolelyOwned: ['billing'] });
    expect(byKey['lead']?.tags).toContain('COORDINATOR');
    expect(byKey['lead']?.summary).toMatch(/likely a lead or coordinator/);
    expect(byKey['dev-d']?.tags).toContain('CROSS_AREA');
    expect(byKey['dev-f']).toMatchObject({ status: 'DEPARTED', tags: ['RECENTLY_QUIET'] });
    expect(profiles.map((profile) => profile.label)).toEqual(['Contributor 01', 'Contributor 02', 'Contributor 03', 'Contributor 04', 'Contributor 05', 'Contributor 06']);
    for (const profile of profiles) {
      expect(Object.keys(profile)).not.toEqual(expect.arrayContaining(['score']));
      expect(Object.keys(profile)).not.toEqual(expect.arrayContaining(['rank']));
    }
    // Keep the critical owner and the coordinator; the departed contributor is not a retention target.
    expect(keepList.map((entry) => entry.contributorKey).sort()).toEqual(['dev-a', 'lead']);
  });

  it('withholds individual profiles for teams under five', () => {
    const small = engineeringReport({
      code: CODE.filter((row) => ['dev-a', 'dev-b', 'dev-c'].includes(row.contributorKey)),
      delivery: [],
      statuses,
      asOfMonth: '2026-09',
    });
    expect(small).toMatchObject({ suppressed: true, profiles: [], keepList: [], contributors: 3 });
    expect(small.months.length).toBe(12);
  });
});
