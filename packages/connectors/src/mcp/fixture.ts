import {
  McpAdapterError,
  type McpSession,
  type McpSessionFactory,
  type McpSessionRequest,
  type McpToolInfo,
  type McpToolResult,
} from './types';

/** A synthetic MCP server: the tools it lists and how it answers each call. */
export interface FixtureMcpServer {
  readonly tools: readonly McpToolInfo[];
  call(name: string, args: Readonly<Record<string, unknown>>): McpToolResult;
}

/** The host fixture connections cite; it is never resolved. */
export const FIXTURE_MCP_SITE = 'fixture.mcp.pactlab.invalid';

/**
 * Fixture sessions (T-084c): the same `McpSession` contract as the live client, answered
 * from synthetic servers in memory. They reach nothing, and they refuse unlisted tools
 * exactly as live sessions do, so downstream code never branches on mode.
 */
export class FixtureMcpSessionFactory implements McpSessionFactory {
  constructor(private readonly servers: Readonly<Record<string, FixtureMcpServer>>) {}

  async open(request: McpSessionRequest): Promise<McpSession> {
    const server = this.servers[request.server.profile];
    if (!server) throw new McpAdapterError('UNREACHABLE');
    return {
      listTools: async () => server.tools,
      callTool: async (name, args) => {
        if (!request.tools.includes(name)) throw new McpAdapterError('TOOL_NOT_ALLOWED');
        return server.call(name, args);
      },
      close: async () => undefined,
    };
  }
}
