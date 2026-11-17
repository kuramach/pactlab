import { describe, expect, it } from 'vitest';
import { sourceUrl } from './engineering-activity';

describe('links out of the Engineering drill-down (T-129)', () => {
  it('links real systems only: live connections and the recorded apache/kafka pair', () => {
    const kafka = { id: 'g', provider: 'github', mode: 'FIXTURE', config: { repository: 'apache/kafka' } };
    const apache = { id: 'j', provider: 'jira', mode: 'FIXTURE', config: { site: 'issues.apache.org', basePath: '/jira', projectKeys: ['KAFKA'] } };
    expect(sourceUrl(kafka, { pull: '21012' })).toBe('https://github.com/apache/kafka/pull/21012');
    expect(sourceUrl(kafka, { commit: 'abc123' })).toBe('https://github.com/apache/kafka/commit/abc123');
    expect(sourceUrl(apache, { issueKey: 'KAFKA-19001' })).toBe('https://issues.apache.org/jira/browse/KAFKA-19001');
    expect(sourceUrl({ id: 'l', provider: 'jira', mode: 'LIVE', config: { site: 'acme.atlassian.net' } }, { issueKey: 'AC-1' })).toBe('https://acme.atlassian.net/browse/AC-1');
    // Synthetic fixtures name hosts that do not exist.
    expect(sourceUrl({ id: 's', provider: 'github', mode: 'FIXTURE', config: { repository: 'healthyco/platform' } }, { pull: '1' })).toBeNull();
    expect(sourceUrl(undefined, { issueKey: 'X-1' })).toBeNull();
  });
});
