import { describe, expect, it } from 'vitest';
import { createJiraAdapter, createJiraEvidenceSource, JiraFixtureAdapter, type JiraIssue } from './index';

const scope = { organizationId: 'o', dealId: 'd', connectionId: 'c', credentialRef: null };

async function pull(site: string, projectKeys: string[]) {
  const adapter = new JiraFixtureAdapter({ site, projectKeys });
  return createJiraEvidenceSource(adapter, scope, adapter.unreadableProjects()).pull();
}

describe('Jira fixture connector', () => {
  it('keeps names and account ids out of evidence; people go only to the gated directory', async () => {
    const { records, people } = await pull('healthyco.atlassian.net', ['HC']);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(Object.keys(record.canonical)).not.toEqual(expect.arrayContaining(['assignee', 'reporter']));
      expect(JSON.stringify(record)).not.toMatch(/summary|description|\(synthetic\)|hc-dev-|hc-lead-|hc-pm-/i);
      expect(record.locator).toMatchObject({ kind: 'provider_record', system: 'jira', site: 'healthyco.atlassian.net' });
    }
    const activity = records.filter((record) => record.evidenceType === 'delivery.contributor_activity');
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((record) => /^[0-9a-f]{16}$/.test(record.canonical['contributorKey'] ?? ''))).toBe(true);
    expect(people?.map((person) => person.identity).sort()).toEqual(['hc-dev-01', 'hc-dev-02', 'hc-dev-03', 'hc-dev-04', 'hc-dev-05', 'hc-dev-06', 'hc-lead-01', 'hc-pm-01']);
    expect(people?.find((person) => person.identity === 'hc-lead-01')?.displayName).toBe('Grace Okafor (synthetic)');
  });

  it('TroubledCo shows falling completion, a growing bug backlog and stale highest-priority defects', async () => {
    const adapter = new JiraFixtureAdapter({ site: 'troubledco.atlassian.net', projectKeys: ['TC'] });
    const sprints = await adapter.listSprints(scope);
    const ratios = sprints.map((sprint) => sprint.completedPoints / sprint.committedPoints);
    expect(ratios.every((ratio, i) => i === 0 || ratio < ratios[i - 1]!)).toBe(true);
    const issues: JiraIssue[] = [];
    let cursor: string | null = null;
    do {
      const page = await adapter.listIssues(scope, { cursor, limit: 25 });
      issues.push(...page.issues);
      cursor = page.nextCursor;
    } while (cursor);
    const openBugs = issues.filter((issue) => issue.type === 'Bug' && issue.statusCategory !== 'DONE');
    expect(openBugs.length).toBeGreaterThan(20);
    expect(openBugs.filter((issue) => issue.priority === 'Highest')).toHaveLength(4);
    expect(issues.some((issue) => issue.reopenCount > 0)).toBe(true);
  });

  it('SparseCo surfaces unestimated work, open-ended sprints and unreadable projects as source issues', async () => {
    const { issues } = await pull('sparseco.atlassian.net', ['SP', 'SPX']);
    expect(issues.some((issue) => issue.code === 'PERMISSION_DENIED' && issue.detail.includes('SPX'))).toBe(true);
    expect(issues.some((issue) => issue.code === 'MISSING_FIELD' && issue.detail.includes('story-point'))).toBe(true);
    expect(issues.some((issue) => issue.code === 'MISSING_FIELD' && issue.detail.includes('end date'))).toBe(true);
    const validation = await new JiraFixtureAdapter({ site: 'sparseco.atlassian.net', projectKeys: ['SPX'] }).validateConnection(scope);
    expect(validation.ok).toBe(false);
  });

  it('is deterministic and paginates without gaps', async () => {
    const first = await pull('troubledco.atlassian.net', ['TC']);
    const second = await pull('troubledco.atlassian.net', ['TC']);
    expect(second).toEqual(first);
    const ids = first.records.map((record) => record.sourceRecordId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects configurations that are not a plain host name', () => {
    expect(createJiraAdapter('FIXTURE', { site: 'not a site', projectKeys: [] })).toBeNull();
    for (const site of ['127.0.0.1', 'localhost', 'issues.apache.org:8443', 'user@issues.apache.org', '[::1]', 'Issues.Apache.org'])
      expect(createJiraAdapter('LIVE', { site, projectKeys: ['KAFKA'] }), site).toBeNull();
    expect(createJiraAdapter('LIVE', { site: 'issues.apache.org', basePath: '/../admin', projectKeys: ['KAFKA'] })).toBeNull();
    expect(createJiraAdapter('LIVE', { site: 'issues.apache.org', basePath: '/jira', projectKeys: ['KAFKA'] })).not.toBeNull();
  });
});
