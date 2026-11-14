/**
 * `scripts/ops-task.sh <env> src/ops/demo-org.ts [--reset]`: the demo organization (batch 2,
 * ADR 0019 amendment). Creates "Pactlab Demo (synthetic)" with
 *   - kumar+demo@pactlab.ai: organization owner and deal lead (the buyer),
 *   - kumar+demoseller@pactlab.ai: the seller's contributor on each pact (a guest),
 *   - a synthetic reviewer, so findings are accepted by a second person,
 * and one complete pact per pack (released packs on live; every pack elsewhere), built
 * through the real services from the public pactlab-demo-data repository at a pinned commit:
 * the data room, accepted findings, Downside / Base / Upside scenarios, a persona evaluation,
 * terms countered and agreed, both sides signed off, and a closing checklist with the funds
 * confirmed — plus screening, the team, synthetic code and delivery sources, the balance sheet,
 * regulatory terms, claims, Sextant's ask, anchors and judgement (demo-enrich.ts), a second,
 * closed pact per pack for Post-Close, and one seller-led Multifamily pact with a published
 * teaser and three synthetic bidders. Reports at the end.
 *
 * Synthetic only, and only ever this one organization. Model calls are scripted (no Bedrock).
 * Re-running adds only what is missing; `--reset` deletes the demo organization's pacts first.
 * Sends no email. Never prints credentials.
 */
import 'reflect-metadata';
import { S3Client } from '@aws-sdk/client-s3';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { apiEnvSchema, applyDatabaseUrls, loadConfig } from '@pactlab/config';
import { FixturePropertyProvider } from '@pactlab/connectors';
import { createPrismaClient, resolvePrincipal, S3ObjectStore } from '@pactlab/db';
import { uploadQuerySchema } from '@pactlab/contracts';
import { COMPANY_TYPES, DEMO_DATA_COMMIT, demoDataUrl, IMPORT_TARGET_DEFINITIONS, isReleasedCompanyType, newId, packFor, type CompanyType, type TenantContext } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import pg from 'pg';
import type { PrismaClient } from '@pactlab/db';
import { D } from '@pactlab/calculations';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import { CloseService } from '../close/close.service';
import { DealDeletionService } from '../deals/deletion/deal-deletion.service';
import { demoModelResponse } from '../demo-seed/seed';
import { DocumentsService } from '../documents/documents.service';
import { FileSystemObjectStore } from '../documents/storage-adapters';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { FindingsService } from '../findings/findings.service';
import { ImportsService } from '../imports/imports.service';
import { ListingsService } from '../listings/listings.service';
import { PactsService } from '../pacts/pacts.service';
import { FinancingService } from '../financing/financing.service';
import { PricingService } from '../pricing/pricing.service';
import { ValuationService } from '../valuation/valuation.service';
import { bidProcess, claims, closeAndPostClose, connectSources, demoAskingPrice, enteredComparables, finances, raise, regulatory, reports, screen, sextant, team } from './demo-enrich';

/** Fixed identities, so re-runs find what is there. */
export const DEMO_ORG = {
  id: '01900000-0000-7000-8000-0000000de001',
  name: 'Pactlab Demo (synthetic)',
  slug: 'pactlab-demo',
  buyer: { id: '01900000-0000-7000-8000-0000000de002', email: 'kumar+demo@pactlab.ai', name: 'Demo Buyer Lead' },
  seller: { id: '01900000-0000-7000-8000-0000000de003', email: 'kumar+demoseller@pactlab.ai', name: 'Demo Seller' },
  reviewer: { id: '01900000-0000-7000-8000-0000000de004', name: 'Demo Reviewer (synthetic)' },
  analyst: { id: '01900000-0000-7000-8000-0000000de005', name: 'Demo Analyst (synthetic)' },
  /** The teaser's bidders: guests on the seller-led pact only, each a firm of its own. */
  bidders: [
    { id: '01900000-0000-7000-8000-0000000de011', email: 'kumar+bidder-a@pactlab.ai', name: 'Bidder A (synthetic)', firm: 'Atlas Residential Partners (synthetic)' },
    { id: '01900000-0000-7000-8000-0000000de012', email: 'kumar+bidder-b@pactlab.ai', name: 'Bidder B (synthetic)', firm: 'Northline Capital (synthetic)' },
    { id: '01900000-0000-7000-8000-0000000de013', email: 'kumar+bidder-c@pactlab.ai', name: 'Bidder C (synthetic)', firm: 'Harbor Living Fund (synthetic)' },
  ],
} as const;

