import { Inject, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appendAuditEvent, oauth, resolvePrincipal, withTenant, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { z } from 'zod';
import { DealsService } from '../deals/deals.service';
import { EvidenceService } from '../evidence/evidence.service';
import { FindingsService } from '../findings/findings.service';
import { ForesightService } from '../foresight/foresight.service';
import type { McpAccessClaims } from '../oauth/access-tokens';
import { OAUTH, type OAuthDependencies } from '../oauth/oauth.service';
import { PhasesService } from '../phases/phases.service';
import { LOGGER, PRISMA } from '../tokens';
import { ValuationService } from '../valuation/valuation.service';

/** Who is calling, once their token checks out. */
export interface McpCaller {
  readonly tenant: TenantContext;
  readonly claims: McpAccessClaims;
}

export type McpAuthResult = { kind: 'ok'; caller: McpCaller } | { kind: 'unauthorized' } | { kind: 'forbidden'; error: 'insufficient_scope' | 'mcp_disabled' };

const dealId = z.uuid().describe('The pact (deal) id, from list_deals.');
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] });

/**
 * The Pactlab MCP server (T-084 Part 1, ADR 0024): read-only tools over the same
 * application services the REST API uses, with no business logic of its own. The caller's
 * tenant is built from their MCP token exactly as the API builds it from a session, so every
 * permission and confidentiality rule applies unchanged. On top of that, without the
 * `mcp:confidential` scope the confirmed-value ledger and value-confirmation findings are
 * left out of every result. Every tool call is audited; arguments and results never are logged.
 */
