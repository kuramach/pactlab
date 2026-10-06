import { describe, expect, it } from 'vitest';
import { createJiraAdapter, createJiraEvidenceSource, JiraFixtureAdapter, type JiraIssue } from './index';

const scope = { organizationId: 'o', dealId: 'd', connectionId: 'c', credentialRef: null };

async function pull(site: string, projectKeys: string[]) {
  const adapter = new JiraFixtureAdapter({ site, projectKeys });
  return createJiraEvidenceSource(adapter, scope, adapter.unreadableProjects()).pull();
}

describe('Jira fixture connector', () => {
  it('returns delivery facts only — no people or free text', async () => {
    const { records } = await pull('healthyco.atlassian.net', ['HC']);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(Object.keys(record.canonical)).not.toEqual(expect.arrayContaining(['assignee']));
      expect(JSON.stringify(record)).not.toMatch(/assignee|reporter|summary|description|comment/i);
      expect(record.locator).toMatchObject({ kind: 'provider_record', system: 'jira', site: 'healthyco.atlassian.net' });
    }
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

  it('live mode makes no provider calls and fails validation clearly', async () => {
    const live = createJiraAdapter('LIVE', { site: 'troubledco.atlassian.net', projectKeys: ['TC'] })!;
    const result = await live.validateConnection({ ...scope, credentialRef: 'secretref:jira/token' });
    expect(result.ok).toBe(false);
    await expect(live.listIssues(scope, { cursor: null, limit: 1 })).rejects.toThrow(/not enabled/);
    expect(createJiraAdapter('FIXTURE', { site: 'not a site', projectKeys: [] })).toBeNull();
  });
});
