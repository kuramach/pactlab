import type { EvidenceSource } from '@pactlab/domain';
import {
  isAnonymous,
  type ConnectionMode,
  type ConnectionScope,
  type ValidationCheck,
  type ValidationResult,
} from '../contract';
import type { SecretStore } from '../credentials';
import { UnavailableSecretStore } from '../credentials';
import { mcpServerFor, mcpServerProblem, NO_MCP_SERVERS, type McpServerPolicy } from './allowlist';
import { FIXTURE_MCP_SITE, FixtureMcpSessionFactory, type FixtureMcpServer } from './fixture';
import { declaredOnly, type McpEvidenceProfile, type McpTarget } from './profile';
import {
  MCP_PROVIDER,
  McpAdapterError,
  type AllowedMcpServer,
  type McpConnectionConfig,
  type McpSession,
  type McpSessionFactory,
} from './types';

export interface McpAdapterOptions {
  /** The operator's approved servers (LIVE only; a fixture reaches nothing). */
  readonly policy?: McpServerPolicy;
  /** Live sessions (the SDK client over the pinned fetch). */
  readonly sessions?: McpSessionFactory;
  readonly secrets?: SecretStore;
  /** Synthetic servers for FIXTURE mode, by profile id. */
  readonly fixtures?: Readonly<Record<string, FixtureMcpServer>>;
}

const DETAILS: Record<McpAdapterError['reason'], string> = {
  NOT_ALLOWED: 'The request left the approved endpoint and was refused',
  UNREACHABLE: 'The server did not answer (redirects are never followed)',
  UNAUTHORIZED: 'The server refused the credential',
  PROTOCOL: 'The server did not answer as an MCP server',
  TOOL_NOT_ALLOWED: 'A tool outside the profile was refused',
  TOO_LARGE: 'The server answered with more than Pactlab reads',
};
const detailOf = (error: unknown) =>
  error instanceof McpAdapterError ? DETAILS[error.reason] : 'The server could not be read';

const skipped = (names: ValidationCheck['name'][], detail: string): ValidationCheck[] =>
  names.map((name) => ({ name, status: 'SKIPPED', detail }));

/**
 * An external MCP server as a read-only evidence source (T-084c). The connection names an
 * operator-approved server by id and a target; the profile names the tools Pactlab may
 * call and turns their output into normalized evidence, which the sync engine ingests
 * like any other provider's. Mode decides only where sessions come from.
 */
export class McpEvidenceAdapter {
  readonly provider = MCP_PROVIDER;

  constructor(
    readonly mode: ConnectionMode,
    readonly config: McpConnectionConfig,
    private readonly profile: McpEvidenceProfile,
    private readonly target: McpTarget,
    private readonly options: McpAdapterOptions,
  ) {}

  get version(): string {
    return this.profile.version;
  }

  private server(): AllowedMcpServer | null {
    if (this.mode === 'FIXTURE')
      return {
        id: this.profile.id,
        profile: this.profile.id,
        url: `https://${FIXTURE_MCP_SITE}/${this.profile.id}`,
        host: FIXTURE_MCP_SITE,
      };
    return mcpServerFor(this.config.server, this.options.policy ?? NO_MCP_SERVERS);
  }

  private sessions(): McpSessionFactory {
    if (this.mode === 'FIXTURE') return new FixtureMcpSessionFactory(this.options.fixtures ?? {});
    if (!this.options.sessions) throw new McpAdapterError('UNREACHABLE');
    return this.options.sessions;
  }

  private async headers(scope: ConnectionScope): Promise<Record<string, string>> {
    const headers = { ...this.profile.headers };
    if (this.mode === 'FIXTURE' || isAnonymous(scope.credentialRef) || !scope.credentialRef)
      return headers;
    const token = (
      await (this.options.secrets ?? new UnavailableSecretStore()).get(scope.credentialRef)
    ).trim();
    if (!/^\S{8,500}$/.test(token)) throw new Error('The stored credential is not a token');
    return { ...headers, Authorization: `Bearer ${token}` };
  }

  private async open(scope: ConnectionScope, server: AllowedMcpServer): Promise<McpSession> {
    return this.sessions().open({
      server,
      headers: await this.headers(scope),
      tools: this.profile.tools,
    });
  }

