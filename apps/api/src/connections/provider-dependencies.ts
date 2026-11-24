import { randomBytes } from 'node:crypto';
import {
  AppAuth,
  CLOUD_ONLY,
  FIXTURE_ROOMS,
  GoogleDriveOAuth,
  MicrosoftDriveOAuth,
  UnavailableSecretStore,
  type DocumentOAuthClient,
  type DocumentOAuthProvider,
  type FetchLike,
  type FixtureRoom,
  type JiraSitePolicy,
  type SecretStore,
} from '@pactlab/connectors';

/** Live-provider plumbing shared by every connection: secrets, Pactlab's GitHub App and the HTTP client. */
export interface ProviderDependencies {
  readonly secrets: SecretStore;
  /** Null when no GitHub App is configured for this deployment. */
  readonly githubApp: { readonly slug: string; readonly auth: AppAuth } | null;
  readonly fetch: FetchLike;
  /** Whether GitHub and Jira may be connected to synthetic test data (fixture mode). */
  readonly allowFixtureConnections: boolean;
  /** Which Jira hosts live connections may reach (Cloud always; self-hosted by operator list). */
  readonly jiraSitePolicy: JiraSitePolicy;
  /** Synthetic data rooms for fixture document sources (T-098). */
  readonly fixtureRooms: Readonly<Record<string, FixtureRoom>>;
  /** Pactlab's OAuth clients for document sources (T-147), per provider configured here. */
  readonly documentOAuth: Partial<Readonly<Record<DocumentOAuthProvider, DocumentOAuthClient>>>;
  /** Where providers send a person back after signing in: `<web origin>/settings/document-sources/<provider>/callback`. */
  readonly webOrigin: string | null;
  /** Signs OAuth `state` (the API's token secret), so every API task accepts a sign-in another started. */
  readonly stateSecret: string;
  /** Google's file picker (runs in the browser): its API key and the Cloud project number (`appId`). Null: not set up. */
  readonly googlePicker: { readonly apiKey: string; readonly appId: string } | null;
}

export const PROVIDER_DEPENDENCIES = Symbol('PROVIDER_DEPENDENCIES');

export interface ProviderSettings {
  readonly secrets?: SecretStore;
  readonly githubApp?: { readonly appId: string; readonly slug: string; readonly privateKeyPem: string } | null;
  readonly fetch?: FetchLike;
  /** `main.ts` always sets this from APP_ENV / ALLOW_FIXTURE_CONNECTIONS; tests default to allowed. */
  readonly allowFixtureConnections?: boolean;
  /** From JIRA_SELF_HOSTED_HOSTS; defaults to Atlassian Cloud only. */
  readonly jiraSitePolicy?: JiraSitePolicy;
  /** Tests replace the synthetic rooms to simulate changes at the source. */
  readonly fixtureRooms?: Readonly<Record<string, FixtureRoom>>;
  /** From GOOGLE_OAUTH_* and MICROSOFT_OAUTH_*: each provider's client id and secret. */
  readonly documentOAuth?: Partial<Readonly<Record<DocumentOAuthProvider, { readonly clientId: string; readonly clientSecret: string }>>>;
  readonly webOrigin?: string;
  readonly stateSecret?: string;
  /** From GOOGLE_PICKER_API_KEY and GOOGLE_PROJECT_NUMBER. */
  readonly googlePicker?: { readonly apiKey: string; readonly appId: string } | null;
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
    jiraSitePolicy: settings.jiraSitePolicy ?? CLOUD_ONLY,
    fixtureRooms: settings.fixtureRooms ?? FIXTURE_ROOMS,
    documentOAuth: {
      ...(settings.documentOAuth?.['google-drive'] ? { 'google-drive': new GoogleDriveOAuth({ ...settings.documentOAuth['google-drive'], fetch: http }) } : {}),
      ...(settings.documentOAuth?.onedrive ? { onedrive: new MicrosoftDriveOAuth({ ...settings.documentOAuth.onedrive, fetch: http }) } : {}),
    },
    webOrigin: settings.webOrigin ?? null,
    // Unset (tests): a per-process key, so a state is still never forgeable.
    stateSecret: settings.stateSecret ?? randomBytes(32).toString('base64url'),
    googlePicker: settings.googlePicker ?? null,
  };
}
