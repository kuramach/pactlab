import { z } from 'zod';

export const MCP_PROVIDER = 'mcp';

/** A profile and server id: lowercase, short, never a URL. */
export const MCP_SERVER_ID = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * Non-secret connection settings, identical in FIXTURE and LIVE mode: which operator-approved
 * server (by id, never a URL) and what to read there. The profile checks the target's shape.
 */
export const mcpConnectionConfigSchema = z.strictObject({
  server: z.string().regex(MCP_SERVER_ID),
  target: z
    .record(z.string().regex(/^[a-z][A-Za-z]{0,30}$/), z.string().min(1).max(200))
    .refine((target) => Object.keys(target).length <= 5, 'At most five target fields'),
});
export type McpConnectionConfig = z.infer<typeof mcpConnectionConfigSchema>;

/** A server the operator approved: its id names the profile that reads it. */
export interface AllowedMcpServer {
  readonly id: string;
  readonly profile: string;
  /** The exact endpoint, https only. Pactlab never requests anything else on that origin. */
  readonly url: string;
  readonly host: string;
}

export interface McpToolInfo {
  readonly name: string;
  /** The server's own hint; untrusted, but a tool it calls writable is never called. */
  readonly readOnlyHint: boolean | null;
}

export interface McpToolResult {
  readonly isError: boolean;
  /** Text content only. Server output is untrusted data: parsed, never followed. */
  readonly text: readonly string[];
}

/** One conversation with one server. Only the tools it was opened for can be called. */
export interface McpSession {
  listTools(): Promise<readonly McpToolInfo[]>;
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface McpSessionRequest {
  readonly server: AllowedMcpServer;
  /** Sent on every request (the profile's headers and the credential). Never logged. */
  readonly headers: Readonly<Record<string, string>>;
  /** The only tools this session may call. */
  readonly tools: readonly string[];
}

export interface McpSessionFactory {
  open(request: McpSessionRequest): Promise<McpSession>;
}

/** Reasons are stable codes with fixed wording; server text never reaches a person or a log. */
export class McpAdapterError extends Error {
  constructor(
    readonly reason:
      | 'NOT_ALLOWED'
      | 'UNREACHABLE'
      | 'UNAUTHORIZED'
      | 'PROTOCOL'
      | 'TOOL_NOT_ALLOWED'
      | 'TOO_LARGE',
  ) {
    super(reason);
    this.name = 'McpAdapterError';
  }
}