/** Who a demo organization is: its ids and people. `DEMO_ORG` is Kumar's own; the shared pool (T-113) has five more. */
export interface DemoOrgSpec {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly buyer: { readonly id: string; readonly email: string | null; readonly name: string };
  readonly seller: { readonly id: string; readonly email: string | null; readonly name: string };
  readonly reviewer: { readonly id: string; readonly name: string };
  readonly analyst: { readonly id: string; readonly name: string };
  readonly bidders: readonly { readonly id: string; readonly email: string | null; readonly name: string; readonly firm: string }[];
}

/** The demo data at a pinned commit (https://github.com/kuramach/pactlab-demo-data). */
export { DEMO_DATA_COMMIT } from '@pactlab/domain';
const REQUEST_ID = 'ops-demo-org';
const LABELS: Readonly<Record<string, string>> = {
  SOFTWARE_SAAS: 'Software & SaaS',
  FINTECH: 'Fintech',
  HEALTHCARE: 'Healthcare',
  TELECOM_MEDIA: 'Telecom & Media',
  ECOMMERCE_DTC: 'E-commerce',
  MULTIFAMILY: 'Multifamily',
  COMMERCIAL_PROPERTY: 'Commercial property',
  HOTELS: 'Hotels',
  SMALL_CLINICS: 'Clinics',
  HOSPITALS: 'Hospitals',
  PROFESSIONAL_SERVICES: 'Professional services',
  PHARMA_BIOTECH: 'Pharma & Biotech',
  VENTURE_RAISE: 'Venture raise',
};
export const pactName = (type: CompanyType, closed = false) => `${LABELS[type] ?? type} demo${closed ? ', closed' : ''} (synthetic)`;
/** A raise has no buyer terms or close, so it gets one pact; every other pack gets a second, closed one for Post-Close. */
export const pactVariants = (type: CompanyType): readonly boolean[] => (type === 'VENTURE_RAISE' ? [false] : [false, true]);
const SELLER_LED = 'Multifamily for sale demo (synthetic)';

