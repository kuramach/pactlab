import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import {
  boundedLimit,
  type ConnectionScope,
  type DryRunResult,
  type ValidationCheck,
  type ValidationResult,
} from '../contract';
import { GITHUB_FIXTURES, type GitHubFixtureRepository } from './fixture-data';
import {
  GITHUB_PROVIDER,
  GITHUB_REQUIRED_PERMISSIONS,
  GitHubAdapterError,
  type CommitPage,
  type GitHubAdapter,
  type GitHubConnectionConfig,
  type RepositoryHead,
} from './types';

export const GITHUB_FIXTURE_VERSION = 'github-fixture-1';
const MAX_PAGE = 100;

/** Synthetic repositories behind the same normalized interface as live GitHub. */
export class GitHubFixtureAdapter implements GitHubAdapter {
  readonly provider = GITHUB_PROVIDER;
  readonly mode = 'FIXTURE' as const;
  readonly version = GITHUB_FIXTURE_VERSION;

  constructor(private readonly config: GitHubConnectionConfig) {}

  private fixture(): GitHubFixtureRepository | undefined {
    return Object.hasOwn(GITHUB_FIXTURES, this.config.repository)
      ? GITHUB_FIXTURES[this.config.repository]
      : undefined;
  }

  private readable(): GitHubFixtureRepository {
    const fixture = this.fixture();
    if (!fixture) throw new GitHubAdapterError('UNKNOWN_REPOSITORY', 'Repository not found');
    if (!GITHUB_REQUIRED_PERMISSIONS.every((p) => fixture.grantedPermissions.includes(p)))
      throw new GitHubAdapterError('PERMISSION_DENIED', 'Installation lacks contents:read');
    return fixture;
  }

  async validateConnection(_scope: ConnectionScope): Promise<ValidationResult> {
    const fixture = this.fixture();
    const missing = GITHUB_REQUIRED_PERMISSIONS.filter(
      (permission) => !fixture?.grantedPermissions.includes(permission),
    );
    const checks: ValidationCheck[] = [
      {
        name: 'reachability',
        status: fixture ? 'PASS' : 'FAIL',
        detail: fixture ? 'Fixture repository available' : 'Repository is not an available fixture',
      },
      { name: 'credentials', status: 'SKIPPED', detail: 'Fixture mode uses no credentials' },
      {
        name: 'scopes',
        status: fixture && missing.length === 0 ? 'PASS' : 'FAIL',
        detail:
          missing.length === 0
            ? 'Read-only metadata and contents permissions granted'
            : `Missing permissions: ${missing.join(', ')}`,
      },
      {
        name: 'mappings',
        status: fixture && fixture.identityMap.length > 0 ? 'PASS' : 'FAIL',
        detail: fixture?.identityMap.length
          ? `${fixture.identityMap.length} identities in the identity map`
          : 'No contributor identity map supplied',
      },
    ];
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  async dryRun(
    scope: ConnectionScope,
    options: { limit: number },
  ): Promise<DryRunResult<CommitMetadata>> {
    const page = await this.listCommits(scope, {
      cursor: null,
      limit: boundedLimit(options.limit),
    });
    return { sample: page.commits, truncated: page.nextCursor !== null };
  }

  async head(_scope: ConnectionScope): Promise<RepositoryHead> {
    const fixture = this.readable();
    const newest = fixture.commits[0];
    if (!newest) throw new GitHubAdapterError('UNKNOWN_REPOSITORY', 'Repository has no commits');
    return {
      repository: fixture.repository,
      defaultBranch: fixture.defaultBranch,
      headSha: newest.sha,
    };
  }

  async listCommits(
    _scope: ConnectionScope,
    options: { cursor: string | null; limit: number },
  ): Promise<CommitPage> {
    const fixture = this.readable();
    const limit = Math.min(Math.max(1, Math.trunc(options.limit)), MAX_PAGE);
    const offset = options.cursor === null ? 0 : Number(options.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > fixture.commits.length)
      throw new GitHubAdapterError('INVALID_CURSOR', 'Invalid page cursor');
    const end = offset + limit;
    return {
      commits: fixture.commits.slice(offset, end),
      nextCursor: end < fixture.commits.length ? String(end) : null,
    };
  }

  async identityMap(_scope: ConnectionScope): Promise<readonly ContributorIdentity[]> {
    return this.readable().identityMap;
  }
}
