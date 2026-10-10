import type { INestApplicationContext } from '@nestjs/common';
import { neutralizeMarkup, type ModelRequest } from '@pactlab/ai';
import { deals, resolvePrincipal, withTenant, type PrismaClient } from '@pactlab/db';
import type { AskingPriceInput } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { DocumentsService } from '../documents/documents.service';
import { FindingsService } from '../findings/findings.service';
import { PactsService } from '../pacts/pacts.service';
import { ValuationService } from '../valuation/valuation.service';
import { DEMO_CONTRACTS, type SyntheticContract } from './contracts';

const REQUEST_ID = 'demo-seed';
const SYNTHETIC = '(synthetic demo data)';

/** Who acts in each synthetic buyer organization: a deal lead and a second-person reviewer. */
export const DEMO_HOLDERS = [
  {
    label: 'Alpha',
    organizationId: '01900000-0000-7000-8000-00000000a001',
    lead: {
      userId: '01900000-0000-7000-8000-00000000a002',
      subject: 'auth0|synthetic-alpha-lead',
      externalOrganizationId: 'org_synthetic_alpha',
      issuer: 'AUTH0' as const,
    },
    reviewer: {
      userId: '01900000-0000-7000-8000-00000000a005',
      subject: 'auth0|synthetic-alpha-reviewer',
      externalOrganizationId: 'org_synthetic_alpha',
      issuer: 'AUTH0' as const,
    },
  },
  {
    label: 'Charlie',
    organizationId: '01900000-0000-7000-8000-00000000c001',
    lead: {
      userId: '01900000-0000-7000-8000-00000000c002',
      subject: 'pactlab|01900000-0000-7000-8000-00000000c002',
      externalOrganizationId: '01900000-0000-7000-8000-00000000c001',
      issuer: 'PACTLAB' as const,
    },
    reviewer: {
      userId: '01900000-0000-7000-8000-00000000c004',
      subject: 'pactlab|01900000-0000-7000-8000-00000000c004',
      externalOrganizationId: '01900000-0000-7000-8000-00000000c001',
      issuer: 'PACTLAB' as const,
    },
  },
] as const;

type DealName = keyof typeof DEMO_CONTRACTS;

/** Citation id of the source block containing a quote, as the prompt rendered it. */
function citationIdFor(request: ModelRequest, quote: string): string | null {
  const prompt = request.messages[0]?.content ?? '';
  for (const block of prompt.split('<untrusted_source ').slice(1)) {
    if (block.includes(neutralizeMarkup(quote))) return /citation_id="([^"]+)"/.exec(block)?.[1] ?? null;
  }
  return null;
}

/**
 * Scripted model responses for the demo contracts: the extraction a model
 * would propose, cited to the exact text. Runs are recorded under the model
 * id `synthetic-fixture`, never as a real model.
 */
export function demoModelResponse(request: ModelRequest): string {
  const all = Object.values(DEMO_CONTRACTS).flat();
  const contract = all.find((entry) => entry.extraction && citationIdFor(request, entry.extraction.parties[0]?.quote ?? '\u0000'));
  const extraction = contract?.extraction;
  if (!extraction) return JSON.stringify({ parties: [], dates: [], clauses: [] });
  const cite = (quote: string) => [{ citationId: citationIdFor(request, quote) ?? '', quote }];
  return JSON.stringify({
    parties: extraction.parties.map((party) => ({ name: party.name, role: party.role, citations: cite(party.quote) })),
    dates: extraction.dates.map((date) => ({ kind: date.kind, date: date.date, citations: cite(date.quote) })),
    clauses: extraction.clauses.map((clause) => ({
      kind: clause.kind,
      summary: clause.summary,
      severity: clause.severity,
      citations: cite(clause.quote),
    })),
  });
}

interface Actors {
  readonly lead: TenantContext;
  readonly reviewer: TenantContext;
}