@Injectable()
export class McpService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(OAUTH) private readonly oauthDeps: OAuthDependencies,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(PhasesService) private readonly phases: PhasesService,
    @Inject(ValuationService) private readonly valuation: ValuationService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(ForesightService) private readonly foresight: ForesightService,
  ) {}

  get resource(): string {
    return this.oauthDeps.accessTokens.resource;
  }

  /** Token → caller: audience-bound, grant still active, MCP still on, `mcp:read` held. */
  async authenticate(authorization: string | undefined): Promise<McpAuthResult> {
    const token = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(authorization ?? '')?.[1];
    if (!token) return { kind: 'unauthorized' };
    const claims = await this.oauthDeps.accessTokens.verify(token);
    if (!claims) return { kind: 'unauthorized' };
    const state = await oauth.grantState(this.prisma, claims.grantId, claims.subject);
    if (!state.active) return { kind: 'unauthorized' };
    if (!state.mcpEnabled) return { kind: 'forbidden', error: 'mcp_disabled' };
    if (!claims.scopes.includes('mcp:read')) return { kind: 'forbidden', error: 'insufficient_scope' };
    const tenant = await resolvePrincipal(this.prisma, { subject: claims.subject, externalOrganizationId: claims.organizationId, issuer: 'PACTLAB' });
    if (!tenant) return { kind: 'unauthorized' };
    return { kind: 'ok', caller: { tenant, claims } };
  }

  private async audit(caller: McpCaller, tool: string, deal: string | null, requestId: string): Promise<void> {
    await withTenant(this.prisma, caller.tenant, (tx) =>
      appendAuditEvent(tx, {
        organizationId: caller.tenant.organizationId,
        dealId: deal,
        actorUserId: caller.tenant.userId,
        action: 'mcp.tool_called',
        targetType: 'mcp_tool',
        targetId: `${tool} · ${caller.claims.clientId}`.slice(0, 200),
        outcome: 'SUCCEEDED',
        requestId,
      }),
    );
  }

  /** One server per request (stateless Streamable HTTP), bound to this caller. */
  build(caller: McpCaller, requestId: string): McpServer {
    const server = new McpServer({ name: 'pactlab', version: '1.0.0' }, { instructions: 'Pactlab deal diligence. Read-only: findings, claims, valuation, Foresight and evidence for the pacts you can see. Figures are projections under stated assumptions; cite the evidence returned.' });
    const { tenant } = caller;
    const confidential = caller.claims.scopes.includes('mcp:confidential');
    const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
    // Each tool: audit, then the service. A service refusal (403/404) becomes a tool error.
    const tool = <A extends z.ZodRawShape>(name: string, description: string, shape: A, run: (args: z.infer<z.ZodObject<A>>) => Promise<unknown>, dealOf?: (args: z.infer<z.ZodObject<A>>) => string) => {
      server.registerTool(name, { description, inputSchema: shape, annotations: readOnly }, (async (args: z.infer<z.ZodObject<A>>) => {
        try {
          const result = await run(args);
          await this.audit(caller, name, dealOf ? dealOf(args) : null, requestId);
          return text(result);
        } catch (error) {
          const status = (error as { getStatus?: () => number }).getStatus?.();
          this.logger.warn({ tool: name, status: status ?? 'error', requestId }, 'mcp tool refused');
          return { isError: true, content: [{ type: 'text' as const, text: status === 404 || status === 403 ? 'Not found, or not available to you.' : 'That could not be read right now.' }] };
        }
      }) as never);
    };
    const withoutCushions = <T extends { direction?: number | null; valueConfirmation?: unknown }>(items: readonly T[]) =>
      confidential ? items : items.filter((item) => !(item.direction === 1 && item.valueConfirmation));

    tool('list_deals', 'The pacts you can see: name, stage, target and dates. Optionally filter by a search term.', { query: z.string().max(100).optional() }, async ({ query }) => ({
      deals: (await this.deals.list(tenant, query)).map((deal) => ({ ...deal })),
    }));

    tool('get_deal_summary', 'One pact: its details and the screening verdict (GO / NO_GO) with reasons, if screened.', { dealId }, async (args) => {
      const deal = await this.deals.get(tenant, args.dealId);
      if (!deal) throw Object.assign(new Error('not found'), { getStatus: () => 404 });
      const screening = await this.phases.screening(tenant, args.dealId, requestId).catch(() => null);
      return { deal, screening };
    }, (args) => args.dealId);

    tool(
      'get_findings',
      'Findings on a pact with their evidence and rationale. direction: -1 risk (lowers value), 0 neutral, +1 confirms value. Filter by status (DRAFT, SUBMITTED, ACCEPTED, …) and domain.',
      { dealId, status: z.string().max(40).optional(), domain: z.string().max(40).optional(), direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(), limit: z.number().int().min(1).max(100).default(50) },
      async (args) => {
        const listed = await this.findings.list(tenant, args.dealId, { ...(args.status ? { status: args.status } : {}), ...(args.domain ? { domain: args.domain } : {}) } as never, requestId);
        const items = withoutCushions(listed.items as { direction?: number | null; valueConfirmation?: unknown }[]).filter((item) => args.direction === undefined || item.direction === args.direction);
        return { total: items.length, items: items.slice(0, args.limit) };
      },
      (args) => args.dealId,
    );

    tool('get_claims_register', 'The claims register: each material claim with VERIFIED / CONTRADICTED / UNVERIFIED and its linked findings.', { dealId }, async (args) => {
      const { items } = await this.phases.claims(tenant, args.dealId, requestId);
      return { items };
    }, (args) => args.dealId);

    tool('get_valuation_bridge', 'The valuation scenarios with their latest deterministic run: base value, adjustments and the purchase-price bridge.', { dealId }, async (args) => {
      const { items } = await this.valuation.list(tenant, args.dealId, requestId);
      return { scenarios: (items as Record<string, unknown>[]).map((item) => (confidential ? item : { ...item, confirmedValue: undefined })) };
    }, (args) => args.dealId);

    tool(
      'run_valuation_scenario',
      'A what-if: rerun one scenario with some assumption or bridge numbers replaced (decimals as strings, e.g. {"multiple": "5.5"}). Uses the same deterministic engine; nothing is saved.',
      { dealId, scenarioId: z.uuid(), assumptions: z.record(z.string().max(60), z.string().max(30)).optional(), bridge: z.record(z.string().max(60), z.string().max(30)).optional() },
      async (args) => this.valuation.preview(tenant, args.dealId, args.scenarioId, { ...(args.assumptions ? { assumptions: args.assumptions } : {}), ...(args.bridge ? { bridge: args.bridge } : {}) }, requestId),
      (args) => args.dealId,
    );

    tool(
      'search_evidence',
      'Normalized evidence on a pact (records from connected systems and imports), with where each came from, to cite. Filter by type.',
      { dealId, type: z.string().max(100).optional(), limit: z.number().int().min(1).max(100).default(50) },
      async (args) => this.evidence.list(tenant, args.dealId, { ...(args.type ? { type: args.type } : {}), limit: args.limit } as never, requestId),
      (args) => args.dealId,
    );

    tool('get_post_close_register', 'After close: the asset-preservation and integration actions, with owners and status.', { dealId }, async (args) => this.phases.postClose(tenant, args.dealId, requestId), (args) => args.dealId);

    tool('get_foresight', 'Foresight: five-year forecasts and trend lines, and the projected value range under them — always with the assumptions behind it.', { dealId }, async (args) => this.foresight.view(tenant, args.dealId, requestId), (args) => args.dealId);

    const prompt = (name: string, title: string, description: string, ask: (dealId: string) => string) =>
      server.registerPrompt(name, { title, description, argsSchema: { dealId: z.string().describe('The pact id (from list_deals).') } }, ({ dealId: id }) => ({
        messages: [{ role: 'user', content: { type: 'text', text: ask(id) } }],
      }));
    prompt('screen_this_deal', 'Screen this deal', 'A GO / NO_GO read from the screening, findings and claims.', (id) =>
      `Using Pactlab's tools for pact ${id} (get_deal_summary, get_findings, get_claims_register), give a GO or NO_GO read: the deciding risks, open claims, and what evidence would change the call. Cite the findings and evidence you rely on.`);
    prompt('prep_me_for_ic', 'Prep me for IC', 'Findings, the valuation bridge and open claims, in order of materiality.', (id) =>
      `Prepare an investment-committee brief for pact ${id}: accepted findings by materiality (get_findings), the valuation bridge (get_valuation_bridge), open or contradicted claims (get_claims_register), and the Foresight range with its assumptions (get_foresight). Name every source; no figure that Pactlab did not return.`);
    prompt('what_will_the_investor_find', 'What will the investor find?', 'Venture Raise self-diligence: the risks an investor will discover, in the order they would.', (id) =>
      `For Venture Raise pact ${id}, list the risks (direction -1, get_findings) an investor's diligence will surface, in the order they would find them, each with its evidence and how to address it before the round.`);

    return server;
  }
}
