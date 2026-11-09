import { HttpException } from '@nestjs/common';
import { DEAL_PHASE_LABELS, type DealPhase, type TenantContext } from '@pactlab/domain';

/**
 * The report read models (T-110). Every section is built from the same application services the
 * app uses, called as the generating user: what their organization may not see is a refusal
 * (403/404), and a refused section is left out of the report, never filled in from elsewhere.
 * Money stays as decimal strings; totals are summed in integer cents.
 */

export interface Money {
  amount: string;
  currency: string;
}

/** Only these services, so the report reads exactly what the app shows. */
export interface ReportSources {
  deal(tenant: TenantContext, dealId: string): Promise<DealView | null>;
  deals(tenant: TenantContext): Promise<DealView[]>;
  findings(tenant: TenantContext, dealId: string): Promise<{ items: FindingView[] }>;
  valuation(tenant: TenantContext, dealId: string): Promise<{ items: ValuationItemView[] }>;
  pricing(tenant: TenantContext, dealId: string): Promise<{ persona: { effective: string | null; options: { persona: string; label: string }[] } }>;
  terms(tenant: TenantContext, dealId: string): Promise<{ side: string | null; proposed: ProposedView | null }>;
  claims(tenant: TenantContext, dealId: string): Promise<{ items: ClaimView[] }>;
  postClose(tenant: TenantContext, dealId: string): Promise<{ items: PostCloseItemView[] }>;
  documents(tenant: TenantContext, dealId: string): Promise<{ items: DocumentView[] }>;
  connections(tenant: TenantContext, dealId: string): Promise<ConnectionView[]>;
}

export interface DealView {
  id: string;
  name: string;
  targetName: string;
  stage: string;
  phase: DealPhase;
  status: string;
  baseCurrency: string;
  createdAt: string;
  initiatedBy?: string;
  parties?: { role: string; name: string }[];
  askingPrice?: { amount: string; currency: string; basis: string } | null;
}
export interface FindingView {
  id: string;
  title: string;
  domain: string;
  severity: string;
  status: string;
  direction: number | null;
  pricedRisk: { type: string; currency: string; low: string; high: string; basis: string } | null;
  valueConfirmation: { valueDriver: string } | null;
  directionRationale: string | null;
  updatedAt: string;
}
export interface ValuationItemView {
  scenario: { id: string; name: string; scenarioCase: string | null; status: string; currency: string; updatedAt?: string };
  latestRun: { id: string; ranAt: string; result: { method: string | { method: string; multiple?: string }; enterpriseValue: Money; bridge: { lines: { label: string; amount: Money }[]; equityPurchasePrice: Money; holdbacks: Money; cashAtClose: Money } } } | null;
  askingComparison: { asking: Money } | null;
  confirmedValue?: { totals: { amount?: string; currency?: string; low?: string; high?: string }[]; items: { label: string }[] } | null;
}
export interface ProposedView {
  version: number;
  agreedAt: string | null;
  canRespond?: boolean;
  terms: { lever: string; amount: string; currency?: string; response?: string | null }[];
}
export interface ClaimView {
  statement: string;
  source: string | null;
  status: string;
  rationale: string | null;
}
export interface PostCloseItemView {
  title?: string;
  kind?: string;
  status?: string;
  dueOn?: string | null;
}
export interface DocumentView {
  fileName: string;
  dataClass: string;
  createdAt: string;
  intake?: { state: string; category: string | null } | null;
}
export interface ConnectionView {
  displayName: string;
  provider: string;
  status: string;
  evidenceCount?: number;
  lastSyncRun?: { completedAt: string | null } | null;
}

export interface PactReportModel {
  kind: 'PACT';
  deal: DealView;
  sideLabel: string;
  evidence: { documents: DocumentView[]; sources: ConnectionView[] } | null;
  findings: FindingView[] | null;
  claims: ClaimView[] | null;
  valuation: { scenarios: ValuationItemView[]; persona: string | null; confirmedValue: string[] | null } | null;
  terms: { side: string | null; proposed: ProposedView | null } | null;
  postClose: PostCloseItemView[] | null;
  captured: { valuationRunIds: string[]; findingsCount: number };
}

