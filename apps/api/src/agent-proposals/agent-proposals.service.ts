import { HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { adjustmentAmount } from '@pactlab/calculations';
import { appendAuditEvent, oauth, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { DealAccess } from '../deals/deal-access';
import { DocumentsService } from '../documents/documents.service';
import { FindingsService } from '../findings/findings.service';
import { PricingService } from '../pricing/pricing.service';
import { LOGGER, PRISMA } from '../tokens';
import {
  documentRequestPayloadSchema,
  termProposalPayloadSchema,
  type AgentProposalInput,
  type AgentProposalKind,
  type AgentProposalStatus,
  type DecideProposalBody,
  type DocumentRequestPayload,
  type TermProposalPayload,
} from './agent-proposals.schemas';

/** Proposing, reading and deciding are buyer-side deal work: write access and buyer analysis. */
const canPropose = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');

/** Who filed it: the connected app and the person whose token it was. */
export interface ProposalOrigin {
  readonly clientId: string;
  readonly clientName: string;
}

export interface AgentProposalView {
  readonly id: string;
  readonly kind: AgentProposalKind;
  readonly status: AgentProposalStatus;
  readonly rationale: string;
  readonly clientName: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  /** A friendly reason approval could not be carried out (FAILED). */
  readonly problem: string | null;
  /** What approval does, for the approver: the term with the engine's amount, or the categories asked for. */
  readonly detail: TermDetail | DocumentRequestDetail | null;
}

interface TermDetail {
  readonly kind: 'TERM';
  readonly findingId: string;
  readonly findingTitle: string;
  readonly lever: TermProposalPayload['lever'];
  /** The finding's priced risk at its midpoint: what approval adds. Null once it is no longer a priced risk. */
  readonly amount: { readonly amount: string; readonly currency: string } | null;
}

interface DocumentRequestDetail {
  readonly kind: 'DOCUMENT_REQUEST';
  readonly items: readonly { readonly id: string; readonly label: string }[];
  readonly note: string | null;
}

/** Problem codes from the services approval calls, as the approver reads them. */
const PROBLEMS: Record<string, string> = {
  NO_DRAFT_TERMS: 'There are no draft terms to add this to. Draft terms on the Terms page, then approve it again.',
  NOT_A_PRICED_RISK: 'The finding is no longer an accepted risk with a priced amount, so it cannot become a term.',
  ALREADY_ON_TERMS: 'This finding is already on the draft terms. Its lever is set when terms are drafted; reject this suggestion or draft new terms.',
  CURRENCY_MISMATCH: 'The finding is priced in a different currency from the draft terms.',
  UNKNOWN_CATEGORY: 'One of the categories is not on this pact’s checklist any more.',
};
const UNAVAILABLE = 'That could not be carried out just now. Try approving it again in a moment.';
const NO_ACCESS = 'You can no longer do this on this pact.';

function problemOf(error: unknown): string {
  if (!(error instanceof HttpException)) return UNAVAILABLE;
  const status = error.getStatus();
  if (status === 403 || status === 404) return NO_ACCESS;
  const response = error.getResponse();
  const code = typeof response === 'object' && response !== null && 'code' in response ? String((response as { code: unknown }).code) : null;
  return (code && PROBLEMS[code]) || UNAVAILABLE;
}

/**
 * Suggestions from connected AI apps (T-084b, ADR 0024). A connected app files one through MCP;
 * it stays PENDING until a buyer-side member approves or rejects it here, and approval runs the
 * app's own service (pricing, documents) as that member. No path from MCP decides one.
 */
@Injectable()
export class AgentProposalsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, proposalId: string, requestId: string, outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED') {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType: 'agent_proposal', targetId: proposalId, outcome, requestId });
  }

  /** The pact's checklist inputs that are missing and not already asked for: what a request would name. */
  async openGaps(tenant: TenantContext, dealId: string, requestId: string): Promise<{ id: string; label: string }[]> {
    await this.access.require(tenant, dealId, canPropose, { action: 'agent_proposal.gaps_read', requestId });
    const [intake, requests] = await Promise.all([this.documents.intake(tenant, dealId, requestId), this.documents.listRequests(tenant, dealId, requestId)]);
    const asked = new Set(requests.items.filter((request) => request.status === 'OPEN').flatMap((request) => request.items.filter((item) => !item.received).map((item) => item.id)));
    return intake.checklist.filter((item) => (item.state === 'MISSING' || item.state === 'PARTIAL') && !asked.has(item.id)).map((item) => ({ id: item.id, label: item.label }));
  }

  /**
   * File a suggestion. It is checked now, so the app hears at once why one cannot stand (a
   * finding that is not an accepted priced risk, a category not on the checklist), and again
   * by the target service on approval.
   */
  async file(tenant: TenantContext, dealId: string, input: AgentProposalInput, rationale: string, origin: ProposalOrigin, requestId: string): Promise<{ id: string; status: 'PENDING' }> {
    await this.access.require(tenant, dealId, canPropose, { action: 'agent_proposal.created', requestId });
    if (input.kind === 'TERM') {
      const payload = termProposalPayloadSchema.parse(input.payload);
      // handled: an unreadable finding is refused just below, with the reason
      const finding = (await this.findings.get(tenant, dealId, payload.findingId, requestId).catch(() => null))?.finding;
      if (!finding || finding.status !== 'ACCEPTED' || finding.direction !== -1 || !finding.pricedRisk) {
        throw new UnprocessableEntityException({ code: 'NOT_A_PRICED_RISK', message: 'Only an accepted risk (direction -1) with a priced amount can become a term.' });
      }
    } else {
      const payload = documentRequestPayloadSchema.parse(input.payload);
      const offered = new Set((await this.documents.intake(tenant, dealId, requestId)).checklist.map((item) => item.id as string));
      const unknown = payload.items.filter((item) => !offered.has(item));
      if (unknown.length > 0) throw new UnprocessableEntityException({ code: 'UNKNOWN_CATEGORY', message: `Not on this pact's checklist: ${unknown.join(', ')}` });
    }
    const id = newId();
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.agentProposal.create({
        data: { id, organizationId: tenant.organizationId, dealId, kind: input.kind, payload: input.payload, rationale, clientId: origin.clientId.slice(0, 200), clientName: origin.clientName.slice(0, 200), createdBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'agent_proposal.created', id, requestId);
    });
    return { id, status: 'PENDING' };
  }

  /**
   * The pact's suggestions, newest first, each with what approval would do. `connectable` says
   * whether apps can connect at all (MCP is on for the organization), so the screen can hide
   * the section where none will ever arrive.
   */
  async list(tenant: TenantContext, dealId: string, filter: { status?: AgentProposalStatus | undefined }, requestId: string): Promise<{ items: AgentProposalView[]; connectable: boolean }> {
    await this.access.require(tenant, dealId, canPropose, { action: 'agent_proposal.list', requestId });
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.agentProposal.findMany({ where: { dealId, ...(filter.status ? { status: filter.status } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 }),
    );
    const labels = rows.some((row) => row.kind === 'DOCUMENT_REQUEST')
      ? new Map((await this.documents.intake(tenant, dealId, requestId)).checklist.map((item) => [item.id as string, item.label]))
      : new Map<string, string>();
    const items: AgentProposalView[] = [];
    for (const row of rows) {
      items.push({
        id: row.id,
        kind: row.kind as AgentProposalKind,
        status: row.status as AgentProposalStatus,
        rationale: row.rationale,
        clientName: row.clientName || row.clientId,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decisionNote: row.decisionNote,
        problem: row.problem,
        detail: await this.detail(tenant, dealId, row.kind, row.payload, labels, requestId),
      });
    }
    return { items, connectable: await oauth.mcpEnabled(this.prisma, tenant.organizationId) };
  }

  private async detail(tenant: TenantContext, dealId: string, kind: string, payload: unknown, labels: Map<string, string>, requestId: string): Promise<AgentProposalView['detail']> {
    if (kind === 'TERM') {
      const parsed = termProposalPayloadSchema.safeParse(payload);
      if (!parsed.success) return null;
      // handled: a finding that is gone shows as such, without an amount
      const found = await this.findings.get(tenant, dealId, parsed.data.findingId, requestId).catch(() => null);
      const finding = found?.finding;
      const priced = finding && finding.status === 'ACCEPTED' && finding.direction === -1 ? finding.pricedRisk : null;
      return {
        kind: 'TERM',
        findingId: parsed.data.findingId,
        findingTitle: finding?.title ?? 'A finding you can no longer see',
        lever: parsed.data.lever,
        amount: priced
          ? { amount: adjustmentAmount({ findingId: parsed.data.findingId, findingVersion: 0, type: priced.type, currency: priced.currency, low: priced.low, high: priced.high, point: 'MID', basis: priced.basis }).toFixed(2), currency: priced.currency }
          : null,
      };
    }
    const parsed = documentRequestPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return { kind: 'DOCUMENT_REQUEST', items: parsed.data.items.map((id) => ({ id, label: labels.get(id) ?? id })), note: parsed.data.note ?? null };
  }

  /**
   * Approve or reject, in the app only. Approval runs the target service as the approver; if it
   * refuses, the suggestion becomes FAILED with a friendly reason and can be approved again later.
   */
  async decide(tenant: TenantContext, dealId: string, proposalId: string, body: DecideProposalBody, requestId: string): Promise<AgentProposalView> {
    await this.access.require(tenant, dealId, canPropose, { action: 'agent_proposal.decided', requestId });
    const row = await withTenant(this.prisma, tenant, (tx) => tx.agentProposal.findFirst({ where: { id: proposalId, dealId } }));
    if (!row) throw new NotFoundException();
    if (row.status !== 'PENDING' && row.status !== 'FAILED') throw new UnprocessableEntityException({ code: 'ALREADY_DECIDED' });

    const decided = { decidedBy: tenant.userId, decidedAt: new Date(), decisionNote: body.note ?? null };
    if (body.decision === 'REJECT') {
      await withTenant(this.prisma, tenant, async (tx) => {
        await tx.agentProposal.update({ where: { id: row.id }, data: { ...decided, status: 'REJECTED', problem: null } });
        await this.audit(tx, tenant, dealId, 'agent_proposal.rejected', row.id, requestId);
      });
    } else {
      let outcome: { status: 'APPROVED'; resultRef: string } | { status: 'FAILED'; problem: string };
      try {
        outcome = { status: 'APPROVED', resultRef: await this.carryOut(tenant, dealId, row.kind, row.payload, requestId) };
      } catch (error) {
        // The refusal is stored on the suggestion and shown to the approver.
        this.logger.warn({ requestId, kind: row.kind, status: error instanceof HttpException ? error.getStatus() : 'error' }, 'agent proposal approval failed');
        outcome = { status: 'FAILED', problem: problemOf(error) };
      }
      await withTenant(this.prisma, tenant, async (tx) => {
        await tx.agentProposal.update({
          where: { id: row.id },
          data: outcome.status === 'APPROVED' ? { ...decided, status: 'APPROVED', resultRef: outcome.resultRef, problem: null } : { ...decided, status: 'FAILED', problem: outcome.problem },
        });
        await this.audit(tx, tenant, dealId, outcome.status === 'APPROVED' ? 'agent_proposal.approved' : 'agent_proposal.failed', row.id, requestId, outcome.status === 'APPROVED' ? 'SUCCEEDED' : 'FAILED');
      });
    }
    const { items } = await this.list(tenant, dealId, {}, requestId);
    const view = items.find((item) => item.id === row.id);
    if (!view) throw new NotFoundException();
    return view;
  }

  /** The app's own service for each kind, run as the approver. */
  private async carryOut(tenant: TenantContext, dealId: string, kind: string, payload: unknown, requestId: string): Promise<string> {
    if (kind === 'TERM') {
      const { batchId } = await this.pricing.addFindingTerm(tenant, dealId, termProposalPayloadSchema.parse(payload), requestId);
      return `term_proposal_batch:${batchId}`;
    }
    if (kind === 'DOCUMENT_REQUEST') {
      const body: DocumentRequestPayload = documentRequestPayloadSchema.parse(payload);
      const { id } = await this.documents.createRequest(tenant, dealId, body, requestId);
      return `document_request:${id}`;
    }
    throw new UnprocessableEntityException({ code: 'UNKNOWN_KIND' });
  }
}
