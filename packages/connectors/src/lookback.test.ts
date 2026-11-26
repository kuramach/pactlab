import { describe, expect, it } from 'vitest';
import { AnonymousAuth } from './github/auth';
import { GitHubLiveAdapter } from './github/live.adapter';
import { githubConnectionConfigSchema } from './github/types';
import { JiraLiveAdapter } from './jira/live.adapter';
import { jiraConnectionConfigSchema } from './jira/types';
import { DEFAULT_LOOKBACK_MONTHS, describeLookback, lookbackStart, withinLookback } from './lookback';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const monthsAgo = (months: number) => {
  const date = new Date(NOW);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString();
};
const scope = { organizationId: 'o', dealId: 'd', connectionId: 'c', credentialRef: null };

describe('lookback window (T-169)', () => {
  it('defaults to 24 months: 23 months is in, 25 months is out', () => {
    const start = lookbackStart(undefined, NOW);
    expect(DEFAULT_LOOKBACK_MONTHS).toBe(24);
    expect(start?.toISOString()).toBe('2024-11-26T12:00:00.000Z');
    expect(withinLookback(monthsAgo(23), start)).toBe(true);
    expect(withinLookback(monthsAgo(25), start)).toBe(false);
  });

  it('honours an override, and is all history only when explicitly set', () => {
    expect(lookbackStart(36, NOW)?.toISOString()).toBe('2023-11-26T12:00:00.000Z');
    expect(withinLookback(monthsAgo(30), lookbackStart(36, NOW))).toBe(true);
    expect(lookbackStart('ALL', NOW)).toBeNull();
    expect(withinLookback('1999-01-01T00:00:00Z', lookbackStart('ALL', NOW))).toBe(true);
    expect(describeLookback(undefined)).toBe('last 24 months');
    expect(describeLookback('ALL')).toBe('all history');
  });

  it('is part of both connection configs, optional, and rejects nonsense', () => {
    expect(githubConnectionConfigSchema.parse({ repository: 'a/b' }).lookbackMonths).toBeUndefined();
    expect(githubConnectionConfigSchema.parse({ repository: 'a/b', lookbackMonths: 'ALL' }).lookbackMonths).toBe('ALL');
    expect(jiraConnectionConfigSchema.safeParse({ site: 'a.atlassian.net', projectKeys: ['SYN'], lookbackMonths: 60 }).success).toBe(true);
    for (const bad of [0, -1, 1.5, 'forever', null]) expect(githubConnectionConfigSchema.safeParse({ repository: 'a/b', lookbackMonths: bad }).success, String(bad)).toBe(false);
  });
});

describe('GitHub live window', () => {
  const pull = (number: number, createdAt: string) => ({ number, state: 'open', title: 't', user: { login: 'u' }, created_at: createdAt, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' } });
  const live = (config: { lookbackMonths?: 'ALL' | number }, urls: string[]) =>
    new GitHubLiveAdapter({ repository: 'o/r', ...config }, () => new AnonymousAuth(), async (url) => {
      urls.push(url);
      const path = new URL(url).pathname;
      const body = path.endsWith('/pulls')
        ? [pull(1, monthsAgo(23)), pull(2, monthsAgo(25)), pull(3, monthsAgo(26))]
        : path.endsWith('/commits')
          ? []
          : { default_branch: 'main' };
      return new Response(JSON.stringify(body), { status: 200, headers: { link: '<https://api.github.com/x?page=2>; rel="next"' } });
    });

  it('asks for commits since the window start by default, and not at all for all history', async () => {
    const urls: string[] = [];
    await live({}, urls).listCommits(scope, { cursor: null, limit: 10 });
    const since = new URL(urls.find((url) => url.includes('/commits')) as string).searchParams.get('since');
    expect(since).not.toBeNull();
    expect(new Date(since as string).getTime()).toBeLessThan(Date.now() - 23 * 28 * 86_400_000);
    const all: string[] = [];
    await live({ lookbackMonths: 'ALL' }, all).listCommits(scope, { cursor: null, limit: 10 });
    expect(all.some((url) => url.includes('since='))).toBe(false);
  });

  it('keeps pull requests inside the window and stops paging at the first one outside', async () => {
    const page = await live({}, []).listPullRequests(scope, { cursor: null, limit: 10 });
    expect(page.pullRequests.map((entry) => entry.number)).toEqual([1]);
    expect(page.nextCursor).toBeNull();
    const longer = await live({ lookbackMonths: 30 }, []).listPullRequests(scope, { cursor: null, limit: 10 });
    expect(longer.pullRequests.map((entry) => entry.number)).toEqual([1, 2, 3]);
    const all = await live({ lookbackMonths: 'ALL' }, []).listPullRequests(scope, { cursor: null, limit: 10 });
    expect(all.pullRequests).toHaveLength(3);
    expect(all.nextCursor).toBe('2');
  });
});

describe('Jira live window', () => {
  const jqls = async (lookbackMonths?: 'ALL' | number) => {
    const queries: string[] = [];
    const adapter = new JiraLiveAdapter({ site: 'pactlab-synthetic.atlassian.net', projectKeys: ['SYN'], ...(lookbackMonths ? { lookbackMonths } : {}) }, {
      fetch: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/search/jql')) queries.push(parsed.searchParams.get('jql') ?? '');
        const body = parsed.pathname.endsWith('/field') || parsed.pathname.endsWith('/status') ? [] : parsed.pathname.includes('/project/') ? { key: 'SYN' } : { issues: [], isLast: true };
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });
    await adapter.listIssues(scope, { cursor: null, limit: 10 }).catch(() => undefined);
    return queries;
  };

  it('bounds the query to the window by default and not for all history', async () => {
    const [bounded] = await jqls();
    expect(bounded).toMatch(/^project in \(SYN\) AND updated >= "\d{4}-\d{2}-\d{2}" ORDER BY/);
    const [all] = await jqls('ALL');
    expect(all).toBe('project in (SYN) ORDER BY created ASC, key ASC');
  });
});
