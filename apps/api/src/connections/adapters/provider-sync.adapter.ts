import {
  boundedLimit,
  createGitHubAdapter,
  createGitHubEvidenceSource,
  createJiraAdapter,
  createJiraEvidenceSource,
  JiraFixtureAdapter,
  type ConnectionMode,
  type ConnectionScope,
  type DryRunResult,
  type ValidationResult,
} from '@pactlab/connectors';
import type { EvidenceSource } from '@pactlab/domain';
import { toSample, type EvidenceSample } from './evidence-sample';

interface ProviderEvidence {
  readonly provider: string;
  readonly mode: ConnectionMode;
  readonly version: string;
  validateConnection(scope: ConnectionScope): Promise<ValidationResult>;
}

/**
 * Wraps a provider adapter (GitHub, Jira) as a sync adapter: the same
 * normalized evidence the sync engine ingests, and dry-run samples taken
 * from it. Live adapters return empty samples until live reads are enabled.
 */
export class ProviderSyncAdapter {
  constructor(
    private readonly adapter: ProviderEvidence,
    private readonly source: (scope: ConnectionScope) => EvidenceSource,
  ) {}

  get provider() {
    return this.adapter.provider;
  }

  get mode() {
    return this.adapter.mode;
  }

  get version() {
    return this.adapter.version;
  }

  validateConnection(scope: ConnectionScope): Promise<ValidationResult> {
    return this.adapter.validateConnection(scope);
  }

  async dryRun(scope: ConnectionScope, options: { limit: number }): Promise<DryRunResult<EvidenceSample>> {
    const limit = boundedLimit(options.limit);
    if (this.adapter.mode === 'LIVE') return { sample: [], truncated: false };
    const { records } = await this.source(scope).pull();
    return { sample: records.slice(0, limit).map(toSample), truncated: records.length > limit };
  }

  async evidenceSource(scope: ConnectionScope): Promise<EvidenceSource> {
    return this.source(scope);
  }
}

export function githubSyncAdapter(mode: ConnectionMode, config: unknown): ProviderSyncAdapter | null {
  const adapter = createGitHubAdapter(mode, config);
  return adapter ? new ProviderSyncAdapter(adapter, (scope) => createGitHubEvidenceSource(adapter, scope)) : null;
}

export function jiraSyncAdapter(mode: ConnectionMode, config: unknown): ProviderSyncAdapter | null {
  const adapter = createJiraAdapter(mode, config);
  if (!adapter) return null;
  const unreadable = adapter instanceof JiraFixtureAdapter ? adapter.unreadableProjects() : [];
  return new ProviderSyncAdapter(adapter, (scope) => createJiraEvidenceSource(adapter, scope, unreadable));
}
