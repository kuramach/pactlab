import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  connectionTokens,
  destroySecret,
  DOCUMENT_OAUTH_PROVIDERS,
  DOCUMENT_SOURCE_LABELS,
  DocumentOAuthError,
  DocumentSourceError,
  type DocumentOAuthProvider,
} from '@pactlab/connectors';
import { appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { newId, type TenantContext } from '@pactlab/domain';
import { PROVIDER_DEPENDENCIES, type ProviderDependencies } from '../connections/provider-dependencies';
import { PRISMA } from '../tokens';

/** The API each provider's sources read from (organization_connections.base_uri). */
const API_BASE: Readonly<Record<DocumentOAuthProvider, string>> = { 'google-drive': 'https://www.googleapis.com', onedrive: 'https://graph.microsoft.com' };

/** How long a sign-in may take between Connect and the provider sending the person back. */
const STATE_TTL_MS = 10 * 60_000;

export interface DocumentConnectionView {
  provider: DocumentOAuthProvider;
  label: string;
  /** Pactlab's OAuth client for this provider is configured here (else Connect is hidden). */
  available: boolean;
  connected: { accountName: string; connectedAt: string } | null;
}

/**
 * An organization's own Google Drive and OneDrive / SharePoint sign-ins (T-147): an owner or admin
 * connects once; every pact's document sources read with it, refreshed by Pactlab, read-only. The
 * refresh token lives only in the credential store; nothing about a token is ever returned.
 */
@Injectable()
export class DocumentConnectionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PROVIDER_DEPENDENCIES) private readonly providers: ProviderDependencies,
  ) {}

  private redirectUri(provider: DocumentOAuthProvider): string {
    if (!this.providers.webOrigin) throw new ServiceUnavailableException({ code: 'SOURCE_NOT_CONFIGURED' });
    return new URL(`/settings/document-sources/${provider}/callback`, this.providers.webOrigin).toString();
  }

  /** The sign-in's state: who started it, for which provider, until when; signed so it cannot be forged or replayed elsewhere. */
  private stateFor(tenant: TenantContext, provider: DocumentOAuthProvider, expires: number): string {
    const payload = `${tenant.organizationId}.${tenant.userId}.${provider}.${expires}`;
    return `${payload}.${createHmac('sha256', this.providers.stateSecret).update(`document-source-state:${payload}`).digest('base64url')}`;
  }

  private requireAdmin(tenant: TenantContext): void {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
  }

  private client(provider: string) {
    if (!(DOCUMENT_OAUTH_PROVIDERS as readonly string[]).includes(provider)) throw new NotFoundException();
    const client = this.providers.documentOAuth[provider as DocumentOAuthProvider];
    if (!client) throw new ServiceUnavailableException({ code: 'SOURCE_NOT_CONFIGURED' });
    return client;
  }

  async list(tenant: TenantContext): Promise<{ items: DocumentConnectionView[]; canEdit: boolean }> {
    // bounded: at most one live connection per provider per organization (two providers)
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.organizationConnection.findMany({ where: { organizationId: tenant.organizationId, provider: { in: [...DOCUMENT_OAUTH_PROVIDERS] }, disconnectedAt: null } }),
    );
    return {
      items: DOCUMENT_OAUTH_PROVIDERS.map((provider) => {
        const row = rows.find((entry) => entry.provider === provider);
        return {
          provider,
          label: DOCUMENT_SOURCE_LABELS[provider],
          available: Boolean(this.providers.documentOAuth[provider] && this.providers.webOrigin),
          connected: row ? { accountName: row.accountName, connectedAt: row.connectedAt.toISOString() } : null,
        };
      }),
      canEdit: tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN',
    };
  }

  /** Providers with a live sign-in here (any member may see which; never the account's tokens). */
  async signedIn(tenant: TenantContext): Promise<DocumentOAuthProvider[]> {
    return (await this.list(tenant)).items.filter((item) => item.connected && item.available).map((item) => item.provider);
  }

  /** Where an owner or admin signs in to the provider to connect the organization's drive. */
  start(tenant: TenantContext, provider: string): { url: string } {
    this.requireAdmin(tenant);
    const client = this.client(provider);
    return { url: client.authorizeUrl(this.redirectUri(client.provider), this.stateFor(tenant, client.provider, Date.now() + STATE_TTL_MS)) };
  }

  async callback(tenant: TenantContext, provider: string, code: string, state: string, requestId: string) {
    this.requireAdmin(tenant);
    const client = this.client(provider);
    const expires = Number(state.split('.').at(-2));
    const expected = Buffer.from(this.stateFor(tenant, client.provider, expires));
    const given = Buffer.from(state);
    if (!Number.isFinite(expires) || expires < Date.now() || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ForbiddenException();
    let tokens;
    let account;
    try {
      tokens = await client.exchangeCode(code, this.redirectUri(client.provider));
      account = await client.account(tokens.accessToken);
    } catch (error) {
      if (error instanceof DocumentOAuthError) throw error.reason === 'REVOKED' ? new UnprocessableEntityException({ code: 'SIGN_IN_REFUSED' }) : new ServiceUnavailableException({ code: 'SOURCE_UNAVAILABLE' });
      throw error;
    }
    const id = newId();
    const credentialRef = `secretref:${tenant.organizationId}/${client.provider}/${id}`;
    try {
      await this.providers.secrets.put(credentialRef, JSON.stringify(tokens));
    } catch {
      throw new ServiceUnavailableException({ code: 'SECRETS_UNAVAILABLE' });
    }
    const replaced = await withTenant(this.prisma, tenant, async (tx) => {
      const previous = await this.retire(tx, tenant, client.provider);
      await tx.organizationConnection.create({
        data: { id, organizationId: tenant.organizationId, provider: client.provider, credentialRef, accountId: account.accountId, accountName: account.accountName, baseUri: API_BASE[client.provider], connectedBy: tenant.userId },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId: null, actorUserId: tenant.userId, action: 'document_source.account_connected', targetType: 'organization_connection', targetId: id, outcome: 'SUCCEEDED', requestId });
      return previous;
    });
    await this.destroy(replaced);
    return this.list(tenant);
  }

  /** Disconnect: the sign-in is destroyed; the organization's sources stop reading until it connects again. */
  async disconnect(tenant: TenantContext, provider: string, requestId: string) {
    this.requireAdmin(tenant);
    if (!(DOCUMENT_OAUTH_PROVIDERS as readonly string[]).includes(provider)) throw new NotFoundException();
    const retired = await withTenant(this.prisma, tenant, async (tx) => {
      const previous = await this.retire(tx, tenant, provider as DocumentOAuthProvider);
      if (previous.length > 0) {
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId: null, actorUserId: tenant.userId, action: 'document_source.account_disconnected', targetType: 'organization', targetId: tenant.organizationId, outcome: 'SUCCEEDED', requestId });
      }
      return previous;
    });
    await this.destroy(retired);
    return this.list(tenant);
  }

  private async retire(tx: TransactionClient, tenant: TenantContext, provider: DocumentOAuthProvider) {
    // bounded: at most one live connection per provider per organization
    const previous = await tx.organizationConnection.findMany({ where: { organizationId: tenant.organizationId, provider, disconnectedAt: null }, select: { id: true, credentialRef: true } });
    if (previous.length > 0) await tx.organizationConnection.updateMany({ where: { id: { in: previous.map((entry) => entry.id) } }, data: { disconnectedAt: new Date() } });
    return previous;
  }

  private async destroy(retired: readonly { credentialRef: string }[]): Promise<void> {
    for (const { credentialRef } of retired) {
      // handled: the connection is already retired in the database, so the credential can never be used again;
      // a store outage here only delays its deletion, said nowhere a token could leak
      await destroySecret(this.providers.secrets, credentialRef).catch(() => undefined);
    }
  }

  /**
   * A source's access token through its organization's current sign-in for the provider (a reconnect
   * carries every source over), refreshed as needed. No live sign-in, a revoked one, or a provider not
   * configured here reads nothing: the sync reports SOURCE_ACCESS (Reconnect needed).
   */
  async tokensFor(tx: TransactionClient, organizationId: string, provider: string): Promise<() => Promise<string>> {
    const connection = await tx.organizationConnection.findFirst({ where: { organizationId, provider, disconnectedAt: null } });
    const client = connection ? this.providers.documentOAuth[connection.provider as DocumentOAuthProvider] : undefined;
    if (!connection || !client) {
      return async () => {
        throw new DocumentSourceError('ACCESS');
      };
    }
    return connectionTokens(client, this.providers.secrets, connection.credentialRef);
  }
}
