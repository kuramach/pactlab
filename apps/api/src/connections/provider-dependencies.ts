import { AppAuth, UnavailableSecretStore, type FetchLike, type SecretStore } from '@pactlab/connectors';

/** Live-provider plumbing shared by every connection: secrets, Pactlab's GitHub App and the HTTP client. */
export interface ProviderDependencies {
  readonly secrets: SecretStore;
  /** Null when no GitHub App is configured for this deployment. */
  readonly githubApp: { readonly slug: string; readonly auth: AppAuth } | null;
  readonly fetch: FetchLike;
  /** Whether GitHub and Jira may be connected to synthetic test data (fixture mode). */
  readonly allowFixtureConnections: boolean;
}

export const PROVIDER_DEPENDENCIES = Symbol('PROVIDER_DEPENDENCIES');

export interface ProviderSettings {
  readonly secrets?: SecretStore;
  readonly githubApp?: { readonly appId: string; readonly slug: string; readonly privateKeyPem: string } | null;
  readonly fetch?: FetchLike;
  /** `main.ts` always sets this from APP_ENV / ALLOW_FIXTURE_CONNECTIONS; tests default to allowed. */
  readonly allowFixtureConnections?: boolean;
}

/** Fail-closed defaults: no secret store, no GitHub App, the platform fetch. */
export function providerDependencies(settings: ProviderSettings = {}): ProviderDependencies {
  const http = settings.fetch ?? ((input, init) => fetch(input, init));
  return {
    secrets: settings.secrets ?? new UnavailableSecretStore(),
    githubApp: settings.githubApp
      ? {
          slug: settings.githubApp.slug,
          auth: new AppAuth({ appId: settings.githubApp.appId, privateKeyPem: settings.githubApp.privateKeyPem }, http),
        }
      : null,
    fetch: http,
    allowFixtureConnections: settings.allowFixtureConnections ?? true,
  };
}
