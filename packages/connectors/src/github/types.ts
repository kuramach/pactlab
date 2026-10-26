import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import { z } from 'zod';
import type { ConnectionScope, ProviderAdapter } from '../contract';

export const GITHUB_PROVIDER = 'github';

/** Non-secret connection settings. Identical in FIXTURE and LIVE mode. */
export const githubConnectionConfigSchema = z.strictObject({
  // `owner/name`: GitHub owners are letters, digits and hyphens; a name may hold
  // dots but is never `.` or `..`, so a repository can never become a URL path walk.
  repository: z
    .string()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/)
    .refine((value) => !['.', '..'].includes(value.split('/')[1] ?? ''), 'Not a repository name'),
});
export type GitHubConnectionConfig = z.infer<typeof githubConnectionConfigSchema>;

/**
 * Repository permissions a read-only GitHub App installation needs:
 * metadata (always granted), contents to list commits, pull requests and
 * checks for review and CI evidence (T-082).
 */
export const GITHUB_REQUIRED_PERMISSIONS = ['metadata:read', 'contents:read', 'pull_requests:read', 'checks:read'] as const;
/** Without these the commit history cannot be read at all; the others only narrow the evidence. */
export const GITHUB_CORE_PERMISSIONS = ['metadata:read', 'contents:read'] as const;

export interface RepositoryHead {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly headSha: string;
}

export interface CommitPage {
  readonly commits: readonly CommitMetadata[];
  readonly nextCursor: string | null;
}

/** A pull request at metadata level: no diff, no body, no comments. */
export interface PullRequestMetadata {
  readonly number: number;
  readonly state: 'OPEN' | 'CLOSED' | 'MERGED';
  readonly draft: boolean;
  /** Sanitized (see `sanitizeMessage`); carries issue keys. */
  readonly title: string | null;
  readonly authorIdentity: string;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly mergedAt: string | null;
  readonly headSha: string;
  readonly baseBranch: string;
}

export interface PullRequestPage {
  readonly pullRequests: readonly PullRequestMetadata[];
  readonly nextCursor: string | null;
}

/** Submitted reviews on one pull request, counted by outcome; reviewers by identity only. */
export interface ReviewSummary {
  readonly number: number;
  readonly approvals: number;
  readonly changesRequested: number;
  readonly commented: number;
  readonly reviewerIdentities: readonly string[];
}

/** Check runs on one commit, counted by outcome. */
export interface CheckSummary {
  readonly sha: string;
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly pending: number;
  /** Neutral, skipped or cancelled: ran, but neither passed nor failed. */
  readonly other: number;
}

/**
 * Normalized read-only repository interface. Commit, pull-request, review
 * and check metadata — the adapter never returns file contents, diffs or
 * archives.
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
  /** Pull requests, newest first. */
  listPullRequests(scope: ConnectionScope, options: { cursor: string | null; limit: number }): Promise<PullRequestPage>;
  pullRequestReviews(scope: ConnectionScope, number: number): Promise<ReviewSummary>;
  checkRuns(scope: ConnectionScope, sha: string): Promise<CheckSummary>;
}

export class GitHubAdapterError extends Error {
  constructor(
    readonly code:
      | 'NOT_ENABLED'
      | 'UNKNOWN_REPOSITORY'
      | 'PERMISSION_DENIED'
      | 'INVALID_CURSOR'
      | 'NO_CREDENTIAL'
      | 'NOT_INSTALLED'
      | 'RATE_LIMITED'
      | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'GitHubAdapterError';
  }
}
