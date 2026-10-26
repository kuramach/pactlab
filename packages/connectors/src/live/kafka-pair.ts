import { issueForLink, linksForIssue, type IssueLink } from '../cross-links';
import { AnonymousAuth, GitHubLiveAdapter, issueLinksOf, readAllCommits, type GitHubAuth } from '../github';
import type { FetchLike } from '../http/cassette';
import { JiraLiveAdapter } from '../jira';

/**
 * The Apache Kafka integration pair (T-074): apache/kafka on GitHub and
 * project KAFKA on issues.apache.org/jira, read through the live adapters.
 * Shared by the recorded (PR gate) and live (INTEGRATION_LIVE=1) suites so
 * both exercise the same path.
 */
export const KAFKA_REPOSITORY = 'apache/kafka';
export const APACHE_JIRA = { site: 'issues.apache.org', basePath: '/jira', projectKeys: ['KAFKA'] } as const;
export const APACHE_POLICY = { selfHostedHosts: ['issues.apache.org'] };
export const scope = { organizationId: 'kafka-pair', dealId: 'kafka-pair', connectionId: 'kafka-pair', credentialRef: null };

export function kafkaAdapters(fetchFor: { github: FetchLike; jira: FetchLike }, auth: GitHubAuth = new AnonymousAuth()) {
  return {
    github: new GitHubLiveAdapter({ repository: KAFKA_REPOSITORY }, () => auth, fetchFor.github),
    jira: new JiraLiveAdapter({ ...APACHE_JIRA, projectKeys: [...APACHE_JIRA.projectKeys] }, { fetch: fetchFor.jira, policy: APACHE_POLICY }),
  };
}

/**
 * Both directions on a small sample: commits and pull requests name KAFKA
 * keys (code → issue), and each resolved issue finds the code that names it
 * (issue → code).
 */
export async function crossLinkSample(adapters: ReturnType<typeof kafkaAdapters>, size = 3) {
  const commits = (await adapters.github.listCommits(scope, { cursor: null, limit: size })).commits;
  const pulls = (await adapters.github.listPullRequests(scope, { cursor: null, limit: size })).pullRequests;
  const links: IssueLink[] = issueLinksOf(commits, pulls, KAFKA_REPOSITORY)
    .filter((link) => link.issueKey.startsWith('KAFKA-'))
    .map(({ repository, kind, id, issueKey }) => ({ repository, kind, id, issueKey }));
  const issues = await adapters.jira.issuesByKey(scope, [...new Set(links.map((link) => link.issueKey))]);
  return {
    commits,
    pulls,
    links,
    issues,
    resolved: links.filter((link) => issueForLink(issues, link) !== null),
    back: issues.map((issue) => ({ key: issue.key, code: linksForIssue(links, issue.key) })),
  };
}

export { readAllCommits };