export interface ExecutivePactBlock {
  deal: DealView;
  role: 'BUYER' | 'SELLER';
  asking: Money | null;
  priced: Money | null;
  findings: { risks: number; cushions: number; neutral: number; undecided: number };
  topDrags: { title: string; low: string; high: string; currency: string }[];
  /** Open priced drags (not rejected), summed per currency, for the roll-up. */
  dragExposure: Record<string, { low: string; high: string }>;
  openReview: number;
  awaitingResponse: boolean;
  lastActivity: string;
}

export interface ExecutiveReportModel {
  kind: 'EXECUTIVE';
  blocks: ExecutivePactBlock[];
  rollup: {
    openByPhase: Record<DealPhase, number>;
    valueInDiligence: Money[];
    dragExposure: { currency: string; low: string; high: string }[];
  };
  captured: { valuationRunIds: string[]; findingsCount: number; pactCount: number };
}

// --- Decimal sums without floating point -----------------------------------------------------

const cents = (amount: string): bigint => {
  const negative = amount.trim().startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace('-', '').trim().split('.');
  const value = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -value : value;
};
const fromCents = (value: bigint): string => {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};
export const addMoney = (a: string, b: string): string => fromCents(cents(a) + cents(b));

/** A section the caller may not see is left out (null); anything else is a real failure. */
async function visible<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof HttpException && (error.getStatus() === 403 || error.getStatus() === 404)) return null;
    throw error;
  }
}

const OPEN_FINDING = new Set(['DRAFT', 'IN_REVIEW', 'ACCEPTED']);
const activeRun = (items: readonly ValuationItemView[]) =>
  items.find((item) => item.scenario.scenarioCase === 'BASE' && item.latestRun) ?? items.find((item) => item.latestRun) ?? null;

export async function pactReportModel(sources: ReportSources, tenant: TenantContext, dealId: string): Promise<PactReportModel | null> {
  const deal = await visible(() => sources.deal(tenant, dealId));
  if (!deal) return null;
  const [documents, connections, findings, claims, valuation, pricing, terms, postClose] = await Promise.all([
    visible(() => sources.documents(tenant, dealId)),
    visible(() => sources.connections(tenant, dealId)),
    visible(() => sources.findings(tenant, dealId)),
    visible(() => sources.claims(tenant, dealId)),
    visible(() => sources.valuation(tenant, dealId)),
    visible(() => sources.pricing(tenant, dealId)),
    visible(() => sources.terms(tenant, dealId)),
    deal.phase === 'POST' ? visible(() => sources.postClose(tenant, dealId)) : Promise.resolve(null),
  ]);
  const persona = pricing?.persona.effective ? (pricing.persona.options.find((option) => option.persona === pricing.persona.effective)?.label ?? pricing.persona.effective) : null;
  const confirmed = valuation?.items.flatMap((item) => item.confirmedValue?.items.map((entry) => entry.label) ?? []) ?? null;
  return {
    kind: 'PACT',
    deal,
    sideLabel: terms?.side === 'SELLER' ? 'Seller side' : terms?.side === 'BUYER' ? 'Buyer side' : deal.initiatedBy === 'SELLER' ? 'Seller side' : 'Buyer side',
    evidence: documents || connections ? { documents: documents?.items ?? [], sources: connections ?? [] } : null,
    findings: findings?.items ?? null,
    claims: claims?.items.length ? claims.items : null,
    valuation: valuation ? { scenarios: valuation.items, persona, confirmedValue: confirmed && confirmed.length ? [...new Set(confirmed)] : null } : null,
    terms,
    postClose: postClose?.items.length ? postClose.items : null,
    captured: {
      valuationRunIds: (valuation?.items ?? []).flatMap((item) => (item.latestRun ? [item.latestRun.id] : [])),
      findingsCount: findings?.items.length ?? 0,
    },
  };
}

