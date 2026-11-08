/** OAuth for the MCP server (T-084, ADR 0024): what the consent page and Settings show. */

export type McpScope = 'mcp:read' | 'mcp:confidential';

/** The consent page's answer for one authorization request. */
export type AuthorizeCheckView =
  | {
      kind: 'consent';
      client: { name: string; host: string; /** Identified by its own https metadata document. */ verified: boolean };
      scopes: { scope: McpScope; description: string }[];
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
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
}
