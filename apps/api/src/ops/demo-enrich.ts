/**
 * The rest of a demo pact (2026-11-09, Kumar: "synthetic data for every tab in each pact"):
 * screening, the team, code and delivery sources, the balance sheet, regulatory terms,
 * the claims register, the round (Venture Raise), Sextant's asking price, anchors and
 * judgement, the close and the post-close register, a bid process with three bidders, and
 * reports. Each step goes through the same services the app uses, so every tab shows
 * what a real pact would. Synthetic only; nothing here sends email or calls a model.
 */
import {
  anchorInputSchema,
  balanceSheetItemInputSchema,
  benchmarkQuerySchema,
  comparableBatchInputSchema,
  createClaimSchema,
  createOfferSchema,
  createRegulatoryEntrySchema,
  multipleJudgementInputSchema,
  screeningInputSchema,
  screeningVerdictSchema,
  updateClaimSchema,
  updatePostCloseItemSchema,
  ventureSettingsSchema,
} from '@pactlab/contracts';
import { COMPANY_TYPE_LABELS, newId, sourcesFor, type CompanyType, type TenantContext } from '@pactlab/domain';
import { BalanceSheetService } from '../balance-sheet/balance-sheet.service';
import { CloseService } from '../close/close.service';
import { ComparablesService } from '../comparables/comparables.service';
import { createConnectionSchema } from '../connections/connections.schemas';
import { ConnectionsService } from '../connections/connections.service';
import { uploadDocumentBodySchema } from '../documents/documents.schemas';
import { DocumentsService } from '../documents/documents.service';
import type { createApp } from '../app';
import { PhasesService } from '../phases/phases.service';
import { RegulatoryService } from '../regulatory/regulatory.service';
import { ReportsService } from '../reports/reports.service';
import { SaleService } from '../sale/sale.service';
import { VentureService } from '../venture/venture.service';

type App = Awaited<ReturnType<typeof createApp>>;
const REQUEST_ID = 'ops-demo-org';
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const scoped = (person: TenantContext, dealId: string): TenantContext => ({ ...person, dealIds: [...new Set([...person.dealIds, dealId as never])] });