/** Scenario assumptions by valuation method: property by NOI and cap rate, a raise by pre-money, the rest by revenue multiple. */
function scenarios(type: CompanyType, pricedFindingIds: readonly string[]) {
  const bridge = { cash: '1500000', debt: '4000000', debtLikeItems: '250000', workingCapitalAdjustment: '0' };
  const property = type === 'MULTIFAMILY' || type === 'COMMERCIAL_PROPERTY' || type === 'HOTELS';
  return (['DOWNSIDE', 'BASE', 'UPSIDE'] as const).map((scenarioCase, index) => ({
    name: `${scenarioCase[0]}${scenarioCase.slice(1).toLowerCase()} (synthetic)`,
    scenarioCase,
    values: {
      assumptions: property
        ? { method: 'NOI_CAP_RATE' as const, noi: '3200000', capRate: ['0.0675', '0.06', '0.055'][index] as string }
        : type === 'VENTURE_RAISE'
          ? { method: 'ROUND_PRE_MONEY' as const, preMoney: ['20000000', '25000000', '30000000'][index] as string }
          : { method: 'ARR_MULTIPLE' as const, arr: '12000000', multiple: ['4', '5', '6'][index] as string },
      bridge: type === 'VENTURE_RAISE' ? { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' } : bridge,
      stockConsiderationShare: '0',
      // Accepted priced risks move each case: the downside takes their high price, the upside their low.
      findingLinks: pricedFindingIds.map((findingId) => ({ findingId, point: (['HIGH', 'MID', 'LOW'] as const)[index] as 'LOW' | 'MID' | 'HIGH' })),
      balanceSheetLinks: [] as string[],
      lbo: null,
      accretionDilution: null,
      sensitivity: null,
    },
  }));
}

/** The schema owner's session: a pg client when deployed, PGlite in tests. */
export interface OwnerSession {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The organization, its three people and their memberships, as the schema owner. Idempotent. */
export async function ensureDemoOrganization(owner: OwnerSession, spec: DemoOrgSpec = DEMO_ORG): Promise<void> {
  const other = await owner.query<{ id: string }>(`SELECT id FROM organizations WHERE slug = $1 AND id <> $2`, [spec.slug, spec.id]);
  if (other.rows.length > 0) throw new Error(`Another organization already uses the slug ${spec.slug}; refusing to touch it.`);
  await owner.query(
    `INSERT INTO organizations (id, name, slug, auth_method, status, created_via, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', 'ACTIVE', 'DEMO', now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'ACTIVE'`,
    [spec.id, spec.name, spec.slug],
  );
  for (const person of [spec.buyer, spec.seller]) {
    await owner.query(
      `INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email`,
      [person.id, `pactlab|${person.id}`, person.name, person.email],
    );
  }
  await owner.query(`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [spec.reviewer.id, `pactlab|${spec.reviewer.id}`, spec.reviewer.name]);
  await owner.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_OWNER'), ($4, $2, $5, 'MEMBER')
     ON CONFLICT DO NOTHING`,
    [newId(), spec.id, spec.buyer.id, newId(), spec.reviewer.id],
  );
}

/** The seller (a guest) and the reviewer on a pact. */
async function addPactPeople(owner: OwnerSession, spec: DemoOrgSpec, dealId: string): Promise<void> {
  await owner.query(
    `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'TARGET_CONTRIBUTOR'), ($5, $2, $3, $6, 'REVIEWER')
     ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`,
    [newId(), spec.id, dealId, spec.seller.id, newId(), spec.reviewer.id],
  );
}

/** Where a pack's demo files come from: the pinned GitHub commit when deployed, a generated folder in tests. Paths are under `<pack>/USD/`. */
export interface DemoDataSource {
  file(type: CompanyType, path: string): Promise<Buffer>;
  /** The file names in `documents/`. */
  documents(type: CompanyType): Promise<string[]>;
}

/** The public demo data at the pinned commit, over HTTPS (raw files, and the contents API for listings). */
export const githubDemoData: DemoDataSource = {
  async file(type, path) {
    const url = demoDataUrl(type, path);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Demo data not found: ${path} (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  },
  async documents(type) {
    const url = `https://api.github.com/repos/kuramach/pactlab-demo-data/contents/${packFor(type).slug}/USD/documents?ref=${DEMO_DATA_COMMIT}`;
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Demo document list not found (${response.status})`);
    return ((await response.json()) as { name: string; type: string }[]).filter((entry) => entry.type === 'file').map((entry) => entry.name);
  },
};

type App = Awaited<ReturnType<typeof createApp>>;
interface People {
  readonly buyer: TenantContext;
  readonly seller: TenantContext;
  readonly reviewer: TenantContext;
}

/** One complete buyer-led pact for a pack, from data room to funds confirmed. Returns a line for the report. */
export async function buildPact(app: App, owner: OwnerSession, people: People, type: CompanyType, data: DemoDataSource, options: { closed?: boolean; spec?: DemoOrgSpec } = {}): Promise<string> {
  const spec = options.spec ?? DEMO_ORG;
  const pacts = app.get(PactsService, { strict: false });
  const documents = app.get(DocumentsService, { strict: false });
  const findings = app.get(FindingsService, { strict: false });
  const valuation = app.get(ValuationService, { strict: false });
  const pricing = app.get(PricingService, { strict: false });
  const close = app.get(CloseService, { strict: false });
  const name = pactName(type, options.closed === true);
  const done: string[] = [];
  // Each extra step reports what it did; one that fails says why and leaves the rest of the pact standing.
  const step = async (label: string, run: () => Promise<string>) => {
    try {
      done.push(await run());
    } catch (error) {
      done.push(`${label} FAILED (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  };

  const started = await pacts.start(
    people.buyer,
    {
      name,
      baseCurrency: 'USD',
      initiatedBy: 'BUYER',
      buyer: { name: 'Demo Capital (synthetic)', ownership: 'PRIVATE', ticker: null, exchange: null, website: null, companyType: null },
      seller: { name: `${LABELS[type]} Target (synthetic)`, ownership: 'PRIVATE', ticker: null, exchange: null, website: null, companyType: type },
      askingPrice: demoAskingPrice(type),
      linkedSale: null,
      persona: 'VALUE_INVESTOR',
    },
    REQUEST_ID,
  );
  const dealId = started.id;
  await addPactPeople(owner, spec, dealId);
  const scoped = (person: TenantContext): TenantContext => ({ ...person, dealIds: [...person.dealIds, dealId as never] });
  const buyer = scoped(people.buyer);
  const seller = scoped(people.seller);
  const reviewer = scoped(people.reviewer);
  // Screening first: its verdict moves the pact out of SCREENING.
  await step('screening', () => screen(app, buyer, dealId, type));
  await step('team', () => team(owner, spec.id, dealId, spec.analyst));

  // The data room: one zip, unpacked and sorted by the intake; shared so the seller sees the documents too.
  const zip = await data.file(type, 'dataroom.zip');
  await documents.uploadArchive(buyer, dealId, { fileName: 'dataroom.zip', contentBase64: zip.toString('base64'), retentionClass: 'DEAL_TERM', dataClass: 'BUSINESS', aiExcluded: false, shared: true }, REQUEST_ID);

  // The pack's extracts through the import pipeline (metrics, and the checks that run on import), as the pack acceptance tests load them.
  const imports = app.get(ImportsService, { strict: false });
  for (const target of packFor(type).importTargets) {
    const fileName = IMPORT_TARGET_DEFINITIONS[target].fileName;
    const query = uploadQuerySchema.parse({ system: 'pactlab_standard', fileName, ...(target === 'BILLING_INVOICE_LINE' ? {} : { target }) });
    const upload = await imports.upload(buyer, dealId, query, new Uint8Array(await data.file(type, fileName)), REQUEST_ID);
    await imports.import(buyer, dealId, upload.id, upload.suggestedMapping as never, REQUEST_ID);
  }
  // The paged documents some checks cite (PDFs, with the extracts' paged copy kept to the financial class).
  for (const file of (await data.documents(type)).filter((name) => name.endsWith('.pdf'))) {
    const pdf = await data.file(type, `documents/${file}`);
    await documents.upload(buyer, dealId, { fileName: file, contentType: 'application/pdf', contentBase64: pdf.toString('base64'), retentionClass: 'DEAL_TERM', dataClass: file.startsWith('99-') ? 'FINANCIAL' : 'BUSINESS', aiExcluded: false, shared: !file.startsWith('99-') }, REQUEST_ID);
  }

  await step('sources', () => connectSources(app, buyer, dealId, type));

  // Pack rules draft findings from the imported extracts; the lead submits them and a second person accepts.
  await findings.runPackRules(buyer, dealId, REQUEST_ID).catch(() => undefined);
  // Up to five accepted; the next asks for more support and the one after is rejected, so the register shows every outcome.
  const drafts = (await findings.list(buyer, dealId, { status: 'DRAFT' }, REQUEST_ID)).items.slice(0, 7);
  let accepted = 0;
  let decided = 0;
  const pricedIds: string[] = [];
  for (const draft of drafts) {
    try {
      let version = draft.version;
      // A drag needs a price before it can be accepted; the reviewer's range here is synthetic, staggered per finding.
      if (draft.direction === -1 && !draft.pricedRisk) {
        const low = 150_000 * (accepted + 1);
        const priced = await findings.update(buyer, dealId, draft.id, { expectedVersion: version, pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: `${low}.00`, high: `${low * 2}.00`, basis: 'Reviewer estimate from the data room (synthetic demo).' } } as never, REQUEST_ID);
        version = (priced as { version: number }).version;
      }
      const submitted = await findings.review(buyer, dealId, draft.id, { expectedVersion: version, decision: 'SUBMITTED', rationale: 'Evidence checked (synthetic demo).' }, REQUEST_ID);
      decided += 1;
      if (decided === 6) {
        await findings.review(reviewer, dealId, draft.id, { expectedVersion: submitted.finding.version, decision: 'SUPPORT_REQUESTED', rationale: 'Please add the source schedule behind this figure (synthetic demo).' }, REQUEST_ID);
        continue;
      }
      if (decided === 7) {
        await findings.review(reviewer, dealId, draft.id, { expectedVersion: submitted.finding.version, decision: 'REJECTED', rationale: 'Explained by a one-off already in the price (synthetic demo).' }, REQUEST_ID);
        continue;
      }
      await findings.review(reviewer, dealId, draft.id, { expectedVersion: submitted.finding.version, decision: 'ACCEPTED', rationale: 'Confirmed against the data room (synthetic demo).' }, REQUEST_ID);
      accepted += 1;
      // Only priced risks move a price; value confirmations are shown without a link.
      if (draft.direction === -1) pricedIds.push(draft.id);
    } catch {
      // A draft that needs more than this demo provides stays a draft for the viewer to review.
    }
  }

  await step('claims', () => claims(app, buyer, dealId, pricedIds));
  await step('finances', () => finances(app, buyer, dealId));
  await step('regulatory', () => regulatory(app, buyer, dealId));

  // Scenarios tagged for the personas, then a persona evaluation and the active pricing.
  for (const scenario of scenarios(type, pricedIds)) await valuation.create(buyer, dealId, scenario, REQUEST_ID);
  if (type === 'VENTURE_RAISE') {
    await step('raise', () => raise(app, buyer, dealId));
    return `${name}: data room, ${accepted} findings accepted, scenarios (a raise has no buyer terms); ${done.join('; ')}`;
  }
  await step('sextant', () => sextant(app, buyer, dealId));
  await pricing.evaluate(buyer, dealId, { persona: 'VALUE_INVESTOR' }, REQUEST_ID);

  // Terms: proposed, the price countered by the seller, revised, then accepted in full.
  const drafted = await pricing.draftTerms(buyer, dealId, REQUEST_ID);
  const v1 = drafted.batches[0];
  if (!v1) return `${name}: terms could not be drafted`;
  await pricing.propose(buyer, dealId, v1.id, REQUEST_ID);
  const price = v1.terms[0];
  const counter: string | null = price ? new D(price.amount).times('1.04').toDecimalPlaces(2).toFixed(2) : null;
  await pricing.respond(
    seller,
    dealId,
    { responses: v1.terms.map((term) => (term.ordinal === 0 && counter ? { ordinal: 0, decision: 'COUNTER' as const, counterAmount: counter, note: 'Our floor, given the occupancy trend.' } : { ordinal: term.ordinal, decision: 'ACCEPT' as const, note: '' })) },
    REQUEST_ID,
  );
  const v2 = (await pricing.acceptCounters(buyer, dealId, v1.id, REQUEST_ID)) as { batches: { id: string; terms: { ordinal: number }[] }[] };
  const next = v2.batches[0];
  if (!next) return `${name}: counter could not be taken into a new version`;
  await pricing.propose(buyer, dealId, next.id, REQUEST_ID);
  await pricing.respond(seller, dealId, { responses: next.terms.map((term) => ({ ordinal: term.ordinal, decision: 'ACCEPT' as const, note: '' })) }, REQUEST_ID);

  // Both signatories sign off in Pactlab, and the closing checklist is worked to the end.
  await close.nameSignatory(buyer, dealId, 'BUYER', { userId: spec.buyer.id }, REQUEST_ID);
  await close.nameSignatory(seller, dealId, 'SELLER', { userId: spec.seller.id }, REQUEST_ID);
  await close.signOff(buyer, dealId, next.id, REQUEST_ID);
  await close.signOff(seller, dealId, next.id, REQUEST_ID);
  await close.addItem(seller, dealId, { kind: 'CONDITION', title: 'Third-party consents delivered (synthetic)', ownerSide: 'SELLER' }, REQUEST_ID);
  const agreedPrice = counter ?? price?.amount ?? '1.00';
  await step('financing', () => demoFinancing(app, buyer, seller, dealId, agreedPrice));
  const withFunds = await close.addItem(buyer, dealId, { kind: 'FUNDS', title: 'Purchase price at completion', amount: agreedPrice, currency: 'USD' }, REQUEST_ID);
  const funds = withFunds.items.find((item) => item.kind === 'FUNDS');
  const condition = withFunds.items.find((item) => item.kind === 'CONDITION');
  if (funds) {
    await close.recordPayment(buyer, dealId, funds.id, { paidOn: new Date().toISOString().slice(0, 10), reference: 'WIRE-DEMO-001 (synthetic)', proofDocumentId: null }, REQUEST_ID);
    await close.tick(seller, dealId, funds.id, REQUEST_ID);
  }
  if (condition) await close.tick(seller, dealId, condition.id, REQUEST_ID);
  if (options.closed) {
    await step('close', () => closeAndPostClose(app, people, dealId));
    return `${name}: data room, ${accepted} findings accepted, scenarios, persona pricing, terms agreed, both signed, funds confirmed; ${done.join('; ')}`;
  }
  return `${name}: data room, ${accepted} findings accepted, scenarios, persona pricing, terms countered and agreed, both signed, funds confirmed (ready to close); ${done.join('; ')}`;
}

/** A one-page synthetic PDF: what a lender letter looks like to the upload checks. */
const demoPdf = (title: string) => Buffer.from(`%PDF-1.4\n% ${title} (synthetic demo)\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`).toString('base64');

/**
 * Buyer financing on a demo pact (T-117): equity and a committed loan covering the agreed price, the
 * letters behind both shared with the seller, and earnest money deposited, confirmed and applied at close.
 */
async function demoFinancing(app: App, buyer: TenantContext, seller: TenantContext, dealId: string, agreedPrice: string): Promise<string> {
  const financing = app.get(FinancingService, { strict: false });
  const equity = new D(agreedPrice).times('0.3').toDecimalPlaces(2).toFixed(2);
  const loan = new D(agreedPrice).minus(equity).toFixed(2);
  await financing.updatePlan(buyer, dealId, { commitmentExpectedBy: null, buyerNote: 'Lender relationship manager: synthetic contact (buyer-only).' }, REQUEST_ID);
  await financing.addTranche(buyer, dealId, { kind: 'CASH', amount: equity, currency: 'USD', status: 'PRE_QUALIFIED', label: 'Fund equity', buyerNote: 'Drawn from the fund’s committed capital (buyer-only).' }, REQUEST_ID);
  const withLoan = await financing.addTranche(buyer, dealId, { kind: 'CONVENTIONAL_DEBT', amount: loan, currency: 'USD', status: 'COMMITMENT_ISSUED', label: 'Senior term loan', buyerNote: 'Synthetic Bank, 5-year term (buyer-only).' }, REQUEST_ID);
  const tranches = withLoan.plans[0]?.tranches ?? [];
  for (const [purpose, kind, fileName] of [
    ['PROOF_OF_FUNDS', 'CASH', 'proof-of-funds.pdf'],
    ['COMMITMENT_LETTER', 'CONVENTIONAL_DEBT', 'lender-commitment-letter.pdf'],
  ] as const) {
    const tranche = tranches.find((entry) => entry.kind === kind);
    await financing.attach(buyer, dealId, { purpose, trancheId: tranche?.id ?? null, fileName, contentType: 'application/pdf', contentBase64: demoPdf(fileName) }, REQUEST_ID);
  }
  // A private statement the seller never sees, next to the two shared letters.
  const attached = await financing.attach(buyer, dealId, { purpose: 'BUYER_FINANCIALS', trancheId: null, fileName: 'fund-financial-statements.pdf', contentType: 'application/pdf', contentBase64: demoPdf('fund statements') }, REQUEST_ID);
  for (const document of attached.plans[0]?.documents ?? []) if (document.purpose !== 'BUYER_FINANCIALS') await financing.share(buyer, dealId, document.id, true, REQUEST_ID);
  const earnest = new D(agreedPrice).times('0.02').toDecimalPlaces(0).toFixed(2);
  await financing.setEscrow(buyer, dealId, { amount: earnest, currency: 'USD', holderKind: 'TITLE_COMPANY', holderName: 'Synthetic Title & Escrow Co.', depositDueOn: null, hardOn: null, refundConditions: 'Refundable if confirmatory diligence fails (synthetic).' }, REQUEST_ID);
  const receipt = await financing.attach(buyer, dealId, { purpose: 'ESCROW_RECEIPT', trancheId: null, fileName: 'escrow-receipt.pdf', contentType: 'application/pdf', contentBase64: demoPdf('escrow receipt') }, REQUEST_ID);
  const receiptId = receipt.plans[0]?.documents.find((document) => document.fileName === 'escrow-receipt.pdf')?.id ?? null;
  if (receiptId) await financing.share(buyer, dealId, receiptId, true, REQUEST_ID);
  const deposited = await financing.recordDeposit(buyer, dealId, { depositedOn: new Date().toISOString().slice(0, 10), reference: 'ESCROW-DEMO-001 (synthetic)', proofDocumentId: receiptId }, REQUEST_ID);
  const planId = deposited.plans[0]?.id;
  if (planId) {
    await financing.confirmDeposit(seller, dealId, planId, REQUEST_ID);
    await financing.disposition(seller, dealId, planId, 'APPLIED_AT_CLOSE', REQUEST_ID);
  }
  return 'financing: equity and a committed loan with shared letters, earnest money applied at close';
}

/** One seller-led Multifamily pact with a published teaser and its property facts. */
export async function buildTeaser(app: App, people: People): Promise<{ line: string; dealId: string }> {
  const pacts = app.get(PactsService, { strict: false });
  const listings = app.get(ListingsService, { strict: false });
  const started = await pacts.start(
    people.buyer,
    {
      name: SELLER_LED,
      baseCurrency: 'USD',
      initiatedBy: 'SELLER',
      buyer: null,
      seller: { name: 'Larkfield Residential (synthetic)', ownership: 'PRIVATE', ticker: null, exchange: null, website: null, companyType: 'MULTIFAMILY' },
      askingPrice: null,
      linkedSale: null,
      persona: null,
    },
    REQUEST_ID,
  );
  const lead = { ...people.buyer, dealIds: [...people.buyer.dealIds, started.id as never] };
  await listings.save(
    lead,
    started.id,
    {
      visibility: 'ANONYMOUS',
      codename: 'Project Larkfield',
      publicName: null,
      headline: '96-unit garden-style apartment community, Midwest (synthetic)',
      sector: 'Multifamily',
      region: 'Midwest, United States',
      sizeBand: '90–100 units',
      askingLow: '14000000',
      askingHigh: '16000000',
      askingCurrency: 'USD',
      summary: 'A stabilised garden-style community in three buildings. Synthetic demo listing: every name and figure is invented.',
      highlights: ['94% occupancy over twelve months', 'Value-add on unit interiors', 'Long-tenured on-site team'],
      indexable: false,
    },
    REQUEST_ID,
  );
  const proposals = await listings.lookupProperty(lead, started.id, { address: '1200 Larkfield Commons Dr, Columbus, OH 43215', country: 'US' }, REQUEST_ID);
  await listings.saveProperty(lead, started.id, { address: proposals.formattedAddress, facts: proposals.facts }, REQUEST_ID);
  await listings.setStatus(lead, started.id, { status: 'PUBLISHED' }, REQUEST_ID);
  return { line: `${SELLER_LED}: published teaser with property facts`, dealId: started.id };
}

/** Creates the organization, then whatever pacts are missing (all of them after `reset`). Returns the report lines. */
export async function runDemoOrg(
  app: App,
  owner: OwnerSession,
  prisma: PrismaClient,
  options: { types: readonly CompanyType[]; reset: boolean; data: DemoDataSource; spec?: DemoOrgSpec },
): Promise<string[]> {
  const { types, reset } = options;
  const spec = options.spec ?? DEMO_ORG;
  const report: string[] = [];
  await ensureDemoOrganization(owner, spec);
  const principal = (id: string) => resolvePrincipal(prisma, { subject: `pactlab|${id}`, externalOrganizationId: spec.id, issuer: 'PACTLAB' });
  const existing = await owner.query<{ id: string; name: string }>(`SELECT id, name FROM deals WHERE organization_id = $1 AND status <> 'DELETED'`, [spec.id]);
  if (reset && existing.rows.length > 0) {
    const lead = await principal(spec.buyer.id);
    if (!lead) throw new Error('The demo buyer cannot be resolved.');
    const deletion = app.get(DealDeletionService, { strict: false });
    for (const deal of existing.rows) await deletion.delete({ ...lead, dealIds: [...lead.dealIds, deal.id as never] }, deal.id, deal.name, REQUEST_ID);
    report.push(`reset: ${existing.rows.length} demo pacts deleted`);
  }
  if (reset) {
    // What a visitor may change outside the pacts goes back too: entered comparables (retired, then re-entered below) and organization settings.
    await owner.query(`UPDATE comparables SET status = 'RETIRED', retired_at = now(), retired_by = $2 WHERE organization_id = $1 AND origin = 'ENTERED' AND status = 'ACTIVE'`, [spec.id, spec.buyer.id]);
    await owner.query(`UPDATE organizations SET default_persona = NULL, trusted_session_max_hours = 168, updated_at = now() WHERE id = $1`, [spec.id]);
  }
  const have = new Set(reset ? [] : existing.rows.map((row) => row.name));
  // Entered comparables first, so every benchmark (and Sextant's anchors) has them.
  const owning = await principal(spec.buyer.id);
  if (owning) report.push(await enteredComparables(app, owning, types));
  for (const type of types) {
    for (const closed of pactVariants(type)) {
      const name = pactName(type, closed);
      if (have.has(name)) {
        report.push(`${name}: already present`);
        continue;
      }
      const [buyer, seller, reviewer] = await Promise.all([principal(spec.buyer.id), principal(spec.seller.id), principal(spec.reviewer.id)]);
      if (!buyer || !reviewer) throw new Error('The demo people cannot be resolved.');
      // Before the first pact the seller is on nothing yet; a guest context resolves once they are.
      const sellerContext = seller ?? { organizationId: spec.id, userId: spec.seller.id, organizationRole: 'GUEST', dealIds: [] };
      try {
        report.push(await buildPact(app, owner, { buyer, seller: sellerContext as TenantContext, reviewer }, type, options.data, { closed, spec }));
      } catch (error) {
        report.push(`${name}: FAILED (${error instanceof Error ? error.message : 'unknown error'})`);
      }
    }
  }
  if (!have.has(SELLER_LED) && types.includes('MULTIFAMILY')) {
    const buyer = await principal(spec.buyer.id);
    if (buyer) {
      try {
        const teaser = await buildTeaser(app, { buyer, seller: buyer, reviewer: buyer });
        report.push(teaser.line);
        report.push(await bidProcess(app, owner, buyer, teaser.dealId, spec.bidders, (userId) => principal(userId)).catch((error: unknown) => `bid process FAILED (${error instanceof Error ? error.message : 'unknown error'})`));
      } catch (error) {
        report.push(`${SELLER_LED}: FAILED (${error instanceof Error ? error.message : 'unknown error'})`);
      }
    }
  }
  // Reports last, so they hold the finished pacts.
  const lead = await principal(spec.buyer.id);
  if (lead && report.some((line) => !line.endsWith('already present'))) {
    const main = (await owner.query<{ id: string }>(`SELECT id FROM deals WHERE organization_id = $1 AND name = $2 AND status <> 'DELETED'`, [spec.id, pactName(types[0] ?? 'SOFTWARE_SAAS')])).rows[0];
    report.push(await reports(app, lead, main?.id ?? null).catch((error: unknown) => `reports FAILED (${error instanceof Error ? error.message : 'unknown error'})`));
  }
  // Foresight prepares itself the first time each pact's tab is opened.
  return report;
}

/** What a deployed demo run needs: the app wired for demos, the owner session and the packs to build. Shared with demo-pool.ts. */
export async function openDemoRuntime(): Promise<{ app: App; owner: pg.Client; prisma: PrismaClient; types: CompanyType[]; environment: string; close: () => Promise<void> }> {
  applyDatabaseUrls();
  const config = loadConfig(apiEnvSchema);
  const ownerUrl = process.env['DATABASE_MIGRATION_URL'];
  if (!ownerUrl) throw new Error('DATABASE_MIGRATION_URL is required (the schema owner creates the demo organization).');
  const objectStore =
    config.APP_ENV === 'local' && config.DOCUMENT_STORE_DIR
      ? new FileSystemObjectStore(config.DOCUMENT_STORE_DIR)
      : config.DOCUMENT_STORE === 's3' && config.DOCUMENT_BUCKET && config.DOCUMENT_KMS_KEY_ID
        ? new S3ObjectStore(new S3Client({ region: config.AWS_REGION }), config.DOCUMENT_BUCKET, config.DOCUMENT_KMS_KEY_ID)
        : null;
  if (!objectStore) throw new Error('The demo organization needs the document store (DOCUMENT_STORE_DIR locally, or the S3 store when deployed).');

  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
  const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
  // Every pack outside production; the released ones on live.
  const types = COMPANY_TYPES.filter((type) => type !== 'OTHER' && (config.APP_ENV !== 'production' || isReleasedCompanyType(type)));
  const app = await createApp({
    prisma,
    identityVerifier: new DisabledIdentityVerifier(),
    logger: createLogger('demo-org', { level: 'warn' }),
    uploads: { objectStore, malwareScanner: new SignatureMalwareScanner(), importQueue: null },
    documents: {
      objectStore,
      malwareScanner: new SignatureMalwareScanner(),
      gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }),
    },
    // The demo pacts may use packs not yet released here; the script, not the environment, decides which.
    packPreview: true,
    property: new FixturePropertyProvider(),
    signing: { fixture: false, docusign: null },
  });
  return {
    app,
    owner,
    prisma,
    types,
    environment: config.APP_ENV,
    close: async () => {
      await app.close();
      await owner.end();
    },
  };
}

/** The run: environment checks, then the organization, then whatever pacts are missing. */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const runtime = await openDemoRuntime();
  let report: string[];
  try {
    report = await runDemoOrg(runtime.app, runtime.owner, runtime.prisma, { types: runtime.types, reset, data: githubDemoData });
  } finally {
    await runtime.close();
  }
  process.stdout.write(`Demo organization "${DEMO_ORG.name}" (${runtime.environment}): sign in as ${DEMO_ORG.buyer.email} (buyer) or ${DEMO_ORG.seller.email} (seller).\n${report.map((line) => ` - ${line}`).join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
