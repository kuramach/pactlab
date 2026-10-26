import { describe, expect, it } from 'vitest';
import { createGitHubEvidenceSource, GitHubFixtureAdapter, GITHUB_FIXTURES } from './github';
import { SCALECO_ENGINEERS, SCALECO_REPOSITORY } from './github/scale-fixture';
import { createJiraEvidenceSource, JiraFixtureAdapter, JIRA_FIXTURES } from './jira';

const scope = { organizationId: 'o', dealId: 'scaleco-deal', connectionId: 'c', credentialRef: null };

describe('ScaleCo, the 3,000-engineer fixture (T-055)', () => {
  it('is listed with the synthetic sources and generated deterministically', () => {
    expect(Object.keys(GITHUB_FIXTURES)).toContain(SCALECO_REPOSITORY);
    expect(Object.keys(JIRA_FIXTURES)).toContain('scaleco.atlassian.net');
    const first = GITHUB_FIXTURES[SCALECO_REPOSITORY];
    expect(first?.commits.length).toBeGreaterThan(25_000);
    expect(first?.identityMap).toHaveLength(SCALECO_ENGINEERS);
    expect(GITHUB_FIXTURES[SCALECO_REPOSITORY]?.commits[0]).toEqual(first?.commits[0]);
  });

  it('syncs to contributor activity for every engineer, in code and in delivery, joined by identity', async () => {
    const code = await createGitHubEvidenceSource(new GitHubFixtureAdapter({ repository: SCALECO_REPOSITORY }), scope).pull();
    const delivery = await createJiraEvidenceSource(new JiraFixtureAdapter({ site: 'scaleco.atlassian.net', projectKeys: ['SC'] }), scope).pull();
    const keys = (records: typeof code.records, type: string) => new Set(records.filter((record) => record.evidenceType === type).map((record) => record.canonical['contributorKey']));
    const committers = keys(code.records, 'code.contributor_activity');
    const deliverers = keys(delivery.records, 'delivery.contributor_activity');
    expect(committers.size).toBeGreaterThan(2_800);
    // Delivery counts people with resolved or reported work; a few have only open issues.
    expect(deliverers.size).toBeGreaterThan(2_700);
    // The same person is the same contributor key in both systems.
    expect([...committers].filter((key) => deliverers.has(key)).length).toBeGreaterThan(2_500);
    expect(new Set([...committers, ...deliverers]).size).toBeLessThanOrEqual(SCALECO_ENGINEERS);
    expect(code.issues).toEqual([]);
  }, 60_000);
});