/** Where a local database has re-linked the synthetic identities to real sign-in accounts. */
export interface DemoIdentityLinks {
  /** Auth0 organization id by organization id. */
  readonly externalOrganizationIds?: Readonly<Record<string, string>>;
  /** Sign-in subject by user id. */
  readonly subjects?: Readonly<Record<string, string>>;
}

async function actors(prisma: PrismaClient, holder: (typeof DEMO_HOLDERS)[number], links: DemoIdentityLinks): Promise<Actors | null> {
  const claims = (who: { userId: string; subject: string; externalOrganizationId: string; issuer: 'AUTH0' | 'PACTLAB' }) => ({
    subject: links.subjects?.[who.userId] ?? who.subject,
    externalOrganizationId: links.externalOrganizationIds?.[holder.organizationId] ?? who.externalOrganizationId,
    issuer: who.issuer,
  });
  const lead = await resolvePrincipal(prisma, claims(holder.lead));
  const reviewer = await resolvePrincipal(prisma, claims(holder.reviewer));
  return lead && reviewer ? { lead, reviewer } : null;
}

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/**
 * Synthetic decision-loop data for the app: findings at every review stage
 * with priced risks, valuation scenarios (draft, run, submitted and approved
 * by a second person) and contracts with cited AI drafts. Everything goes
 * through the real services — permissions, audit and validation included —
 * and re-running changes nothing.
 */
