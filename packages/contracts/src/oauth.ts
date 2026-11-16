import type { Page } from './pagination';

/** OAuth for the MCP server (T-084) and the REST API (T-128), ADR 0024: what the consent pages and Settings show. */

export type McpScope = 'mcp:read' | 'mcp:confidential' | 'mcp:propose';
export type ApiScope = 'api:read' | 'api:write';
export type OAuthScopeName = McpScope | ApiScope;

/** The consent page's answer for one authorization request. */
export type AuthorizeCheckView =
  | {
      kind: 'consent';
      /** What the app is asking to reach: the MCP server or the REST API. */
      resource: 'mcp' | 'api';
      client: { name: string; host: string; /** Identified by its own https metadata document. */ verified: boolean };
      scopes: { scope: OAuthScopeName; description: string }[];
      redirectHost: string;
    }
  /** The request is wrong in a way the client should hear about: send the browser back. */
  | { kind: 'redirect'; redirectTo: string }
  /** The session has several organizations and none is chosen yet. */
  | { kind: 'choose-organization' }
  /** Shown on the page; never redirected (unknown client or redirect URI, MCP off). */
  | { kind: 'error'; message: string };

/** An MCP client the person has connected to one organization. */
export interface ConnectedAppView {
  id: string;
  organizationName: string;
  clientName: string;
  /** The host of its metadata document, when it identified by one. */
  clientHost: string | null;
  scopes: OAuthScopeName[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** The device approval page (RFC 8628, T-128): what a script's code asks for. */
export type DeviceCheckView =
  | {
      kind: 'consent';
      userCode: string;
      client: { name: string; /** Identified by its own https metadata document; otherwise a name the script gave itself. */ verified: boolean };
      scopes: { scope: OAuthScopeName; description: string }[];
      expiresAt: string;
    }
  | { kind: 'choose-organization' }
  | { kind: 'error'; message: string };

/** One member's API grant, as an organization admin sees it (T-128). */
export interface ApiGrantView {
  id: string;
  personName: string;
  personEmail: string | null;
  clientName: string;
  clientHost: string | null;
  scopes: OAuthScopeName[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** Settings → API access, for organization owners and admins (T-128). */
export interface ApiAccessView {
  enabled: boolean;
  grants: Page<ApiGrantView>;
}
