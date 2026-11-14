import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  acceptedBriefSections,
  GatewayPolicyError,
  negotiationBriefPrompt,
  type AiRunRecord,
  type ClaudeGateway,
} from '@pactlab/ai';
import {
  BUYER_PERSONAS,
  D,
  isBuyerPersona,
  PERSONA_PROFILE,
  personaRun,
  resolvePersona,
  termMix,
  ValuationInputError,
  weightedPrice,
  type BuyerPersona,
  type PersonaRun,
  type ScenarioCase,
  type TermLever,
  type TermMix,
} from '@pactlab/calculations';
import { appendAuditEvent, withTenant, type Prisma, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { isCounterpartyRole, newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FINDINGS_REPOSITORY, type FindingsRepository } from '../findings/findings.repository';
import { PRISMA } from '../tokens';
import { ValuationService } from '../valuation/valuation.service';
import type { ContingencyBody, EvaluateBody, PersonaBody, SellerDraftBody, SellerNotesBody, TermResponsesBody } from './pricing.schemas';

export const PRICING_DEPENDENCIES = Symbol('PRICING_DEPENDENCIES');
export interface PricingDependencies {
  readonly gateway: ClaudeGateway;
}

/** Persona pricing is buyer analysis: the same rules as valuation. */
const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Anyone on the pact, the seller's contributors included, reads terms once proposed. */
const canReadProposed = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ');
/** Any of the seller's contributors acts for the seller (Kumar, 2026-11-06); each act is named. */
const isSeller = (role: DealRole) => role === 'TARGET_CONTRIBUTOR';
/** Which side a role acts for on terms (T-107): buyer roles that may write, or the seller's contributors. */
export function termSide(role: DealRole): 'BUYER' | 'SELLER' | null {
  if (isSeller(role)) return 'SELLER';
  return !isCounterpartyRole(role) && canWrite(role) ? 'BUYER' : null;
}
const termActor = (role: DealRole) => termSide(role) !== null;
const other = (side: string) => (side === 'BUYER' ? 'SELLER' : 'BUYER');

export type TermDecision = 'ACCEPT' | 'REJECT' | 'COUNTER';

/** The seller's own unproposed version, visible only to the seller side (T-107). */
/** Every lever a version of the terms may carry: the persona's levers, the headline price, and a financing contingency (T-117). */
export type ProposedLever = TermLever | 'PURCHASE_PRICE' | 'FINANCING_CONTINGENCY';
const dueOn = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

export interface SellerDraftView {
  readonly id: string;
  readonly version: number;
  readonly currency: string;
  readonly terms: readonly { readonly ordinal: number; readonly lever: ProposedLever; readonly amount: string; readonly currency: string; readonly note: string; readonly dueOn: string | null }[];
}
export interface TermResponseView {
  readonly decision: TermDecision;
  readonly counterAmount: string | null;
  readonly note: string;
  readonly respondedBy: string;
  readonly respondedAt: string;
}

/** The newest response per term ordinal. */
function latestResponses(rows: readonly { ordinal: number; decision: string; counterAmount: { toFixed(digits: number): string } | null; note: string; respondedBy: string; respondedAt: Date }[]) {
  const latest = new Map<number, TermResponseView>();
  for (const row of [...rows].sort((a, b) => a.respondedAt.getTime() - b.respondedAt.getTime())) {
    latest.set(row.ordinal, { decision: row.decision as TermDecision, counterAmount: row.counterAmount?.toFixed(2) ?? null, note: row.note, respondedBy: row.respondedBy, respondedAt: row.respondedAt.toISOString() });
  }
  return latest;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Findings about people reach the model only as their area, never their text (rule 7). */
const PEOPLE_DOMAINS: ReadonlySet<string> = new Set(['KEY_PERSON', 'PEOPLE']);

export interface EvaluationCase {
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly case: ScenarioCase;
  readonly equityPurchasePrice: string;
}

export interface EvaluationView {
  readonly id: string;
  readonly persona: BuyerPersona;
  readonly personaLabel: string;
  readonly personaVersion: string;
  readonly runIds: readonly string[];
  readonly cases: readonly EvaluationCase[];
  readonly termMix: TermMix;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** An evaluation against the active one: positive means more than the active evaluation. */
export interface EvaluationDelta {
  readonly price: string;
  readonly cashAtClose: string;
  readonly holdbacks: string;
  readonly earnout: string;
  readonly sellerFinancing: string;
  readonly levers: Readonly<Partial<Record<TermLever, string>>>;
}

/**
 * What the seller's side sees of proposed terms: built field by field, never
 * spread from a row, so no persona, parameter, finding or evaluation id leaks.
 */
export interface SellerTermsView {
  readonly id: string;
  readonly version: number;
  readonly proposedAt: string;
  readonly currency: string;
  /** Who proposed this version (T-107); the other side answers it. */
  readonly initiatedBySide: 'BUYER' | 'SELLER';
  /** Set once the other side accepted every term: the version is agreed and frozen. */
  readonly agreedAt: string | null;
  /** Set when a signatory turned the agreed version down; a new version follows. */
  readonly declinedAt: string | null;
  /** True for the answering side while this version is open for an answer. */
  readonly canRespond: boolean;
  /** True for the proposing side when the other side has countered. */
  readonly canAcceptCounters: boolean;
  readonly terms: readonly {
    readonly ordinal: number;
    readonly lever: ProposedLever;
    readonly amount: string;
    readonly currency: string;
    readonly sellerNote: string;
    /** A financing contingency's date (T-117); null for every other term. */
    readonly dueOn: string | null;
    /** The seller side's latest answer to this term. */
    readonly response: { readonly decision: TermDecision; readonly counterAmount: string | null; readonly note: string; readonly respondedAt: string } | null;
  }[];
}

function aiFailure(error: unknown): never {
  if (error instanceof GatewayPolicyError) {
    if (error.code === 'PROHIBITED_DATA') throw new UnprocessableEntityException();
    throw new ServiceUnavailableException({ code: 'AI_OFF' });
  }
  throw error;
}
const providerUnavailable = (kind: string | null) =>
  new ServiceUnavailableException({ code: kind === 'ACCESS' ? 'AI_ACCESS' : kind === 'THROTTLED' ? 'AI_THROTTLED' : 'AI_UNAVAILABLE' });

const leverTotals = (mix: TermMix) => {
  const totals = new Map<TermLever, InstanceType<typeof D>>();
  for (const line of mix.lines) totals.set(line.lever, (totals.get(line.lever) ?? new D(0)).plus(line.amount.amount));
  return totals;
};

/** The deltas of one evaluation against another, as two-decimal strings. */
export function evaluationDelta(mix: TermMix, active: TermMix): EvaluationDelta {
  const minus = (a: string, b: string) => new D(a).minus(b).toFixed(2);
  const mine = leverTotals(mix);
  const theirs = leverTotals(active);
  const levers: Partial<Record<TermLever, string>> = {};
  for (const lever of new Set([...mine.keys(), ...theirs.keys()])) {
    levers[lever] = (mine.get(lever) ?? new D(0)).minus(theirs.get(lever) ?? new D(0)).toFixed(2);
  }
  return {
    price: minus(mix.price.amount, active.price.amount),
    cashAtClose: minus(mix.cashAtClose.amount, active.cashAtClose.amount),
    holdbacks: minus(mix.holdbacks.amount, active.holdbacks.amount),
    earnout: minus(mix.earnout.amount, active.earnout.amount),
    sellerFinancing: minus(mix.sellerFinancing.amount, active.sellerFinancing.amount),
    levers,
  };
}

/**
 * Buyer personas (T-105, ADR 0021). Evaluates a pact under a persona from the
 * findings already accepted (no re-upload, no re-extraction), records the
 * persona-priced runs and the evaluation (never mutating earlier ones), adopts
 * an evaluation as the active pricing, drafts versioned term proposals from
 * it, and drafts the negotiation brief. Proposed terms are sticky: adopting
 * another evaluation changes nothing the seller sees until terms are proposed
 * again. Persona and everything derived from it stay buyer-side.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(ValuationService) private readonly valuation: ValuationService,
    @Inject(FINDINGS_REPOSITORY) private readonly findings: FindingsRepository,
    @Inject(PRICING_DEPENDENCIES) private readonly deps: PricingDependencies,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetType: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome: 'SUCCEEDED', requestId });
  }

  private async personaOf(tx: TransactionClient, tenant: TenantContext, dealId: string) {
    const [deal, organization] = await Promise.all([
      tx.deal.findUnique({ where: { id: dealId }, select: { persona: true } }),
      tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { defaultPersona: true } }),
    ]);
    if (!deal) throw new NotFoundException();
    const pact = isBuyerPersona(deal.persona) ? deal.persona : null;
    const organizationDefault = isBuyerPersona(organization?.defaultPersona) ? organization.defaultPersona : null;
    return { pact, organizationDefault, effective: resolvePersona(pact, organizationDefault) };
  }

  private toView(row: Prisma.PricingEvaluationGetPayload<object>): EvaluationView {
    const persona = row.persona as BuyerPersona;
    return {
      id: row.id,
      persona,
      personaLabel: PERSONA_PROFILE[persona].label,
      personaVersion: row.personaVersion,
      runIds: row.runIds,
      cases: row.cases as unknown as EvaluationCase[],
      termMix: row.termMix as unknown as TermMix,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** The buyer's pricing view: persona settings, evaluations with deltas against the active one, term batches and the active brief. */
  async view(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'pricing.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const persona = await this.personaOf(tx, tenant, dealId);
      const [rows, adoption, batches] = await Promise.all([
        tx.pricingEvaluation.findMany({ where: { dealId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30 }),
        tx.pricingAdoption.findFirst({ where: { dealId }, orderBy: [{ adoptedAt: 'desc' }, { id: 'desc' }] }),
        tx.termProposalBatch.findMany({ where: { dealId }, orderBy: { version: 'desc' }, include: { terms: { orderBy: { ordinal: 'asc' } }, responses: true }, take: 20 }),
      ]);
      const evaluations = rows.map((row) => this.toView(row));
      const activeRow = adoption ? (evaluations.find((evaluation) => evaluation.id === adoption.evaluationId) ?? this.toView(await tx.pricingEvaluation.findUniqueOrThrow({ where: { id: adoption.evaluationId } }))) : null;
      const brief = activeRow
        ? await tx.negotiationBrief.findFirst({ where: { dealId, evaluationId: activeRow.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
        : null;
      const proposed = batches.find((batch) => batch.proposedAt !== null) ?? null;
      return {
        persona: {
          ...persona,
          options: BUYER_PERSONAS.map((key) => ({ persona: key, label: PERSONA_PROFILE[key].label, descriptor: PERSONA_PROFILE[key].descriptor, icon: PERSONA_PROFILE[key].icon, caption: PERSONA_PROFILE[key].caption })),
        },
        active: activeRow && adoption ? { evaluationId: activeRow.id, adoptedAt: adoption.adoptedAt.toISOString(), adoptedBy: adoption.adoptedBy } : null,
        evaluations: evaluations.map((evaluation) => ({
          ...evaluation,
          deltaToActive: activeRow && evaluation.id !== activeRow.id ? evaluationDelta(evaluation.termMix, activeRow.termMix) : null,
        })),
        batches: batches.map((batch) => {
          const responses = latestResponses(batch.responses);
          return {
            id: batch.id,
            version: batch.version,
            evaluationId: batch.evaluationId,
            currency: batch.currency,
            createdAt: batch.createdAt.toISOString(),
            proposedAt: batch.proposedAt?.toISOString() ?? null,
            agreedAt: batch.agreedAt?.toISOString() ?? null,
            declinedAt: batch.declinedAt?.toISOString() ?? null,
            initiatedBySide: batch.initiatedBySide as 'BUYER' | 'SELLER',
            terms: batch.terms.map((term) => ({ ordinal: term.ordinal, lever: term.lever as ProposedLever, amount: term.amount.toFixed(2), currency: term.currency, findingId: term.findingId, sellerNote: term.sellerNote, dueOn: dueOn(term.dueOn), response: responses.get(term.ordinal) ?? null })),
          };
        }),
        // Proposed terms are sticky: true when the seller still sees terms from another evaluation.
        sellerSeesOtherPricing: Boolean(activeRow && proposed && proposed.evaluationId !== activeRow.id),
        brief: brief ? { id: brief.id, evaluationId: brief.evaluationId, sections: brief.sections, createdAt: brief.createdAt.toISOString() } : null,
      };
    });
  }

  /** The persona this pact prices under; null follows the organization default. */
  async setPactPersona(tenant: TenantContext, dealId: string, body: PersonaBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'persona.pact_changed', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.deal.updateMany({ where: { id: dealId }, data: { persona: body.persona } });
      await this.audit(tx, tenant, dealId, 'persona.pact_changed', 'deal', dealId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /**
   * Price the pact under a persona: the tagged scenarios at their current
   * assumptions, the accepted findings as they stand. Writes new runs and a
   * new evaluation; nothing earlier changes, and findings are only read.
   */
  async evaluate(tenant: TenantContext, dealId: string, body: EvaluateBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'pricing.evaluated', requestId });
    const scenarios = await this.valuation.pricingInputs(tenant, dealId);
    if (scenarios.length === 0) throw new UnprocessableEntityException('Create a valuation scenario before pricing under a persona');
    const accepted = await this.findings.list(tenant, dealId, { status: 'ACCEPTED' });
    const keyPeople = new Set(accepted.filter((finding) => finding.domain === 'KEY_PERSON').map((finding) => finding.id));
    let runs: (PersonaRun & { scenarioId: string; scenarioName: string; assumptionVersion: number; scenarioCase: ScenarioCase })[];
    try {
      runs = scenarios.map(({ scenario, scenarioCase, inputs }) => ({
        ...personaRun(inputs, body.persona, keyPeople),
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        assumptionVersion: scenario.assumptionVersion,
        scenarioCase,
      }));
    } catch (error) {
      if (error instanceof ValuationInputError) throw new UnprocessableEntityException();
      throw error;
    }
    const currencies = new Set(runs.map((run) => run.result.currency));
    if (currencies.size > 1) throw new UnprocessableEntityException('Tagged scenarios must share one currency');
    const price = weightedPrice(
      runs.map((run) => ({ case: run.scenarioCase, equityPurchasePrice: run.result.bridge.equityPurchasePrice.amount })),
      body.persona,
    );
    const weights = PERSONA_PROFILE[body.persona].weights;
    const base = runs.find((run) => run.scenarioCase === 'BASE') ?? [...runs].sort((x, y) => new D(weights[y.scenarioCase]).comparedTo(weights[x.scenarioCase]))[0];
    if (!base) throw new UnprocessableEntityException();
    const mix = termMix(body.persona, price, base);
    const now = new Date();
    const priced = runs.map((run) => ({ ...run, runId: newId() }));
    const runIds = priced.map((run) => run.runId);
    const evaluationId = newId();
    await withTenant(this.prisma, tenant, async (tx) => {
      for (const run of priced) {
        await tx.valuationRun.create({
          data: {
            id: run.runId,
            organizationId: tenant.organizationId,
            dealId,
            scenarioId: run.scenarioId,
            assumptionVersion: run.assumptionVersion,
            inputs: json(run.inputs),
            result: json(run.result),
            persona: run.persona,
            personaVersion: run.personaVersion,
            personaRouting: json(run.routing),
            ranBy: tenant.userId,
            ranAt: now,
          },
        });
      }
      await tx.pricingEvaluation.create({
        data: {
          id: evaluationId,
          organizationId: tenant.organizationId,
          dealId,
          persona: body.persona,
          personaVersion: mix.personaVersion,
          runIds,
          cases: json(
            priced.map((run): EvaluationCase => ({
              runId: run.runId,
              scenarioId: run.scenarioId,
              scenarioName: run.scenarioName,
              case: run.scenarioCase,
              equityPurchasePrice: run.result.bridge.equityPurchasePrice.amount,
            })),
          ),
          currency: mix.currency,
          weightedPrice: mix.price.amount,
          termMix: json(mix),
          createdBy: tenant.userId,
          createdAt: now,
        },
      });
      await this.audit(tx, tenant, dealId, 'pricing.evaluated', 'pricing_evaluation', evaluationId, requestId);
      // The pact's first evaluation becomes its active pricing; later ones are adopted explicitly.
      if (!(await tx.pricingAdoption.findFirst({ where: { dealId }, select: { id: true } }))) {
        await tx.pricingAdoption.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, evaluationId, adoptedBy: tenant.userId, adoptedAt: now } });
        await this.audit(tx, tenant, dealId, 'pricing.adopted', 'pricing_evaluation', evaluationId, requestId);
      }
    });
    return this.view(tenant, dealId, requestId);
  }

  async adopt(tenant: TenantContext, dealId: string, evaluationId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'pricing.adopted', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      if (!(await tx.pricingEvaluation.findFirst({ where: { id: evaluationId, dealId }, select: { id: true } }))) throw new NotFoundException();
      await tx.pricingAdoption.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, evaluationId, adoptedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'pricing.adopted', 'pricing_evaluation', evaluationId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  private async activeEvaluation(tx: TransactionClient, dealId: string) {
    const adoption = await tx.pricingAdoption.findFirst({ where: { dealId }, orderBy: [{ adoptedAt: 'desc' }, { id: 'desc' }] });
    if (!adoption) throw new ConflictException('Adopt a pricing evaluation first');
    return this.toView(await tx.pricingEvaluation.findUniqueOrThrow({ where: { id: adoption.evaluationId } }));
  }

  /** Draft the next version of the deal terms from the active evaluation, seller notes empty. */
  async draftTerms(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'terms.drafted', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const active = await this.activeEvaluation(tx, dealId);
      const latest = await tx.termProposalBatch.findFirst({ where: { dealId }, orderBy: { version: 'desc' }, select: { version: true } });
      const batchId = newId();
      await tx.termProposalBatch.create({
        data: { id: batchId, organizationId: tenant.organizationId, dealId, evaluationId: active.id, version: (latest?.version ?? 0) + 1, currency: active.termMix.currency, createdBy: tenant.userId },
      });
      // The headline price leads every version (T-107); the adjustments follow.
      await tx.termProposal.createMany({
        data: [
          { lever: 'PURCHASE_PRICE', amount: active.termMix.price.amount, currency: active.termMix.price.currency, findingId: null },
          ...active.termMix.lines.map((line) => ({ lever: line.lever, amount: line.amount.amount, currency: line.amount.currency, findingId: line.findingId })),
        ].map((term, ordinal) => ({ id: newId(), organizationId: tenant.organizationId, dealId, batchId, ordinal, ...term })),
      });
      await this.audit(tx, tenant, dealId, 'terms.drafted', 'term_proposal_batch', batchId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /**
   * The buyer adds a financing contingency to their draft (T-117): the financed amount it covers and
   * the date the financing must be in place by. Certainty of close, not price: it never enters the
   * evaluation or the term mix, and the seller answers it like any other term. One per version.
   */
  async addFinancingContingency(tenant: TenantContext, dealId: string, batchId: string, body: ContingencyBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'terms.contingency_added', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const batch = await this.draft(tx, dealId, batchId);
      if (batch.initiatedBySide !== 'BUYER') throw new NotFoundException();
      const terms = await tx.termProposal.findMany({ where: { batchId }, select: { ordinal: true, lever: true } });
      if (terms.some((term) => term.lever === 'FINANCING_CONTINGENCY')) throw new ConflictException('This version already has a financing contingency');
      await tx.termProposal.create({
        data: { id: newId(), organizationId: tenant.organizationId, dealId, batchId, ordinal: Math.max(-1, ...terms.map((term) => term.ordinal)) + 1, lever: 'FINANCING_CONTINGENCY', amount: body.amount, currency: batch.currency, findingId: null, sellerNote: body.note, dueOn: new Date(`${body.dueOn}T00:00:00Z`) },
      });
      await this.audit(tx, tenant, dealId, 'terms.contingency_added', 'term_proposal_batch', batchId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  private async draft(tx: TransactionClient, dealId: string, batchId: string) {
    const batch = await tx.termProposalBatch.findFirst({ where: { id: batchId, dealId } });
    if (!batch) throw new NotFoundException();
    if (batch.proposedAt) throw new ConflictException('Proposed terms are frozen; draft a new version');
    return batch;
  }

  async updateSellerNotes(tenant: TenantContext, dealId: string, batchId: string, body: SellerNotesBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'terms.notes_updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await this.draft(tx, dealId, batchId);
      for (const note of body.notes) await tx.termProposal.updateMany({ where: { batchId, ordinal: note.ordinal }, data: { sellerNote: note.sellerNote } });
      await this.audit(tx, tenant, dealId, 'terms.notes_updated', 'term_proposal_batch', batchId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** Propose a draft to the seller. One-way: the batch is frozen from here on. */
  async propose(tenant: TenantContext, dealId: string, batchId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'terms.proposed', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await this.draft(tx, dealId, batchId);
      await tx.termProposalBatch.update({ where: { id: batchId }, data: { proposedAt: new Date(), proposedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'terms.proposed', 'term_proposal_batch', batchId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /**
   * The latest proposed terms, either side's, in the shape both sides may see;
   * null before any are proposed. The seller also gets their own draft, if any.
   */
  async proposedTerms(tenant: TenantContext, dealId: string, requestId: string): Promise<{ side: 'BUYER' | 'SELLER' | null; proposed: SellerTermsView | null; draft: SellerDraftView | null }> {
    const role = await this.access.require(tenant, dealId, canReadProposed, { action: 'terms.viewed', requestId });
    const side = termSide(role);
    const [batch, draft] = await withTenant(this.prisma, tenant, async (tx) => [
      await tx.termProposalBatch.findFirst({ where: { dealId, proposedAt: { not: null } }, orderBy: { version: 'desc' }, include: { terms: { orderBy: { ordinal: 'asc' } }, responses: true } }),
      side === 'SELLER'
        ? await tx.termProposalBatch.findFirst({ where: { dealId, initiatedBySide: 'SELLER', proposedAt: null }, orderBy: { version: 'desc' }, include: { terms: { orderBy: { ordinal: 'asc' } } } })
        : null,
    ] as const);
    const draftView: SellerDraftView | null = draft
      ? { id: draft.id, version: draft.version, currency: draft.currency, terms: draft.terms.map((term) => ({ ordinal: term.ordinal, lever: term.lever as ProposedLever, amount: term.amount.toFixed(2), currency: term.currency, note: term.sellerNote, dueOn: dueOn(term.dueOn) })) }
      : null;
    if (!batch?.proposedAt) return { side, proposed: null, draft: draftView };
    const responses = latestResponses(batch.responses);
    const open = !batch.agreedAt && !batch.declinedAt;
    return {
      side,
      proposed: {
        id: batch.id,
        version: batch.version,
        proposedAt: batch.proposedAt.toISOString(),
        currency: batch.currency,
        initiatedBySide: batch.initiatedBySide as 'BUYER' | 'SELLER',
        agreedAt: batch.agreedAt?.toISOString() ?? null,
        declinedAt: batch.declinedAt?.toISOString() ?? null,
        canRespond: open && side !== null && side !== batch.initiatedBySide,
        canAcceptCounters: open && side === batch.initiatedBySide && [...responses.values()].some((response) => response.decision === 'COUNTER'),
        terms: batch.terms.map((term) => {
          const response = responses.get(term.ordinal);
          return {
            ordinal: term.ordinal,
            lever: term.lever as ProposedLever,
            amount: term.amount.toFixed(2),
            currency: term.currency,
            sellerNote: term.sellerNote,
            dueOn: dueOn(term.dueOn),
            response: response ? { decision: response.decision, counterAmount: response.counterAmount, note: response.note, respondedAt: response.respondedAt } : null,
          };
        }),
      },
      draft: draftView,
    };
  }

  /**
   * The other side's answer to the latest proposed terms (T-107: either side
   * proposes, the other answers): per term, accept, reject or counter. When
   * every term is accepted, the version is agreed and frozen.
   */
  async respond(tenant: TenantContext, dealId: string, body: TermResponsesBody, requestId: string) {
    const role = await this.access.require(tenant, dealId, termActor, { action: 'terms.responded', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const batch = await tx.termProposalBatch.findFirst({ where: { dealId, proposedAt: { not: null } }, orderBy: { version: 'desc' }, include: { terms: { select: { ordinal: true } } } });
      if (!batch) throw new NotFoundException();
      if (termSide(role) !== other(batch.initiatedBySide)) throw new ForbiddenException('The other side answers these terms');
      if (batch.agreedAt || batch.declinedAt) throw new ConflictException('These terms are already agreed');
      const ordinals = new Set(batch.terms.map((term) => term.ordinal));
      if (body.responses.some((response) => !ordinals.has(response.ordinal))) throw new UnprocessableEntityException('Answer only the proposed terms');
      const now = new Date();
      await tx.termResponse.createMany({
        data: body.responses.map((response) => ({
          id: newId(),
          organizationId: tenant.organizationId,
          dealId,
          batchId: batch.id,
          ordinal: response.ordinal,
          decision: response.decision,
          counterAmount: response.counterAmount ?? null,
          note: response.note,
          respondedBy: tenant.userId,
          respondedAt: now,
        })),
      });
      await this.audit(tx, tenant, dealId, 'terms.responded', 'term_proposal_batch', batch.id, requestId);
      const all = await tx.termResponse.findMany({ where: { batchId: batch.id } });
      const latest = latestResponses(all);
      if (batch.terms.every((term) => latest.get(term.ordinal)?.decision === 'ACCEPT')) {
        await tx.termProposalBatch.update({ where: { id: batch.id }, data: { agreedAt: now } });
        await this.audit(tx, tenant, dealId, 'terms.agreed', 'term_proposal_batch', batch.id, requestId);
      }
    });
    return this.proposedTerms(tenant, dealId, requestId);
  }

  /**
   * The proposing side takes the other side's counters into its next version:
   * the proposed terms with each countered amount substituted, as a draft it
   * then proposes. Always one side proposing, the other accepting.
   */
  async acceptCounters(tenant: TenantContext, dealId: string, batchId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, termActor, { action: 'terms.counters_accepted', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const batch = await tx.termProposalBatch.findFirst({ where: { id: batchId, dealId }, include: { terms: { orderBy: { ordinal: 'asc' } }, responses: true } });
      if (!batch) throw new NotFoundException();
      if (termSide(role) !== batch.initiatedBySide) throw new ForbiddenException('The proposing side takes counters into its next version');
      if (!batch.proposedAt || batch.agreedAt || batch.declinedAt) throw new ConflictException('Only open proposed terms carry counters');
      const latest = latestResponses(batch.responses);
      if (![...latest.values()].some((response) => response.decision === 'COUNTER')) throw new ConflictException('The other side has not countered these terms');
      const newest = await tx.$queryRaw<{ version: number }[]>`SELECT coalesce(max(version), 0)::int AS version FROM term_proposal_batches WHERE deal_id = ${dealId}::uuid`;
      const nextId = newId();
      await tx.termProposalBatch.create({
        data: { id: nextId, organizationId: tenant.organizationId, dealId, evaluationId: batch.evaluationId, initiatedBySide: batch.initiatedBySide, version: Math.max(newest[0]?.version ?? 0, batch.version) + 1, currency: batch.currency, createdBy: tenant.userId },
      });
      await tx.termProposal.createMany({
        data: batch.terms.map((term) => {
          const response = latest.get(term.ordinal);
          return {
            id: newId(),
            organizationId: tenant.organizationId,
            dealId,
            batchId: nextId,
            ordinal: term.ordinal,
            lever: term.lever,
            amount: response?.decision === 'COUNTER' && response.counterAmount ? response.counterAmount : term.amount.toFixed(2),
            currency: term.currency,
            findingId: term.findingId,
            sellerNote: term.sellerNote,
            dueOn: term.dueOn,
          };
        }),
      });
      await this.audit(tx, tenant, dealId, 'terms.counters_accepted', 'term_proposal_batch', nextId, requestId);
    });
    return termSide(role) === 'BUYER' ? this.view(tenant, dealId, requestId) : this.proposedTerms(tenant, dealId, requestId);
  }

  /**
   * A version of the seller's own (T-107): the seller drafts terms (headline
   * price first), then proposes them for the buyer to answer.
   */
  async draftSellerTerms(tenant: TenantContext, dealId: string, body: SellerDraftBody, requestId: string) {
    await this.access.require(tenant, dealId, isSeller, { action: 'terms.drafted', requestId });
    if (body.terms[0]?.lever !== 'PURCHASE_PRICE' || body.terms.filter((term) => term.lever === 'PURCHASE_PRICE').length !== 1) {
      throw new UnprocessableEntityException('A version leads with the purchase price, once');
    }
    await withTenant(this.prisma, tenant, async (tx) => {
      const newest = await tx.$queryRaw<{ version: number }[]>`SELECT coalesce(max(version), 0)::int AS version FROM term_proposal_batches WHERE deal_id = ${dealId}::uuid`;
      const batchId = newId();
      await tx.termProposalBatch.create({
        data: { id: batchId, organizationId: tenant.organizationId, dealId, evaluationId: null, initiatedBySide: 'SELLER', version: (newest[0]?.version ?? 0) + 1, currency: body.currency, createdBy: tenant.userId },
      });
      await tx.termProposal.createMany({
        data: body.terms.map((term, ordinal) => ({ id: newId(), organizationId: tenant.organizationId, dealId, batchId, ordinal, lever: term.lever, amount: term.amount, currency: body.currency, findingId: null, sellerNote: term.note, dueOn: term.dueOn ? new Date(`${term.dueOn}T00:00:00Z`) : null })),
      });
      await this.audit(tx, tenant, dealId, 'terms.drafted', 'term_proposal_batch', batchId, requestId);
    });
    return this.proposedTerms(tenant, dealId, requestId);
  }

  /** The seller proposes their own draft. One-way: it is frozen from here on. */
  async proposeSellerTerms(tenant: TenantContext, dealId: string, batchId: string, requestId: string) {
    await this.access.require(tenant, dealId, isSeller, { action: 'terms.proposed', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const batch = await this.draft(tx, dealId, batchId);
      if (batch.initiatedBySide !== 'SELLER') throw new NotFoundException();
      await tx.termProposalBatch.update({ where: { id: batchId }, data: { proposedAt: new Date(), proposedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'terms.proposed', 'term_proposal_batch', batchId, requestId);
    });
    return this.proposedTerms(tenant, dealId, requestId);
  }

  /**
   * Draft the negotiation brief for an evaluation. The model sees the term
   * levers (no amounts), the findings they carry (title and area; key-person
   * findings only as an aggregate, never a name) and the persona's tone key.
   * Sections citing anything else, or stating a figure, are dropped.
   */
  async brief(tenant: TenantContext, dealId: string, evaluationId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'brief.generated', requestId });
    const evaluation = await withTenant(this.prisma, tenant, (tx) => tx.pricingEvaluation.findFirst({ where: { id: evaluationId, dealId } }));
    if (!evaluation) throw new NotFoundException();
    const view = this.toView(evaluation);
    const carried = new Map(view.termMix.lines.filter((line) => line.findingId).map((line) => [line.findingId as string, line.lever]));
    const findings = (await this.findings.list(tenant, dealId, { status: 'ACCEPTED' })).filter((finding) => carried.has(finding.id));
    if (findings.length === 0) throw new UnprocessableEntityException('The evaluation carries no accepted findings to brief on');
    const lines = findings.map((finding) =>
      [finding.id, finding.domain, PEOPLE_DOMAINS.has(finding.domain) ? 'People risk (details withheld)' : finding.title, carried.get(finding.id)].join(' | '),
    );
    const levers = [...new Set(view.termMix.lines.map((line) => line.lever))];
    let response;
    try {
      response = await this.deps.gateway.invoke(negotiationBriefPrompt, {
        organizationId: tenant.organizationId,
        dealId,
        inputs: [
          { name: 'tone', classification: 'PUBLIC', text: PERSONA_PROFILE[view.persona].briefTone },
          { name: 'terms', classification: 'BUSINESS', text: levers.join(', ') },
          { name: 'findings', classification: 'BUSINESS', text: lines.join('\n') },
        ],
      });
    } catch (error) {
      aiFailure(error);
    }
    await withTenant(this.prisma, tenant, (tx) => this.recordRun(tx, response.run));
    if (response.status === 'PROVIDER_ERROR') throw providerUnavailable(response.providerError);
    if (!response.output) throw new ServiceUnavailableException({ code: 'AI_UNAVAILABLE' });
    const { sections } = acceptedBriefSections(response.output, new Set(findings.map((finding) => finding.id)));
    if (sections.length === 0) throw new ServiceUnavailableException({ code: 'AI_UNAVAILABLE' });
    await withTenant(this.prisma, tenant, async (tx) => {
      const briefId = newId();
      await tx.negotiationBrief.create({
        data: {
          id: briefId,
          organizationId: tenant.organizationId,
          dealId,
          evaluationId,
          persona: view.persona,
          personaVersion: view.personaVersion,
          sections: json(sections),
          promptId: negotiationBriefPrompt.id,
          promptVersion: negotiationBriefPrompt.version,
          modelId: response.run.resolvedModelId,
          aiRunId: response.run.id,
          createdBy: tenant.userId,
        },
      });
      await this.audit(tx, tenant, dealId, 'brief.generated', 'negotiation_brief', briefId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  private async recordRun(tx: TransactionClient, run: AiRunRecord) {
    await tx.aiRun.create({
      data: {
        id: run.id,
        organizationId: run.organizationId,
        dealId: run.dealId,
        taskType: run.taskType,
        promptId: run.promptId,
        promptVersion: run.promptVersion,
        promptHash: run.promptHash,
        modelAlias: run.modelAlias,
        resolvedModelId: run.resolvedModelId,
        inputHashes: [...run.inputHashes],
        outputHash: run.outputHash,
        status: run.status,
        repairAttempted: run.repairAttempted,
        injectionSignals: run.injectionSignals,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        latencyMs: run.latencyMs,
        createdAt: new Date(run.createdAt),
      },
    });
  }
}