  async validateConnection(scope: ConnectionScope): Promise<ValidationResult> {
    const server = this.server();
    if (!server) {
      const problem = mcpServerProblem(this.config.server, this.options.policy ?? NO_MCP_SERVERS);
      return {
        ok: false,
        checks: [
          { name: 'reachability', status: 'FAIL', detail: problem ?? 'Not approved' },
          ...skipped(['credentials', 'scopes', 'mappings'], 'The server is not approved'),
        ],
      };
    }
    try {
      await this.headers(scope);
    } catch {
      return {
        ok: false,
        checks: [
          {
            name: 'credentials',
            status: 'FAIL',
            detail: 'The stored credential could not be read',
          },
          ...skipped(['reachability', 'scopes', 'mappings'], 'Needs a working credential'),
        ],
      };
    }
    let session: McpSession;
    let tools;
    try {
      session = await this.open(scope, server);
    } catch (error) {
      const unauthorized = error instanceof McpAdapterError && error.reason === 'UNAUTHORIZED';
      return {
        ok: false,
        checks: unauthorized
          ? [
              { name: 'reachability', status: 'PASS', detail: `${server.host} answers` },
              { name: 'credentials', status: 'FAIL', detail: detailOf(error) },
              ...skipped(['scopes', 'mappings'], 'Needs a working credential'),
            ]
          : [
              {
                name: 'reachability',
                status: 'FAIL',
                detail: `${server.host}: ${detailOf(error)}`,
              },
              ...skipped(['credentials', 'scopes', 'mappings'], 'Needs a reachable server'),
            ],
      };
    }
    try {
      tools = await session.listTools();
    } catch (error) {
      await session.close().catch(() => undefined); // the listing error is what is reported
      return {
        ok: false,
        checks: [
          { name: 'reachability', status: 'FAIL', detail: `${server.host}: ${detailOf(error)}` },
          ...skipped(['credentials', 'scopes', 'mappings'], 'Needs a reachable server'),
        ],
      };
    }
    await session.close().catch(() => undefined); // nothing more is asked of this session
    const checks: ValidationCheck[] = [
      { name: 'reachability', status: 'PASS', detail: `${server.host} answers as an MCP server` },
      this.mode === 'FIXTURE'
        ? { name: 'credentials', status: 'SKIPPED', detail: 'Fixture mode uses no credentials' }
        : isAnonymous(scope.credentialRef)
          ? { name: 'credentials', status: 'SKIPPED', detail: 'No credential: anonymous read' }
          : { name: 'credentials', status: 'PASS', detail: 'Credential accepted' },
    ];
    const listed = new Map(tools.map((tool) => [tool.name, tool]));
    const missing = this.profile.tools.filter((name) => !listed.has(name));
    const writable = this.profile.tools.filter((name) => listed.get(name)?.readOnlyHint === false);
    checks.push(
      missing.length > 0
        ? {
            name: 'scopes',
            status: 'FAIL',
            detail: `Not offered to this credential: ${missing.join(', ')}. It needs ${this.profile.requiredGrant}`,
          }
        : writable.length > 0
          ? {
              name: 'scopes',
              status: 'FAIL',
              detail: `The server says ${writable.join(', ')} can write; Pactlab only calls read tools`,
            }
          : {
              name: 'scopes',
              status: 'PASS',
              detail: `Read tools offered: ${this.profile.tools.join(', ')}`,
            },
    );
    checks.push({
      name: 'mappings',
      status: 'PASS',
      detail: `Maps to ${this.profile.evidenceTypes.join(', ')} (valuation direction registered)`,
    });
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  /** The normalized records the sync engine ingests. A server off the allowlist fails the run. */
  evidenceSource(scope: ConnectionScope): EvidenceSource {
    return {
      provider: MCP_PROVIDER,
      version: this.profile.version,
      pull: async () => {
        const server = this.server();
        if (!server) throw new McpAdapterError('NOT_ALLOWED');
        const session = await this.open(scope, server);
        try {
          return declaredOnly(
            this.profile,
            await this.profile.pull(session, this.target, { site: server.host }),
          );
        } finally {
          await session.close().catch(() => undefined); // the pull's own result or error stands
        }
      },
    };
  }
}
