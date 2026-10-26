import { newId } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { issueForLink, issueKeysIn, linksForIssue, type IssueLink } from './cross-links';
import { createGitHubEvidenceSource, GitHubFixtureAdapter, sanitizeMessage } from './github';
import { FIXTURE_NAMES } from './github/fixture-data';
import { JIRA_FIXTURES } from './jira';

const scope = () => ({ organizationId: newId(), dealId: newId(), connectionId: newId(), credentialRef: null });

describe('issue keys and message hygiene (T-082)', () => {
  it('finds Jira keys, once each, and ignores standards that look like keys', () => {
    expect(issueKeysIn('KAFKA-21353: fix build; see KAFKA-1 and KAFKA-21353 (UTF-8, SHA-256, RFC-7231)')).toEqual(['KAFKA-21353', 'KAFKA-1']);
    expect(issueKeysIn('no keys, kafka-12, KAFKA-0, K-1')).toEqual([]);
    expect(issueKeysIn(null)).toEqual([]);
  });

  it('drops people trailers and email addresses from messages, and caps their length', () => {
    const message = 'HC-3: fix (synthetic)\n\nContact dev@example.com\nSigned-off-by: Some One <some.one@example.com>\nCo-authored-by: X <x@example.com>';
    expect(sanitizeMessage(message)).toBe('HC-3: fix (synthetic)\n\nContact [email removed]');
    expect(sanitizeMessage('a'.repeat(5_000))?.length).toBe(2_000);
    expect(sanitizeMessage('Signed-off-by: only <a@b.co>')).toBeNull();
  });
});

describe('cross-links from the synthetic fixtures', () => {
  async function pull(repository: string) {
    return createGitHubEvidenceSource(new GitHubFixtureAdapter({ repository }), scope()).pull();
  }
  const links = (records: Awaited<ReturnType<typeof pull>>['records']): IssueLink[] =>
    records
      .filter((record) => record.evidenceType === 'code.issue_link')
      .map((record) => ({ repository: record.canonical['repository'] ?? '', kind: record.canonical['kind'] as IssueLink['kind'], id: record.canonical['id'] ?? '', issueKey: record.canonical['issueKey'] ?? '' }));

  it('HealthyCo: every commit and pull request links to an issue that exists, in both directions', async () => {
    const { records, issues } = await pull('healthyco/platform');
    const healthy = JIRA_FIXTURES['healthyco.atlassian.net']?.issues ?? [];
    const all = links(records);
    expect(all.some((link) => link.kind === 'COMMIT')).toBe(true);
    expect(all.some((link) => link.kind === 'PULL_REQUEST')).toBe(true);
    expect(all.every((link) => issueForLink(healthy, link) !== null)).toBe(true);
    // From an issue back to the code that names it.
    const back = linksForIssue(all, 'HC-3');
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((link) => link.issueKey === 'HC-3')).toBe(true);
    const pulls = records.filter((record) => record.evidenceType === 'code.pull_request');
    expect(pulls.length).toBeGreaterThan(0);
    expect(pulls.every((record) => Number(record.canonical['approvals']) >= 1 && record.canonical['checksFailed'] === '0')).toBe(true);
    expect(issues).toEqual([]);
  });

  it('TroubledCo: unreviewed merges, failing checks, and links to issues that do not exist', async () => {
    const { records } = await pull('troubledco/core');
    const troubled = JIRA_FIXTURES['troubledco.atlassian.net']?.issues ?? [];
    const unmatched = links(records).filter((link) => issueForLink(troubled, link) === null);
    expect(unmatched.length).toBeGreaterThan(0);
    expect(unmatched.every((link) => Number(link.issueKey.split('-')[1]) >= 900)).toBe(true);
    const pulls = records.filter((record) => record.evidenceType === 'code.pull_request');
    expect(pulls.some((record) => record.canonical['state'] === 'MERGED' && record.canonical['approvals'] === '0')).toBe(true);
    expect(pulls.some((record) => Number(record.canonical['checksFailed']) > 0)).toBe(true);
    // People appear only as pseudonymous keys.
    const text = JSON.stringify(pulls);
    expect(text).not.toMatch(/tc-dev-|tc-lead-|tc-contractor/);
    for (const name of Object.values(FIXTURE_NAMES)) expect(text).not.toContain(name);
  });
});
