import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike } from '../http/cassette';
import { guardedMcpFetch, MCP_REQUEST_TIMEOUT_MS } from './guarded-fetch';
import {
  McpAdapterError,
  type McpSession,
  type McpSessionFactory,
  type McpSessionRequest,
  type McpToolInfo,
  type McpToolResult,
} from './types';

const CLIENT_INFO = { name: 'pactlab-evidence', version: '1.0.0' } as const;
const MAX_TOOL_PAGES = 10;

/** SDK and transport errors become fixed reasons; a server's own message is never kept. */
function toAdapterError(error: unknown): McpAdapterError {
  if (error instanceof McpAdapterError) return error;
  if (error instanceof UnauthorizedError) return new McpAdapterError('UNAUTHORIZED');
  if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403))
    return new McpAdapterError('UNAUTHORIZED');
  if (error instanceof StreamableHTTPError) return new McpAdapterError('UNREACHABLE');
  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'TypeError')
  )
    return new McpAdapterError('UNREACHABLE');
  return new McpAdapterError('PROTOCOL');
}

class SdkMcpSession implements McpSession {
  constructor(
    private readonly client: Client,
    private readonly tools: readonly string[],
  ) {}

  async listTools(): Promise<readonly McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
        const result = await this.client.listTools(cursor ? { cursor } : undefined, {
          timeout: MCP_REQUEST_TIMEOUT_MS,
        });
        for (const tool of result.tools)
          tools.push({ name: tool.name, readOnlyHint: tool.annotations?.readOnlyHint ?? null });
        cursor = result.nextCursor;
        if (!cursor) break;
      }
    } catch (error) {
      throw toAdapterError(error);
    }
    return tools;
  }

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult> {
    // Read-only by construction: Pactlab calls only the tools its profile names.
    if (!this.tools.includes(name)) throw new McpAdapterError('TOOL_NOT_ALLOWED');
    let result: Awaited<ReturnType<Client['callTool']>>;
    try {
      result = await this.client.callTool({ name, arguments: { ...args } }, undefined, {
        timeout: MCP_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw toAdapterError(error);
    }
    const content = Array.isArray(result.content)
      ? (result.content as readonly { type?: unknown; text?: unknown }[])
      : [];
    return {
      isError: result.isError === true,
      text: content
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string),
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Live sessions over MCP Streamable HTTP with the official SDK client (T-084c). The protocol
 * is the SDK's; where requests may go, and how much may come back, is `guardedMcpFetch`'s.
 * `fetch` is the deployment's pinned fetch (every resolved address checked).
 */
export class SdkMcpSessionFactory implements McpSessionFactory {
  constructor(private readonly fetch: FetchLike) {}

  async open(request: McpSessionRequest): Promise<McpSession> {
    const transport = new StreamableHTTPClientTransport(new URL(request.server.url), {
      fetch: guardedMcpFetch(request.server, this.fetch, request.headers),
      requestInit: { redirect: 'manual' },
      // No standing stream is ever opened, so there is nothing to reconnect.
      reconnectionOptions: {
        maxReconnectionDelay: 0,
        initialReconnectionDelay: 0,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
    });
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: MCP_REQUEST_TIMEOUT_MS });
    } catch (error) {
      await transport.close().catch(() => undefined); // the connect error is what the caller reports
      throw toAdapterError(error);
    }
    return new SdkMcpSession(client, request.tools);
  }
}