/** The schema owner's session (see demo-org.ts). */
export interface OwnerQuery {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface DemoPeople {
  readonly buyer: TenantContext;
  readonly seller: TenantContext;
  readonly reviewer: TenantContext;
}

const PROPERTY: readonly CompanyType[] = ['MULTIFAMILY', 'COMMERCIAL_PROPERTY', 'HOTELS'];

/**
 * The seller's ask, set when the pact starts, so Sextant has something to measure: above the
 * base case (ARR 12M × 5 = 60M; NOI 3.2M ÷ 6% ≈ 53.3M), as asks usually are. A raise has none.
 */
export function demoAskingPrice(type: CompanyType) {
  if (type === 'VENTURE_RAISE') return null;
  return {
    amount: PROPERTY.includes(type) ? '58500000' : '66000000',
    currency: 'USD',
    basis: 'ENTERPRISE_VALUE' as const,
    source: 'BANKER' as const,
    quotedOn: daysFromNow(-30),
    earnOutAmount: null,
    note: "The seller's banker's indication (synthetic demo).",
  };
}

/** A one-page synthetic document whose exact sentences the demo then cites. */
async function citable(app: App, buyer: TenantContext, dealId: string, fileName: string, lines: readonly string[]) {
  const documents = app.get(DocumentsService, { strict: false });
  const uploaded = (await documents.upload(
    buyer,
    dealId,
    uploadDocumentBodySchema.parse({ fileName, contentType: 'text/markdown', contentBase64: Buffer.from(lines.join('\n\n')).toString('base64'), dataClass: 'FINANCIAL' }),
    REQUEST_ID,
  )) as { id: string };
  return (quote: string) => ({ documentId: uploaded.id, pageNumber: 1, quote });
}

/** Screening: headline figures and red flags (which become claims), then a GO verdict. Must run while the pact is in SCREENING. */
export async function screen(app: App, buyer: TenantContext, dealId: string, type: CompanyType): Promise<string> {
  const phases = app.get(PhasesService, { strict: false });
  const current = await phases.screening(buyer, dealId, REQUEST_ID);
  const property = PROPERTY.includes(type);
  await phases.saveScreening(
    buyer,
    dealId,
    screeningInputSchema.parse({
      intakeNotes: 'Teaser and headline financials received from the banker (synthetic demo).',
      headlineRevenue: property ? '5400000' : type === 'VENTURE_RAISE' ? '1800000' : '12000000',
      headlineCurrency: 'USD',
      valueLow: property ? '48000000' : type === 'VENTURE_RAISE' ? '18000000' : '50000000',
      valueHigh: property ? '60000000' : type === 'VENTURE_RAISE' ? '30000000' : '70000000',
      redFlags: property
        ? ['Occupancy quoted at 96% but the rent roll shows notices to vacate', 'Roof replacement deferred two years running']
        : ['Reported ARR includes one-off implementation fees', 'Top customer contract renews inside the next year'],
      expectedVersion: current.version,
    }),
    REQUEST_ID,
  );
  await phases.decide(buyer, dealId, screeningVerdictSchema.parse({ verdict: 'GO', rationale: 'Worth full diligence: the gaps are testable from the data room (synthetic demo).', gaps: 'Rent roll vs occupancy; renewal terms of the top customer.' }), REQUEST_ID);
  return 'screening GO';
}

/** Team: a synthetic analyst alongside the lead, reviewer and seller. */
export async function team(owner: OwnerQuery, organizationId: string, dealId: string, analyst: { id: string; name: string }): Promise<string> {
  await owner.query(`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [analyst.id, `pactlab|${analyst.id}`, analyst.name]);
  await owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER') ON CONFLICT DO NOTHING`, [newId(), organizationId, analyst.id]);
  await owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'ANALYST') ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`, [newId(), organizationId, dealId, analyst.id]);
  return 'analyst on the team';
}

/** Sources: the synthetic GitHub repository and Jira site, synced, for packs that read code or delivery. Engineering fills from these. */
export async function connectSources(app: App, buyer: TenantContext, dealId: string, type: CompanyType): Promise<string> {
  const kinds = new Set(sourcesFor(type).sources.map((source) => source.kind));
  const connections = app.get(ConnectionsService, { strict: false });
  const done: string[] = [];
  const wanted = [
    kinds.has('CODE') ? { provider: 'github', displayName: 'Product repository (synthetic)', mode: 'FIXTURE', config: { repository: 'troubledco/core' } } : null,
    kinds.has('DELIVERY') ? { provider: 'jira', displayName: 'Delivery tracker (synthetic)', mode: 'FIXTURE', config: { site: 'troubledco.atlassian.net', projectKeys: ['TC'] } } : null,
  ].filter((value) => value !== null);
  for (const payload of wanted) {
    const created = (await connections.create(buyer, dealId, createConnectionSchema.parse(payload), REQUEST_ID)) as { id: string };
    await connections.requestSync(buyer, dealId, created.id, `demo-${newId()}`, REQUEST_ID);
    done.push(payload.provider === 'github' ? 'GitHub' : 'Jira');
  }
  return done.length > 0 ? `${done.join(' and ')} synced` : 'no code or delivery sources for this pack';
}

/** Finances: cash, debt and debt-like items, each cited to a synthetic balance-sheet page. */
export async function finances(app: App, buyer: TenantContext, dealId: string): Promise<string> {
  const lines = {
    cash: 'Cash and cash equivalents at 30 September: USD 1,500,000.',
    loan: 'Senior term loan outstanding: USD 4,000,000 at 7.25% fixed, maturing 2029.',
    deferred: 'Deferred revenue on annual prepayments: USD 250,000.',
    bonus: 'Accrued but unpaid management bonuses: USD 120,000.',
  };
  const cite = await citable(app, buyer, dealId, 'balance-sheet-30-september (synthetic).md', ['Balance sheet summary (synthetic demo)', ...Object.values(lines)]);
  const balance = app.get(BalanceSheetService, { strict: false });
  const asOf = daysFromNow(-40);
  const items = [
    { kind: 'CASH', category: 'CASH', label: 'Operating accounts', amount: '1500000', ...cite(lines.cash) },
    { kind: 'DEBT', category: 'TERM_LOAN', label: 'Senior term loan', amount: '4000000', interestRatePercent: '7.25', rateType: 'FIXED', maturityDate: '2029-06-30', lender: 'Demo Bank (synthetic)', repayment: 'AMORTIZING', ...cite(lines.loan) },
    { kind: 'DEBT_LIKE', category: 'DEFERRED_REVENUE', label: 'Deferred revenue', amount: '250000', ...cite(lines.deferred) },
    { kind: 'DEBT_LIKE', category: 'ACCRUED_BONUS', label: 'Accrued bonuses', amount: '120000', ...cite(lines.bonus) },
  ];
  for (const item of items) await balance.create(buyer, dealId, balanceSheetItemInputSchema.parse({ currency: 'USD', asOf, ...item }), REQUEST_ID);
  return `${items.length} balance-sheet items`;
}

/** Regulatory: the agreement's certainty terms, the enforcement climate and a pledge, each cited to a synthetic agreement extract. */
export async function regulatory(app: App, buyer: TenantContext, dealId: string): Promise<string> {
  const lines = {
    terms: 'The Buyer shall use reasonable best efforts to obtain clearance and shall not be required to divest more than 3 sites.',
    fee: 'If clearance is not obtained by the Outside Date, the Buyer shall pay a reverse termination fee of USD 2,000,000.',
    posture: 'The authority signalled that it is holding its current approach to concentration in this sector.',
    pledge: 'The Buyer commits to keep current service levels for 24 months after completion.',
  };
  const cite = await citable(app, buyer, dealId, 'merger-agreement-extract (synthetic).md', ['Merger agreement extract and regulatory notes (synthetic demo)', ...Object.values(lines)]);
  const service = app.get(RegulatoryService, { strict: false });
  const entries = [
    { kind: 'TERMS', payload: { signedOn: daysFromNow(-20), outsideDate: daysFromNow(160), effortsStandard: 'REASONABLE_BEST_EFFORTS', divestitureCap: 3, currency: 'USD', terminationFees: [{ payer: 'ACQUIRER', amount: '2000000', trigger: 'Clearance not obtained by the Outside Date' }], ebitdaMultiple: null }, citation: cite(lines.terms) },
    { kind: 'POSTURE', payload: { date: daysFromNow(-10), authority: 'Competition authority (synthetic)', scope: 'SECTOR_SIGNAL', direction: 'HOLDING', signal: 'No change to the concentration approach in this sector.' }, citation: cite(lines.posture) },
    { kind: 'COMMITMENT', payload: { text: 'Keep current service levels for 24 months after completion.', measurement: 'Quarterly service report', enforcementParty: 'Competition authority (synthetic)', durationMonths: 24 }, citation: cite(lines.pledge) },
  ];
  for (const entry of entries) await service.addEntry(buyer, dealId, createRegulatoryEntrySchema.parse(entry), REQUEST_ID);
  return `${entries.length} regulatory entries`;
}

/** Claims: seller assertions next to the screening red flags, verified, contradicted or still open, linked to findings. */
export async function claims(app: App, buyer: TenantContext, dealId: string, findingIds: readonly string[]): Promise<string> {
  const phases = app.get(PhasesService, { strict: false });
  const statements = [
    { statement: 'Management: no customer is more than 15% of revenue.', source: 'Management presentation, p.12 (synthetic)', status: 'CONTRADICTED' as const, rationale: 'The billing import shows the largest customer above 15%.', findingIds: findingIds.slice(0, 1) },
    { statement: 'Management: all key staff are on standard notice periods.', source: 'Management call, week 2 (synthetic)', status: 'VERIFIED' as const, rationale: 'Employment summaries in the data room confirm it.', findingIds: [] },
    { statement: 'Management: no litigation is pending or threatened.', source: 'Data-room index (synthetic)', status: 'UNVERIFIED' as const, rationale: 'Awaiting the legal disclosure letter.', findingIds: [] },
  ];
  for (const claim of statements) await phases.createClaim(buyer, dealId, createClaimSchema.parse({ statement: claim.statement, source: claim.source }), REQUEST_ID);
  const listed = await phases.claims(buyer, dealId, REQUEST_ID);
  for (const claim of statements) {
    const row = listed.items.find((item) => item.statement === claim.statement);
    if (row) await phases.updateClaim(buyer, dealId, row.id, updateClaimSchema.parse({ expectedVersion: row.version, status: claim.status, rationale: claim.rationale, findingIds: claim.findingIds }), REQUEST_ID);
  }
  return `${statements.length} claims`;
}

/** Venture Raise: the round being raised and three competing offers, so the round model, comparison and investor view all work. */
export async function raise(app: App, buyer: TenantContext, dealId: string): Promise<string> {
  const venture = app.get(VentureService, { strict: false });
  await venture.saveSettings(buyer, dealId, ventureSettingsSchema.parse({ expectedVersion: null, roundType: 'SEED_PRICED', currency: 'USD', targetPreMoney: '25000000', raiseAmount: '5000000', poolTargetPct: '0.10', sector: 'SOFTWARE_SAAS' }), REQUEST_ID);
  const offers = [
    { investorName: 'Northfield Ventures (synthetic)', counterpartyType: 'VC', status: 'TERM_SHEET', preMoney: '24000000', amount: '4000000', poolTargetPct: '0.12', liquidationMultiple: '1', investorBoardSeats: 1, proRata: true, receivedOn: daysFromNow(-6) },
    { investorName: 'Harbor Seed Fund (synthetic)', counterpartyType: 'VC', status: 'TERM_SHEET', preMoney: '27000000', amount: '3000000', poolTargetPct: '0.10', liquidationMultiple: '1', participating: true, investorBoardSeats: 1, receivedOn: daysFromNow(-3) },
    { investorName: 'Angel syndicate (synthetic)', counterpartyType: 'ANGEL', status: 'PROSPECT', preMoney: '25000000', amount: '750000', mfn: true, receivedOn: daysFromNow(-1) },
  ];
  for (const offer of offers) await venture.createOffer(buyer, dealId, createOfferSchema.parse(offer), REQUEST_ID);
  return `round settings and ${offers.length} offers`;
}

/** Sextant: two negotiation anchors from the comparables and the lead's judgement of the ask. Needs the asking price. */
export async function sextant(app: App, buyer: TenantContext, dealId: string): Promise<string> {
  const comparables = app.get(ComparablesService, { strict: false });
  const benchmark = await comparables.benchmark(buyer, dealId, benchmarkQuerySchema.parse({}), REQUEST_ID);
  let anchors = 0;
  for (const comparable of benchmark.comparables.filter((item) => item.origin !== 'OWN_DEAL').slice(0, 2)) {
    try {
      await comparables.addAnchor(buyer, dealId, anchorInputSchema.parse({ comparableId: comparable.id, note: 'A recent precedent for the counter (synthetic demo).' }), REQUEST_ID);
      anchors += 1;
    } catch {
      // Not every comparable can price a counter (currency, ARR basis); the next one may.
    }
  }
  await comparables.recordJudgement(buyer, dealId, multipleJudgementInputSchema.parse({ verdict: 'HIGH', rationale: 'The ask implies a multiple above the comparables median (synthetic demo).' }), REQUEST_ID);
  return `${anchors} anchors and a judgement of the ask`;
}

/** The second pact of a pack: closed, then the post-close register generated and worked a little. */
export async function closeAndPostClose(app: App, people: DemoPeople, dealId: string): Promise<string> {
  const close = app.get(CloseService, { strict: false });
  const phases = app.get(PhasesService, { strict: false });
  const buyer = scoped(people.buyer, dealId);
  await close.close(buyer, dealId, REQUEST_ID);
  await phases.generatePostClose(buyer, dealId, REQUEST_ID);
  const register = await phases.postClose(buyer, dealId, REQUEST_ID);
  for (const [index, item] of register.items.slice(0, 4).entries()) {
    await phases.updatePostCloseItem(
      buyer,
      dealId,
      item.id,
      updatePostCloseItemSchema.parse({
        expectedVersion: item.version,
        status: index === 0 ? 'DONE' : 'OPEN',
        ownerUserId: people.buyer.userId,
        dueDate: daysFromNow(30 * (index + 1)),
        cadence: index === 1 ? 'QUARTERLY' : null,
        note: index === 0 ? 'Done in the first 30 days (synthetic demo).' : null,
      }),
      REQUEST_ID,
    );
  }
  return `closed; post-close register of ${register.items.length} items`;
}

/** Three synthetic bidder firms on the seller-led teaser: NDAs, questions and answers, two offers, a pass and a shortlist. */
export async function bidProcess(
  app: App,
  owner: OwnerQuery,
  lead: TenantContext,
  dealId: string,
  bidders: readonly { readonly id: string; readonly email: string; readonly name: string; readonly firm: string }[],
  resolve: (userId: string) => Promise<TenantContext | null>,
): Promise<string> {
  const sale = app.get(SaleService, { strict: false });
  const seller = scoped(lead, dealId);
  await sale.updateProcess(seller, dealId, {
    offerDeadline: new Date(Date.now() + 21 * 86_400_000).toISOString(),
    sharedSummary: 'Project Larkfield: a stabilised 96-unit garden-style community. Offers on an enterprise-value basis, with financing and diligence conditions stated (synthetic demo).',
    ndaText: 'The bidder keeps everything shared in this process confidential and uses it only to evaluate the acquisition (synthetic demo NDA).',
  }, REQUEST_ID);
  const bids: { id: string; firm: string; person: TenantContext }[] = [];
  for (const bidder of bidders) {
    await owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [bidder.id, `pactlab|${bidder.id}`, bidder.name, bidder.email]);
    const bid = (await sale.addBid(seller, dealId, { firmName: bidder.firm }, REQUEST_ID)) as { id: string };
    await owner.query(
      `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, bid_id) VALUES ($1, $2, $3, $4, 'BIDDER', $5) ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`,
      [newId(), lead.organizationId, dealId, bidder.id, bid.id],
    );
    const person = await resolve(bidder.id);
    if (!person) throw new Error(`The bidder ${bidder.firm} cannot be resolved.`);
    bids.push({ id: bid.id, firm: bidder.firm, person: scoped(person, dealId) });
  }
  for (const bid of bids) await sale.acceptNda(bid.person, dealId, REQUEST_ID);
  const [first, second, third] = bids;
  if (!first || !second || !third) return 'bid process: fewer than three bidders';
  await sale.ask(first.person, dealId, { question: 'What capital expenditure is planned for the roofs over the next two years?' }, REQUEST_ID);
  await sale.ask(second.person, dealId, { question: 'Can you share the trailing twelve months of utility costs by building?' }, REQUEST_ID);
  await sale.ask(third.person, dealId, { question: 'Is the on-site team expected to stay after the sale?' }, REQUEST_ID);
  const board = (await sale.board(seller, dealId, REQUEST_ID)) as { questions?: { id: string; question: string }[] };
  const questions = board.questions ?? [];
  const answerTo = async (text: string, answer: string, scope: 'PRIVATE' | 'ALL') => {
    const question = questions.find((item) => item.question.startsWith(text));
    if (question) await sale.answer(seller, dealId, question.id, { answer, scope }, REQUEST_ID);
  };
  await answerTo('What capital', 'Two of three roofs are due within 24 months; quotes are in the data room (synthetic).', 'ALL');
  await answerTo('Can you share', 'Shared with you directly: utility costs are in folder 4.2 (synthetic).', 'PRIVATE');
  await sale.offer(first.person, dealId, { price: '15200000', currency: 'USD', structure: 'All cash at completion; 30-day confirmatory diligence (synthetic).', conditions: 'Financing in place; no material change to occupancy.', validUntil: daysFromNow(30) }, REQUEST_ID);
  await sale.offer(second.person, dealId, { price: '14600000', currency: 'USD', structure: '80% cash, 20% seller note over 3 years (synthetic).', conditions: 'Lender appraisal at or above the price.', validUntil: daysFromNow(30) }, REQUEST_ID);
  await sale.pass(third.person, dealId, { reason: 'Outside our target region for this fund (synthetic).' }, REQUEST_ID);
  await sale.shortlist(seller, dealId, first.id, REQUEST_ID);
  return `bid process: ${bids.length} bidders, 3 questions, 2 offers, 1 pass, 1 shortlisted`;
}

/**
 * Entered comparables (cited, as a deal team adds them), two per pack, so every pact's
 * benchmark and Sextant anchors have precedents of its own type. Software trades on ARR;
 * the others on revenue. Once per organization: a re-run flags them as duplicates.
 */
export async function enteredComparables(app: App, buyer: TenantContext, types: readonly CompanyType[]): Promise<string> {
  const comparables = app.get(ComparablesService, { strict: false });
  const rows = types.flatMap((type, index) => {
    const label = COMPANY_TYPE_LABELS[type];
    const arrBased = !PROPERTY.includes(type) && type !== 'PHARMA_BIOTECH' && type !== 'HOSPITALS' && type !== 'SMALL_CLINICS' && type !== 'PROFESSIONAL_SERVICES';
    const basis = arrBased ? 'ARR' : 'Revenue';
    const revenue = PROPERTY.includes(type) ? 5_200_000 : 11_000_000;
    return [
      { name: `${label} precedent A`, target: `${label} Target A`, acquirer: 'Atlas Holdings', days: 150 + index, multiple: PROPERTY.includes(type) ? 10 : 5, growth: 20 },
      { name: `${label} precedent B`, target: `${label} Target B`, acquirer: 'Northline Partners', days: 380 + index, multiple: PROPERTY.includes(type) ? 11 : 6, growth: 26 },
    ].map((row) =>
      [
        'Precedent transaction',
        `${row.name} (synthetic)`,
        `${row.target} (synthetic)`,
        `${row.acquirer} (synthetic)`,
        daysFromNow(-row.days),
        label,
        String(revenue * row.multiple),
        String(revenue),
        basis,
        'USD',
        String(row.growth),
        'Synthetic press release',
      ]
        .map((cell) => (/[",]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
        .join(','),
    );
  });
  const text = ['Kind,Name,Target,Acquirer,Date,Company type,EV,ARR,Basis,Currency,ARR growth %,Source', ...rows].join('\n');
  try {
    const result = (await comparables.importBatch(buyer, comparableBatchInputSchema.parse({ text }), REQUEST_ID)) as { imported: number };
    return `${result.imported} entered comparables`;
  } catch {
    return 'entered comparables: none new (already on record)';
  }
}

/** An executive report and a pact report, ready to download from Reports. */
export async function reports(app: App, buyer: TenantContext, dealId: string | null): Promise<string> {
  const service = app.get(ReportsService, { strict: false });
  await service.generate(buyer, 'EXECUTIVE', null, REQUEST_ID);
  if (dealId) await service.generate(scoped(buyer, dealId), 'PACT', dealId, REQUEST_ID);
  await service.whenIdle();
  return dealId ? 'executive and pact reports' : 'executive report';
}