export async function executiveReportModel(sources: ReportSources, tenant: TenantContext): Promise<ExecutiveReportModel> {
  const deals = (await sources.deals(tenant)).filter((deal) => deal.status !== 'DELETED');
  const blocks: ExecutivePactBlock[] = [];
  const runIds: string[] = [];
  let findingsCount = 0;
  for (const deal of deals) {
    const [findings, valuation, terms] = await Promise.all([
      visible(() => sources.findings(tenant, deal.id)),
      visible(() => sources.valuation(tenant, deal.id)),
      visible(() => sources.terms(tenant, deal.id)),
    ]);
    const items = findings?.items ?? [];
    findingsCount += items.length;
    const run = activeRun(valuation?.items ?? []);
    if (run?.latestRun) runIds.push(run.latestRun.id);
    const drags = items.flatMap((finding) => (finding.direction === -1 && OPEN_FINDING.has(finding.status) && finding.pricedRisk ? [{ title: finding.title, risk: finding.pricedRisk }] : []));
    const dragExposure: Record<string, { low: string; high: string }> = {};
    for (const { risk } of drags) {
      const current = dragExposure[risk.currency] ?? { low: '0', high: '0' };
      dragExposure[risk.currency] = { low: addMoney(current.low, risk.low), high: addMoney(current.high, risk.high) };
    }
    const lastActivity = [deal.createdAt, ...items.map((finding) => finding.updatedAt), ...(run?.latestRun ? [run.latestRun.ranAt] : [])].sort().at(-1) ?? deal.createdAt;
    blocks.push({
      deal,
      role: deal.initiatedBy === 'SELLER' ? 'SELLER' : 'BUYER',
      asking: deal.askingPrice ? { amount: deal.askingPrice.amount, currency: deal.askingPrice.currency } : (run?.askingComparison?.asking ?? null),
      priced: run?.latestRun ? run.latestRun.result.enterpriseValue : null,
      findings: {
        risks: items.filter((finding) => finding.direction === -1 && finding.status !== 'REJECTED').length,
        cushions: items.filter((finding) => finding.direction === 1 && finding.status !== 'REJECTED').length,
        neutral: items.filter((finding) => finding.direction === 0 && finding.status !== 'REJECTED').length,
        undecided: items.filter((finding) => finding.direction === null && finding.status !== 'REJECTED').length,
      },
      topDrags: [...drags]
        .sort((a, b) => Number(cents(b.risk.high) - cents(a.risk.high)))
        .slice(0, 3)
        .map(({ title, risk }) => ({ title, low: risk.low, high: risk.high, currency: risk.currency })),
      dragExposure,
      openReview: items.filter((finding) => finding.status === 'DRAFT' || finding.status === 'IN_REVIEW').length,
      awaitingResponse: Boolean(terms?.proposed && !terms.proposed.agreedAt && terms.proposed.canRespond),
      lastActivity,
    });
  }
  // Open first (pre-diligence, diligence), then post-close; most recent activity first within each.
  const order: Record<DealPhase, number> = { PRE: 0, DILIGENCE: 0, POST: 1 };
  blocks.sort((a, b) => order[a.deal.phase] - order[b.deal.phase] || b.lastActivity.localeCompare(a.lastActivity));
  // The roll-up is computed only from the blocks above, so every total traces to them.
  const openByPhase: Record<DealPhase, number> = { PRE: 0, DILIGENCE: 0, POST: 0 };
  const value: Record<string, string> = {};
  const exposure: Record<string, { low: string; high: string }> = {};
  for (const block of blocks) {
    openByPhase[block.deal.phase] += 1;
    if (block.deal.phase === 'DILIGENCE') {
      const basis = block.priced ?? block.asking;
      if (basis) value[basis.currency] = addMoney(value[basis.currency] ?? '0', basis.amount);
    }
    for (const [currency, range] of Object.entries(block.dragExposure)) {
      const current = exposure[currency] ?? { low: '0', high: '0' };
      exposure[currency] = { low: addMoney(current.low, range.low), high: addMoney(current.high, range.high) };
    }
  }
  return {
    kind: 'EXECUTIVE',
    blocks,
    rollup: {
      openByPhase,
      valueInDiligence: Object.entries(value).map(([currency, amount]) => ({ currency, amount })),
      dragExposure: Object.entries(exposure).map(([currency, range]) => ({ currency, ...range })),
    },
    captured: { valuationRunIds: runIds, findingsCount, pactCount: blocks.length },
  };
}

export const phaseLabel = (phase: DealPhase) => DEAL_PHASE_LABELS[phase];
