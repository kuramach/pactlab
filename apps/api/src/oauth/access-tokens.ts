import { createHmac } from 'node:crypto';
import type { OAuthScope } from '@pactlab/db';
import { isUuid } from '@pactlab/domain';
import { jwtVerify, SignJWT } from 'jose';

/** The claims of an MCP access token (T-084, ADR 0024). */
export interface McpAccessClaims {
  readonly subject: string;
  readonly organizationId: string;
  readonly grantId: string;
  readonly clientId: string;
  readonly scopes: readonly OAuthScope[];
}

export const ACCESS_TOKEN_SECONDS = 60 * 60;
const SCOPES: ReadonlySet<string> = new Set(['mcp:read', 'mcp:confidential']);

/**
 * Access tokens for the MCP server: HS256 JWTs whose audience is the MCP server's canonical
 * URI (RFC 8707). The key is derived from AUTH_TOKEN_SECRET for this purpose alone, so a
 * session token is never accepted at /v1/mcp and an MCP token is never accepted anywhere else.
 */
export class McpAccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    readonly issuer: string,
    readonly resource: string,
  ) {
    if (secret.length < 32) throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters');
    this.key = new Uint8Array(createHmac('sha256', secret).update('pactlab:mcp-access-token:v1').digest());
  }

  issue(claims: McpAccessClaims): Promise<string> {
    return new SignJWT({ org_id: claims.organizationId, gid: claims.grantId, client_id: claims.clientId, scope: claims.scopes.join(' ') })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setIssuer(this.issuer)
      .setAudience(this.resource)
      .setSubject(claims.subject)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
      .sign(this.key);
  }

  /** The claims, or null for anything not issued by us for this resource and still valid. */
  async verify(token: string): Promise<McpAccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer, audience: this.resource, algorithms: ['HS256'], typ: 'at+jwt', clockTolerance: 5 });
      const organizationId = payload['org_id'];
      const grantId = payload['gid'];
      const clientId = payload['client_id'];
      const scope = payload['scope'];
      if (typeof payload.sub !== 'string' || !payload.sub) return null;
      if (typeof organizationId !== 'string' || !isUuid(organizationId) || typeof grantId !== 'string' || !isUuid(grantId)) return null;
      if (typeof clientId !== 'string' || typeof scope !== 'string') return null;
      const scopes = scope.split(' ').filter((entry) => SCOPES.has(entry)) as OAuthScope[];
      if (scopes.length === 0) return null;
      return { subject: payload.sub, organizationId, grantId, clientId, scopes };
    } catch {
      return null;
    }
  }
}
