import type { DocuSignOAuth, FixtureSigningProvider, SecretStore, SigningProvider, SigningWebhook } from '@pactlab/connectors';

export const CLOSE_DEPENDENCIES = Symbol('CLOSE_DEPENDENCIES');

/** E-signature for this deployment (T-107, ADR 0022; the provider seam, T-136, ADR 0036). */
export interface CloseDependencies {
  /** Outside production only: the fixture signing provider. */
  readonly fixtureSigning: FixtureSigningProvider | null;
  /** Pactlab's DocuSign app registration; customers connect their own accounts to it. */
  readonly docusign: { readonly oauth: DocuSignOAuth; readonly connectHmacKey: string; readonly redirectUri: string } | null;
  /** Where each organization's DocuSign tokens live. */
  readonly secrets: SecretStore | null;
  /** Signs the OAuth `state`, binding the callback to the admin who started it. */
  readonly stateSecret: string;
  /** Pactlab's own BoldSign account (T-136): the adapter, and its webhook once a public endpoint is registered. */
  readonly boldsign: { readonly provider: SigningProvider; readonly webhook: SigningWebhook | null } | null;
  /** What "Pactlab signing" sends with here: BoldSign, the fixture (outside production), or nothing. */
  readonly pactlabSigning: 'BOLDSIGN' | 'FIXTURE' | null;
  /** Until the production go: the only addresses (or `@domain`s) envelopes may go to. Null: anyone. */
  readonly testRecipients: readonly string[] | null;
  /** The web origin embedded signing sessions return to. */
  readonly appOrigin: string;
  /** The polling fallback asks the provider about an open envelope at most this often. */
  readonly pollIntervalMs: number;
}
