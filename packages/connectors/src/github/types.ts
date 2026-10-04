import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import { z } from 'zod';
import type { ConnectionScope, ProviderAdapter } from '../contract';

export const GITHUB_PROVIDER = 'github';

/** Non-secret connection settings. Identical in FIXTURE and LIVE mode. */
export const githubConnectionConfigSchema = z.strictObject({
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
});
export type GitHubConnectionConfig = z.infer<typeof githubConnectionConfigSchema>;

/**
 * Repository permissions a read-only GitHub App installation needs:
 * metadata (always granted) and contents to list commits.
 */
export const GITHUB_REQUIRED_PERMISSIONS = ['metadata:read', 'contents:read'] as const;

export interface RepositoryHead {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly headSha: string;
}

export interface CommitPage {
  readonly commits: readonly CommitMetadata[];
  readonly nextCursor: string | null;
}

/**
 * Normalized read-only repository interface. Commit metadata only — the
 * adapter never returns file contents, diffs or archives.
 */
export interface GitHubAdapter extends ProviderAdapter<CommitMetadata> {
  readonly version: string;
  head(scope: ConnectionScope): Promise<RepositoryHead>;
  listCommits(
    scope: ConnectionScope,
    options: { cursor: string | null; limit: number },
  ): Promise<CommitPage>;
  /** Target-supplied identity map used for ghost-commit attribution. */
  identityMap(scope: ConnectionScope): Promise<readonly ContributorIdentity[]>;
}

export class GitHubAdapterError extends Error {
  constructor(
    readonly code: 'NOT_ENABLED' | 'UNKNOWN_REPOSITORY' | 'PERMISSION_DENIED' | 'INVALID_CURSOR',
    message: string,
  ) {
    super(message);
    this.name = 'GitHubAdapterError';
  }
}
