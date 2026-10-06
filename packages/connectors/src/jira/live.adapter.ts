import type { ConnectionScope, DryRunResult, ValidationResult } from '../contract';
import {
  JIRA_PROVIDER,
  JiraAdapterError,
  type JiraAdapter,
  type JiraConnectionConfig,
  type JiraIssue,
  type JiraIssuePage,
  type JiraSprint,
} from './types';

export const JIRA_LIVE_VERSION = 'jira-live-0';

const NOT_ENABLED = 'Live Jira reads are not enabled in this release';

/**
 * Configuration-only live adapter. Accepts the same config and credential
 * reference as the fixture adapter so switching mode needs no code or schema
 * change, but performs no provider calls until the live client is built and
 * verified against Atlassian's documented REST API.
 */
export class JiraLiveAdapter implements JiraAdapter {
  readonly provider = JIRA_PROVIDER;
  readonly mode = 'LIVE' as const;
  readonly version = JIRA_LIVE_VERSION;

  constructor(readonly config: JiraConnectionConfig) {}

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

  async dryRun(): Promise<DryRunResult<JiraIssue>> {
    return { sample: [], truncated: false };
  }

  async listIssues(): Promise<JiraIssuePage> {
    throw new JiraAdapterError('NOT_ENABLED', NOT_ENABLED);
  }

  async listSprints(): Promise<readonly JiraSprint[]> {
    throw new JiraAdapterError('NOT_ENABLED', NOT_ENABLED);
  }
}