export async function seedDemo(
  app: INestApplicationContext,
  prisma: PrismaClient,
  links: DemoIdentityLinks = {},
): Promise<string[]> {
  const findingsService = app.get(FindingsService, { strict: false });
  const valuation = app.get(ValuationService, { strict: false });
  const documents = app.get(DocumentsService, { strict: false });
  const pacts = app.get(PactsService, { strict: false });
  const report: string[] = [];

  for (const holder of DEMO_HOLDERS) {
    const who = await actors(prisma, holder, links);
    if (!who) {
      report.push(`${holder.label}: synthetic users missing — run the database seed first`);
      continue;
    }
    const dealRows = await withTenant(prisma, who.lead, (tx) => deals.list(tx));
    const dealId = (name: DealName) => dealRows.find((deal) => deal.name === name)?.id;

    // --- Findings: one accepted with a priced risk, one waiting for review ---
    const troubled = dealId('Project Troubled');
    if (troubled) {
      const { items } = await findingsService.list(who.lead, troubled, {}, REQUEST_ID);
      const fresh = [];
      for (const finding of items) {
        const detail = await findingsService.get(who.lead, troubled, finding.id, REQUEST_ID);
        if (detail.reviews.length === 0 && finding.status === 'DRAFT' && finding.evidence.length > 0) fresh.push(finding);
      }
      const prices = [
        { type: 'ESCROW' as const, low: '150000', high: '300000', basis: `Remediation and re-attribution of unowned code ${SYNTHETIC}` },
        { type: 'PRICE_REDUCTION' as const, low: '80000', high: '200000', basis: `Retention packages for key contributors ${SYNTHETIC}` },
      ];
      for (const [index, finding] of fresh.slice(0, 2).entries()) {
        const price = prices[index];
        if (!price) break;
        const priced = await findingsService.update(
          who.lead,
          troubled,
          finding.id,
          { expectedVersion: finding.version, pricedRisk: { ...price, currency: 'USD' } },
          REQUEST_ID,
        );
        const submitted = await findingsService.review(
          who.lead,
          troubled,
          finding.id,
          { expectedVersion: priced.version, decision: 'SUBMITTED', rationale: `Evidence checked; ready for review ${SYNTHETIC}` },
          REQUEST_ID,
        );
        if (index === 0) {
          await findingsService.review(
            who.reviewer,
            troubled,
            finding.id,
            {
              expectedVersion: submitted.finding.version,
              decision: 'ACCEPTED',
              rationale: `Commit evidence supports the finding; escrow range agreed ${SYNTHETIC}`,
            },
            REQUEST_ID,
          );
        }
      }
      report.push(`${holder.label} · Project Troubled: ${fresh.length > 0 ? `${Math.min(fresh.length, 2)} findings priced and reviewed` : 'findings already reviewed'}`);
    }

    // --- Asking prices: what the seller wants, revised once on Troubled ---
    const askings: [DealName, AskingPriceInput[]][] = [
      ['Project Healthy', [{ amount: '2800000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'TEASER', quotedOn: '2026-08-20', earnOutAmount: null, note: `Cash-free, debt-free ${SYNTHETIC}` }]],
      [
        'Project Troubled',
        [
          { amount: '1500000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'LETTER_OF_INTENT', quotedOn: '2026-07-01', earnOutAmount: '250000', note: SYNTHETIC },
          { amount: '1350000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'MANAGEMENT', quotedOn: '2026-09-10', earnOutAmount: '250000', note: `Revised after code findings ${SYNTHETIC}` },
        ],
      ],
      ['Project Sparse', [{ amount: '900000', currency: 'USD', basis: 'EQUITY_VALUE', source: 'BANKER', quotedOn: '2026-09-25', earnOutAmount: null, note: SYNTHETIC }]],
    ];
    for (const [name, versions] of askings) {
      const id = dealId(name);
      if (!id) continue;
      // Only on a deal with no asking price yet, so re-running never adds versions.
      if ((await pacts.askingPrice(who.lead, id, REQUEST_ID)).history.length > 0) continue;
      for (const version of versions) await pacts.recordAskingPrice(who.lead, id, version, REQUEST_ID);
      report.push(`${holder.label} · ${name}: asking price recorded (${versions.length} version${versions.length > 1 ? 's' : ''})`);
    }

    // --- Valuation scenarios ---
    const scenario = async (
      name: DealName,
      scenarioName: string,
      values: Parameters<ValuationService['create']>[2]['values'],
      steps: { run: boolean; submitAndApprove: boolean },
    ) => {
      const id = dealId(name);
      if (!id) return;
      const existing = (await valuation.list(who.lead, id, REQUEST_ID)).items.find((view) => view.scenario.name === scenarioName);
      let view = existing ?? (await valuation.create(who.lead, id, { name: scenarioName, values }, REQUEST_ID));
      if (steps.run && !view.latestRun) {
        await valuation.run(who.lead, id, view.scenario.id, { expectedVersion: view.scenario.version }, REQUEST_ID);
        view = await valuation.get(who.lead, id, view.scenario.id, REQUEST_ID);
      }
      if (steps.submitAndApprove && view.scenario.status === 'DRAFT' && view.latestRun && !view.stale) {
        view = await valuation.submit(who.lead, id, view.scenario.id, { expectedVersion: view.scenario.version }, REQUEST_ID);
        const submission = view.submissions.at(-1);
        if (submission) {
          await valuation.decide(
            who.reviewer,
            id,
            view.scenario.id,
            submission.id,
            { expectedVersion: view.scenario.version, decision: 'APPROVED', rationale: `Inputs reconcile to billing evidence ${SYNTHETIC}` },
            REQUEST_ID,
          );
        }
      }
      report.push(`${holder.label} · ${name}: scenario “${scenarioName}” ${existing ? 'already present' : 'created'}`);
    };

    const bridge = (cash: string, debt: string, debtLike: string, workingCapital: string) => ({
      cash,
      debt,
      debtLikeItems: debtLike,
      workingCapitalAdjustment: workingCapital,
    });
    const defaults = { stockConsiderationShare: '0', lbo: null, accretionDilution: null, sensitivity: null } as const;

    await scenario(
      'Project Healthy',
      'Base case — ARR multiple',
      {
        ...defaults,
        assumptions: { method: 'ARR_MULTIPLE', arr: '402840', multiple: '6.5' },
        bridge: bridge('250000', '0', '40000', '-15000'),
        findingLinks: [],
        sensitivity: {
          rows: { variable: 'multiple', values: ['5.5', '6.5', '7.5'] },
          columns: { variable: 'arr', values: ['380000', '402840', '420000'] },
        },
      },
      { run: true, submitAndApprove: true },
    );

    const accepted = troubled
      ? (await findingsService.list(who.lead, troubled, { status: 'ACCEPTED' }, REQUEST_ID)).items.filter((finding) => finding.pricedRisk)
      : [];
    await scenario(
      'Project Troubled',
      'Base case — ARR multiple, risk-adjusted',
      {
        ...defaults,
        assumptions: { method: 'ARR_MULTIPLE', arr: '268000', multiple: '4' },
        bridge: bridge('90000', '120000', '35000', '-20000'),
        findingLinks: accepted.slice(0, 1).map((finding) => ({ findingId: finding.id, point: 'MID' as const })),
      },
      { run: true, submitAndApprove: false },
    );
    await scenario(
      'Project Troubled',
      'Downside — DCF',
      {
        ...defaults,
        assumptions: {
          method: 'DCF',
          baseRevenue: '268000',
          years: [
            { growth: '0.05', fcfMargin: '0.05' },
            { growth: '0.08', fcfMargin: '0.08' },
            { growth: '0.10', fcfMargin: '0.12' },
            { growth: '0.10', fcfMargin: '0.15' },
            { growth: '0.08', fcfMargin: '0.18' },
          ],
          discountRate: '0.14',
          terminal: { kind: 'GORDON', growth: '0.03' },
        },
        bridge: bridge('90000', '120000', '35000', '-20000'),
        findingLinks: [],
      },
      { run: true, submitAndApprove: false },
    );
    await scenario(
      'Project Sparse',
      'Early look — DCF',
      {
        ...defaults,
        assumptions: {
          method: 'DCF',
          baseRevenue: '150000',
          years: [
            { growth: '0.20', fcfMargin: '0' },
            { growth: '0.18', fcfMargin: '0.05' },
            { growth: '0.15', fcfMargin: '0.10' },
          ],
          discountRate: '0.18',
          terminal: { kind: 'EXIT_MULTIPLE', revenueMultiple: '3' },
        },
        bridge: bridge('40000', '0', '10000', '0'),
        findingLinks: [],
        // Take-private: the engine requires LBO returns inputs.
        lbo: { entryEbitda: '30000', leverageMultiple: '4', exitEbitda: '55000', exitMultiple: '9', holdYears: 5, debtRepaid: '60000' },
      },
      { run: false, submitAndApprove: false },
    );

    // --- Documents: contracts with cited AI drafts; one decided by the reviewer ---
    for (const [name, contracts] of Object.entries(DEMO_CONTRACTS) as [DealName, readonly SyntheticContract[]][]) {
      const id = dealId(name);
      if (!id) continue;
      const present = new Set((await documents.list(who.lead, id, REQUEST_ID)).items.map((doc) => doc.fileName));
      let uploaded = 0;
      for (const contract of contracts) {
        if (present.has(contract.fileName)) continue;
        const doc = (await documents.upload(
          who.lead,
          id,
          {
            fileName: contract.fileName,
            contentType: 'text/plain',
            contentBase64: base64(contract.text),
            retentionClass: 'DEAL_TERM',
            dataClass: 'BUSINESS',
            aiExcluded: false,
          },
          REQUEST_ID,
        )) as { id: string };
        uploaded += 1;
        if (contract.extraction) await documents.extract(who.lead, id, doc.id, REQUEST_ID);
      }
      if (name === 'Project Healthy' && uploaded > 0) {
        const drafts = (await documents.listFindings(who.lead, id, { status: 'DRAFT' }, REQUEST_ID)).items;
        const changeOfControl = drafts.find((finding) => /change of control/i.test(finding.title + finding.summary));
        if (changeOfControl) {
          await documents.review(
            who.reviewer,
            id,
            changeOfControl.id,
            { decision: 'ACCEPT', rationale: `Clause 3 read in full; termination right confirmed ${SYNTHETIC}`, expectedVersion: changeOfControl.version },
            REQUEST_ID,
          );
        }
      }
      report.push(`${holder.label} · ${name}: ${uploaded} contracts uploaded`);
    }
  }
  return report;
}
