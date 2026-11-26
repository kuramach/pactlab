import { JIRA_HOST } from '../jira/types';
import { MCP_SERVER_ID, type AllowedMcpServer } from './types';

/**
 * Which MCP servers a deployment may read evidence from (T-084c). Set by the operator in
 * platform configuration (`MCP_EVIDENCE_SERVERS`), never a URL a deal user types: a
 * connection names a server by id, and only an id on this list can be reached.
 */
export interface McpServerPolicy {
  readonly servers: readonly AllowedMcpServer[];
}

export const NO_MCP_SERVERS: McpServerPolicy = { servers: [] };

/**
 * Null when the URL may be an approved endpoint: https, a DNS host name (never an IP
 * literal or `localhost`), the default port, no user info, query or fragment. The live
 * fetch additionally checks every resolved address and connects only to a checked one.
 */
export function mcpServerUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not a URL';
  }
  if (url.protocol !== 'https:') return 'must be https';
  if (url.username || url.password || url.search || url.hash)
    return 'must not carry user info, a query or a fragment';
  if (url.port !== '') return 'must use the default https port';
  if (!JIRA_HOST.test(url.hostname)) return 'must name a DNS host, not an address';
  if (url.pathname.split('/').some((part) => part === '.' || part === '..'))
    return 'must not walk the path';
  return null;
}

/**
 * Parse the operator's list: comma-separated `<profile>=<https url>`, e.g.
 * `github=https://api.githubcopilot.com/mcp/x/dependabot/readonly`. Throws on anything
 * else, so a bad setting stops startup instead of opening a hole.
 */
export function parseMcpEvidenceServers(
  raw: string | undefined,
  knownProfiles: readonly string[],
): McpServerPolicy {
  const servers: AllowedMcpServer[] = [];
  for (const entry of (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf('=');
    const id = entry.slice(0, separator).trim();
    const url = entry.slice(separator + 1).trim();
    if (separator < 1 || !MCP_SERVER_ID.test(id))
      throw new Error(`MCP_EVIDENCE_SERVERS: "${entry}" is not <profile>=<https url>`);
    if (!knownProfiles.includes(id))
      throw new Error(`MCP_EVIDENCE_SERVERS: "${id}" is not a registered MCP evidence profile`);
    const problem = mcpServerUrlProblem(url);
    if (problem) throw new Error(`MCP_EVIDENCE_SERVERS: the ${id} URL ${problem}`);
    if (servers.some((server) => server.id === id))
      throw new Error(`MCP_EVIDENCE_SERVERS: "${id}" is listed twice`);
    const parsed = new URL(url);
    servers.push({ id, profile: id, url: parsed.href, host: parsed.hostname });
  }
  return { servers };
}

/** The approved server with this id, or null. */
export function mcpServerFor(id: string, policy: McpServerPolicy): AllowedMcpServer | null {
  return policy.servers.find((server) => server.id === id) ?? null;
}

/** Null when the server may be reached; otherwise the reason, safe to show the deal lead. */
export function mcpServerProblem(id: string, policy: McpServerPolicy): string | null {
  return mcpServerFor(id, policy)
    ? null
    : `${id} is not on this deployment's approved MCP servers; ask your Pactlab operator to add it`;
}
