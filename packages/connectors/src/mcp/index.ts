import type { ConnectionMode } from '../contract';
import { McpEvidenceAdapter, type McpAdapterOptions } from './adapter';
import { GITHUB_MCP_FIXTURE } from './github/fixture';
import { GITHUB_MCP_PROFILE } from './github/profile';
import type { McpEvidenceProfile } from './profile';
import { mcpConnectionConfigSchema } from './types';

export * from './adapter';
export * from './allowlist';
export * from './evidence-types';
export * from './fixture';
export * from './guarded-fetch';
export * from './profile';
export * from './session';
export * from './types';
export { GITHUB_MCP_FIXTURE, GITHUB_MCP_FIXTURE_REPOSITORIES } from './github/fixture';
export {
  GITHUB_MCP_PROFILE,
  GITHUB_MCP_PROFILE_ID,
  GITHUB_MCP_SOURCE_SYSTEM,
  githubMcpTargetSchema,
} from './github/profile';

/**
 * Every MCP evidence profile Pactlab ships. Adding a server is adding a profile here
 * (`docs/runbooks/mcp-evidence-servers.md`), then the operator listing it.
 */
export const MCP_EVIDENCE_PROFILES: Readonly<Record<string, McpEvidenceProfile>> = {
  [GITHUB_MCP_PROFILE.id]: GITHUB_MCP_PROFILE as unknown as McpEvidenceProfile,
};

/** Synthetic servers for fixture connections, by profile id. */
export const MCP_FIXTURE_SERVERS = { [GITHUB_MCP_PROFILE.id]: GITHUB_MCP_FIXTURE } as const;

/** The only place that looks at mode. Null when the config, profile or target is not valid. */
export function createMcpAdapter(
  mode: ConnectionMode,
  config: unknown,
  options: McpAdapterOptions = {},
): McpEvidenceAdapter | null {
  const parsed = mcpConnectionConfigSchema.safeParse(config);
  if (!parsed.success) return null;
  const profile = MCP_EVIDENCE_PROFILES[parsed.data.server];
  if (!profile) return null;
  const target = profile.targetSchema.safeParse(parsed.data.target);
  if (!target.success) return null;
  return new McpEvidenceAdapter(mode, parsed.data, profile, target.data, {
    fixtures: MCP_FIXTURE_SERVERS,
    ...options,
  });
}
