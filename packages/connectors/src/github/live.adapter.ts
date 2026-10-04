import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import type { ConnectionScope, DryRunResult, ValidationResult } from '../contract';
import {
  GITHUB_PROVIDER,
  GitHubAdapterError,
  type CommitPage,
  type GitHubAdapter,
  type GitHubConnectionConfig,
  type RepositoryHead,
} from './types';

export const GITHUB_LIVE_VERSION = 'github-live-0';

const NOT_ENABLED = 'Live GitHub reads are not enabled in this release';

/**
 * Configuration-only live adapter. It accepts the same config and credential
 * reference as the fixture adapter so switching mode needs no code or schema
 * change, but performs no provider calls until the live client is built and
 * verified against GitHub's documented API.
 */
export class GitHubLiveAdapter implements GitHubAdapter {
  readonly provider = GITHUB_PROVIDER;
  readonly mode = 'LIVE' as const;
  readonly version = GITHUB_LIVE_VERSION;

  constructor(readonly config: GitHubConnectionConfig) {}

  async validateConnection(scope: ConnectionScope): Promise<ValidationResult> {
    const hasCredential = scope.credentialRef !== null;
    return {
      ok: false,
      checks: [
        { name: 'reachability', status: 'FAIL', detail: NOT_ENABLED },
        {
          name: 'credentials',
          status: hasCredential ? 'SKIPPED' : 'FAIL',
          detail: hasCredential
            ? 'Credential reference present; not resolved while live reads are disabled'
            : 'A credential reference is required for live mode',
        },
        { name: 'scopes', status: 'SKIPPED', detail: NOT_ENABLED },
        { name: 'mappings', status: 'SKIPPED', detail: NOT_ENABLED },
      ],
    };
  }

  async dryRun(): Promise<DryRunResult<CommitMetadata>> {
    return { sample: [], truncated: false };
  }

  async head(): Promise<RepositoryHead> {
    throw new GitHubAdapterError('NOT_ENABLED', NOT_ENABLED);
  }

  async listCommits(): Promise<CommitPage> {
    throw new GitHubAdapterError('NOT_ENABLED', NOT_ENABLED);
  }

  async identityMap(): Promise<readonly ContributorIdentity[]> {
    throw new GitHubAdapterError('NOT_ENABLED', NOT_ENABLED);
  }
}
