import { Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/auth.guard';
import { McpService } from './mcp.service';

/**
 * `POST /v1/mcp` (T-084): Streamable HTTP, stateless, JSON responses. Not behind the app's
 * session guard: the MCP access token is checked here (audience-bound, RFC 8707). A 401
 * points the client at the protected-resource metadata (RFC 9728), as MCP requires.
 */
@Controller('v1/mcp')
export class McpController {
  constructor(@Inject(McpService) private readonly service: McpService) {}

  private metadataUrl(): string {
    const url = new URL(this.service.resource);
    return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
  }

  @Public()
  @Post()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const auth = await this.service.authenticate(request.headers.authorization);
    if (auth.kind === 'unauthorized') {
      await reply
        .status(401)
        .header('www-authenticate', `Bearer resource_metadata="${this.metadataUrl()}", scope="mcp:read"`)
        .send({ error: 'invalid_token', error_description: 'Sign in to Pactlab from your MCP client.' });
      return;
    }
    if (auth.kind === 'forbidden') {
      const description = auth.error === 'mcp_disabled' ? 'MCP is switched off for this organization.' : 'The mcp:read scope is required.';
      await reply
        .status(403)
        .header('www-authenticate', `Bearer error="insufficient_scope", scope="mcp:read", resource_metadata="${this.metadataUrl()}", error_description="${description}"`)
        .send({ error: auth.error, error_description: description });
      return;
    }
    const server = this.service.build(auth.caller, String(request.id));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  }

  /** Stateless: no server-initiated stream and no sessions to end. */
  @Public()
  @Get()
  @HttpCode(405)
  get(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('allow', 'POST');
    return { error: 'method_not_allowed' };
  }

  @Public()
  @Delete()
  @HttpCode(405)
  remove(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('allow', 'POST');
    return { error: 'method_not_allowed' };
  }
}
