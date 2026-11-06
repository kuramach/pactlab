import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
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
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FINDINGS_REPOSITORY, type FindingsRepository } from '../findings/findings.repository';
import { PRISMA } from '../tokens';
import { ValuationService } from '../valuation/valuation.service';
import type { EvaluateBody, PersonaBody, SellerNotesBody } from './pricing.schemas';

export const PRICING_DEPENDENCIES = Symbol('PRICING_DEPENDENCIES');
export interface PricingDependencies {
  readonly gateway: ClaudeGateway;
}

/** Persona pricing is buyer analysis: the same rules as valuation. */
const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Anyone on the pact, the seller's contributors included, reads terms once proposed. */
const canReadProposed = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ');

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
  readonly version: number;
  readonly proposedAt: string;
  readonly currency: string;
  readonly terms: readonly { readonly lever: TermLever; readonly amount: string; readonly currency: string; readonly sellerNote: string }[];
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
        tx.termProposalBatch.findMany({ where: { dealId }, orderBy: { version: 'desc' }, include: { terms: { orderBy: { ordinal: 'asc' } } }, take: 20 }),
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
          options: BUYER_PERSONAS.map((key) => ({ persona: key, label: PERSONA_PROFILE[key].label, descriptor: PERSONA_PROFILE[key].descriptor })),
        },
        active: activeRow ? { evaluationId: activeRow.id, adoptedAt: adoption!.adoptedAt.toISOString(), adoptedBy: adoption!.adoptedBy } : null,
        evaluations: evaluations.map((evaluation) => ({
          ...evaluation,
          deltaToActive: activeRow && evaluation.id !== activeRow.id ? evaluationDelta(evaluation.termMix, activeRow.termMix) : null,
        })),
        batches: batches.map((batch) => ({
          id: batch.id,
          version: batch.version,
          evaluationId: batch.evaluationId,
          currency: batch.currency,
          createdAt: batch.createdAt.toISOString(),
          proposedAt: batch.proposedAt?.toISOString() ?? null,
          terms: batch.terms.map((term) => ({ ordinal: term.ordinal, lever: term.lever as TermLever, amount: term.amount.toFixed(2), currency: term.currency, findingId: term.findingId, sellerNote: term.sellerNote })),
        })),
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
    const base = runs.find((run) => run.scenarioCase === 'BASE') ?? [...runs].sort((x, y) => new D(weights[y.scenarioCase]).comparedTo(weights[x.scenarioCase]))[0]!;
    const mix = termMix(body.persona, price, base);
    const now = new Date();
    const runIds = runs.map(() => newId());
    const evaluationId = newId();
    await withTenant(this.prisma, tenant, async (tx) => {
      for (const [index, run] of runs.entries()) {
        await tx.valuationRun.create({
          data: {
            id: runIds[index]!,
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
            runs.map((run, index): EvaluationCase => ({
              runId: runIds[index]!,
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
      await tx.termProposal.createMany({
        data: active.termMix.lines.map((line, ordinal) => ({
          id: newId(),
          organizationId: tenant.organizationId,
          dealId,
          batchId,
          ordinal,
          lever: line.lever,
          amount: line.amount.amount,
          currency: line.amount.currency,
          findingId: line.findingId,
        })),
      });
      await this.audit(tx, tenant, dealId, 'terms.drafted', 'term_proposal_batch', batchId, requestId);
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

  /** The latest terms proposed to the seller, in the seller-safe shape; null before any are proposed. */
  async proposedTerms(tenant: TenantContext, dealId: string, requestId: string): Promise<{ proposed: SellerTermsView | null }> {
    await this.access.require(tenant, dealId, canReadProposed, { action: 'terms.viewed', requestId });
    const batch = await withTenant(this.prisma, tenant, (tx) =>
      tx.termProposalBatch.findFirst({ where: { dealId, proposedAt: { not: null } }, orderBy: { version: 'desc' }, include: { terms: { orderBy: { ordinal: 'asc' } } } }),
    );
    if (!batch?.proposedAt) return { proposed: null };
    return {
      proposed: {
        version: batch.version,
        proposedAt: batch.proposedAt.toISOString(),
        currency: batch.currency,
        terms: batch.terms.map((term) => ({ lever: term.lever as TermLever, amount: term.amount.toFixed(2), currency: term.currency, sellerNote: term.sellerNote })),
      },
    };
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
