import { ANONYMOUS_CREDENTIAL_REF, AnonymousAuth, GITHUB_APP_CREDENTIAL_REF, TokenAuth } from '@pactlab/connectors';
import type { ConnectionRecord } from '@pactlab/db';
import { CsvFixtureAdapter } from './adapters/csv-fixture.adapter';
import { githubSyncAdapter, jiraSyncAdapter, type ProviderSyncAdapter } from './adapters/provider-sync.adapter';
import type { ProviderDependencies } from './provider-dependencies';

export type ResolvedAdapter = CsvFixtureAdapter | ProviderSyncAdapter;

/** Providers a connection may be created for. */
export const SUPPORTED_PROVIDERS = ['csv', 'github', 'jira'] as const;

function datasetsOf(config: unknown): string[] {
  const datasets = (config as { datasets?: unknown } | null)?.datasets;
  return Array.isArray(datasets)
    ? datasets.filter((value): value is string => typeof value === 'string')
    : [];
}

/**
 * The only place that looks at (provider, mode). Everything downstream sees
 * the normalized adapter contract. Live CSV (uploaded files) is not built
 * yet; live GitHub and Jira read the providers (T-082).
 */
export function resolveAdapter(
  connection: Pick<ConnectionRecord, 'provider' | 'mode' | 'config'>,
  providers: ProviderDependencies,
): ResolvedAdapter | null {
  switch (connection.provider) {
    case 'csv':
      return connection.mode === 'FIXTURE' ? new CsvFixtureAdapter(datasetsOf(connection.config)) : null;
    case 'github':
      return githubSyncAdapter(connection.mode, connection.config, {
        // Pactlab's App for App-installed repositories, the seller's stored token, or none (public repositories).
        resolveAuth: (scope) =>
          scope.credentialRef === GITHUB_APP_CREDENTIAL_REF
            ? (providers.githubApp?.auth ?? null)
            : scope.credentialRef === ANONYMOUS_CREDENTIAL_REF
              ? new AnonymousAuth()
              : scope.credentialRef
                ? new TokenAuth(providers.secrets)
                : null,
        fetch: providers.fetch,
      });
    case 'jira':
      return jiraSyncAdapter(connection.mode, connection.config, { fetch: providers.fetch, secrets: providers.secrets, policy: providers.jiraSitePolicy });
    default:
      return null;
  }
}
