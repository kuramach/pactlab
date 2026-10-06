import type { EvidenceSource, NormalizedEvidence } from '@pactlab/domain';
import type { ConnectionScope } from '../contract';
import { GITHUB_PROVIDER, type GitHubAdapter } from './types';

export const REPOSITORY_HEAD_EVIDENCE_TYPE = 'code.repository_head';

/**
 * Evidence for the analysed state of a repository: one record per head
 * commit. Code findings cite it with the exact commit, so a finding resolves
 * to repository, commit and the tool that produced it. Metadata only — no
 * file contents are read or stored.
 */
export function createGitHubEvidenceSource(
  adapter: GitHubAdapter,
  scope: ConnectionScope,
): EvidenceSource {
  return {
    provider: GITHUB_PROVIDER,
    version: adapter.version,
    async pull() {
      const head = await adapter.head(scope);
      const commit = (await adapter.listCommits(scope, { cursor: null, limit: 1 })).commits[0];
      const record: NormalizedEvidence = {
        evidenceType: REPOSITORY_HEAD_EVIDENCE_TYPE,
        sourceSystem: GITHUB_PROVIDER,
        sourceRecordId: `${head.repository}@${head.headSha}`,
        observedAt: commit?.sha === head.headSha ? commit.committedAt : null,
        canonical: {
          repository: head.repository,
          defaultBranch: head.defaultBranch,
          headSha: head.headSha,
        },
        locator: { kind: 'git_commit', repository: head.repository, commitSha: head.headSha },
        quote: `${head.repository}@${head.headSha}`,
      };
      return { records: [record], issues: [] };
    },
  };
}
