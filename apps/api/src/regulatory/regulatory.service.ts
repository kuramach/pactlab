import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { quoteHash } from '@pactlab/ai';
import {
  buyerViability,
  certaintyStatus,
  cherryPick,
  coherence,
  gradeCommitment,
  headroom,
  incoherentPackage,
  laborExposure,
  localConcentration,
  overlapPockets,
  unaddressedFeedback,
  unverifiablePledges,
  type Commitment,
  type DealCertaintyTerms,
  type FeedbackRound,
  type PackageRevision,
  type RegFinding,
  type RemedyBuyer,
  type RemedyPackage,
  type Site,
} from '@pactlab/calculations';
import type { CreateRegulatoryEntry } from '@pactlab/contracts';
import { appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  canDraftFindings,
  isCounterpartyRole,
  newId,
  packFor,
  permissionsForDealRole,
  regulatoryProfile,
  type CompanyType,
  type DealRole,
  type DocumentCitation,
  type FindingEvidenceLink,
  type FindingSeverity,
  type ProposedFinding,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FindingsService } from '../findings/findings.service';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';

/** Buyer-side analysis: read with analysis access, write with deal write; never a counterparty. */
const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ') && !isCounterpartyRole(role);
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && !isCounterpartyRole(role);

const SITE = 'regulatory.site';
const PACKAGE_SITE = 'regulatory.remedy_site';
const TOOL = 'regulatory-checks';
const TOOL_VERSION = '1';
const MAX_LINKS = 5;

export type ClearanceBand = 'GO' | 'GO_WITH_REMEDY_PRICED' | 'NO_GO';

interface Entry {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly citation: DocumentCitation;
  readonly createdAt: Date;
}

const yes = (value: string | null | undefined) => (value ?? '').toLowerCase() === 'yes';

/**
 * Regulatory & deal certainty (T-091). Reads the deal's footprint and remedy
 * package (imported evidence) and its cited regulatory entries; runs the
 * deterministic checks; and, on request, records their results as DRAFT
 * findings that cite that evidence — reviewed and priced by people, like any
 * other finding. Risk surfacing, never a prediction or legal advice.
 */
@Injectable()
export class RegulatoryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FindingsService) private readonly findings: FindingsService,
  ) {}

  /** Add a cited entry. The quote must be on the cited page of an available document. */
  async addEntry(tenant: TenantContext, dealId: string, body: CreateRegulatoryEntry, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'regulatory.entry.added', requestId });
    const id = newId();
    await withTenant(this.prisma, tenant, async (tx) => {
      const page = await tx.documentPage.findFirst({
        where: { dealId, documentId: body.citation.documentId, pageNumber: body.citation.pageNumber, document: { status: 'AVAILABLE' } },
        select: { text: true },
      });
      const start = page?.text ? page.text.indexOf(body.citation.quote) : -1;
      if (start < 0) throw new UnprocessableEntityException({ code: 'CITATION_NOT_ON_PAGE' });
      const citation: DocumentCitation = { ...body.citation, quoteHash: quoteHash(body.citation.quote), charStart: start, charEnd: start + body.citation.quote.length };
      await tx.regulatoryEntry.create({ data: { id, organizationId: tenant.organizationId, dealId, kind: body.kind, payload: body.payload, citation: { ...citation }, createdBy: tenant.userId } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'regulatory.entry.added', targetType: 'regulatory_entry', targetId: id, outcome: 'SUCCEEDED', requestId });
    });
    return { id };
  }

  private async load(tx: TransactionClient, dealId: string) {
    const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } });
    const pack = packFor((seller?.companyType ?? null) as CompanyType | null);
    let evidence;
    try {
      evidence = await loadPackEvidence(tx, dealId, [SITE, PACKAGE_SITE]);
    } catch (error) {
      if (error instanceof TooMuchPackEvidenceError) throw new PayloadTooLargeException('Too much evidence for one regulatory run');
      throw error;
    }
    const entries: Entry[] = (await tx.regulatoryEntry.findMany({ where: { dealId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: row.payload,
      citation: row.citation as unknown as DocumentCitation,
      createdAt: row.createdAt,
    }));
    return { pack, evidence, entries };
  }

  /** Everything the checks need, assembled from evidence and entries — and where each piece came from. */
  private assemble(evidence: Awaited<ReturnType<typeof loadPackEvidence>>, entries: readonly Entry[]) {
    const siteRows = evidence.filter((row) => row.evidenceType === SITE);
    const siteEvidence = new Map(siteRows.map((row) => [row.canonical['site_id'] ?? '', row.id]));
    const sites: Site[] = siteRows.map((row) => {
      const c = row.canonical;
      return {
        siteId: c['site_id'] ?? '',
        party: ((c['party'] ?? 'RIVAL').toUpperCase() as Site['party']),
        firm: c['firm'] ?? '',
        market: c['market'] ?? '',
        region: c['region'] ?? '',
        banner: c['banner'] ?? '',
        fullService: yes(c['full_service']),
        sales: c['sales'] ?? '0',
        performance: c['performance'] ?? '0',
        unionized: yes(c['unionized']),
        cbaId: c['cba_id'] || null,
        distributionCenter: c['distribution_center'] ?? '',
        systems: c['systems'] ?? '',
      };
    });
    const packageRows = evidence.filter((row) => row.evidenceType === PACKAGE_SITE);
    const latestRevision = Math.max(0, ...packageRows.map((row) => Number(row.canonical['revision'] ?? '0')));
    const current = packageRows.filter((row) => Number(row.canonical['revision'] ?? '0') === latestRevision);
    const bySite = new Map(sites.map((site) => [site.siteId, site]));
    const remedy: RemedyPackage | null =
      current.length === 0
        ? null
        : {
            id: `revision-${latestRevision}`,
            revision: latestRevision,
            date: current[0]?.canonical['revision_date'] ?? '',
            siteIds: current.map((row) => row.canonical['site_id'] ?? ''),
            distributionCenters: [...new Set(current.filter((row) => yes(row.canonical['distribution_center_transferred'])).map((row) => bySite.get(row.canonical['site_id'] ?? '')?.distributionCenter ?? ''))].filter(Boolean),
            systemsTransferred: [...new Set(current.filter((row) => yes(row.canonical['systems_transferred'])).map((row) => bySite.get(row.canonical['site_id'] ?? '')?.systems ?? ''))].filter(Boolean),
            buyer: current[0]?.canonical['buyer'] ?? '',
          };
    const packageEvidence = new Map(current.map((row) => [row.canonical['site_id'] ?? '', row.id]));
    const latest = (kind: string) => [...entries].reverse().find((entry) => entry.kind === kind) ?? null;
    const termsEntry = latest('TERMS');
    // The checks name where the cap is stated; a stored entry carries that as its citation.
    const terms = termsEntry
      ? { ...termsEntry, payload: { sources: { divestitureCap: `document ${termsEntry.citation.documentId}, page ${termsEntry.citation.pageNumber}` }, ...(termsEntry.payload as object) } }
      : null;
    const buyer = latest('BUYER');
    const feedback = entries.filter((entry) => entry.kind === 'FEEDBACK');
    const revisions = entries.filter((entry) => entry.kind === 'REVISION');
    const commitments = entries.filter((entry) => entry.kind === 'COMMITMENT');
    return { sites, siteEvidence, remedy, packageEvidence, terms, buyer, feedback, revisions, commitments };
  }

  private run(depth: 'FULL' | 'LIGHT', inputs: ReturnType<RegulatoryService['assemble']>, asOf: string): RegFinding[] {
    const { sites, remedy, terms, buyer, feedback, revisions, commitments } = inputs;
    const termsValue = terms ? (terms.payload as unknown as DealCertaintyTerms) : null;
    return [
      ...(depth === 'FULL' && sites.length > 0 ? [...overlapPockets(sites), ...laborExposure(sites)] : []),
      ...(depth === 'FULL' && remedy && termsValue ? headroom(termsValue, remedy) : []),
      ...(depth === 'FULL' && remedy ? [...cherryPick(sites, remedy), ...incoherentPackage(sites, remedy)] : []),
      ...(depth === 'FULL' && remedy && buyer ? buyerViability(buyer.payload as RemedyBuyer, remedy) : []),
      ...unaddressedFeedback(
        feedback.map((entry) => entry.payload as FeedbackRound),
        revisions.map((entry) => entry.payload as PackageRevision),
        asOf,
      ),
      ...unverifiablePledges(commitments.map((entry) => ({ id: entry.id, ...(entry.payload as Omit<Commitment, 'id'>) }))),
    ];
  }

  /** The screen, the workbench and the covenant status for the deal, computed now from its inputs. */
  async analyze(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'regulatory.viewed', requestId });
    const { pack, evidence, entries } = await withTenant(this.prisma, tenant, (tx) => this.load(tx, dealId));
    const profile = regulatoryProfile(pack.id);
    const inputs = this.assemble(evidence, entries);
    const asOf = new Date().toISOString().slice(0, 10);
    const findings = this.run(profile.depth, inputs, asOf);
    const terms = inputs.terms ? (inputs.terms.payload as unknown as DealCertaintyTerms) : null;
    const pre = findings.filter((finding) => finding.phase === 'PRE');
    const critical = findings.filter((finding) => finding.phase === 'DILIGENCE' && finding.severity === 'CRITICAL');
    // A band, never a probability: GO when nothing in the Pre screen; otherwise a remedy must be priced from day one,
    // and a CRITICAL remedy defect (a buyer who cannot run it) means the remedy as offered does not hold.
    const band: ClearanceBand = pre.length === 0 ? 'GO' : critical.length > 0 ? 'NO_GO' : 'GO_WITH_REMEDY_PRICED';
    const markets = inputs.sites.length > 0 && profile.depth === 'FULL' ? localConcentration(inputs.sites) : [];
    return {
      pack: { id: pack.id, label: pack.label },
      depth: profile.depth,
      authorities: profile.authorities,
      inputs: {
        sites: inputs.sites.length,
        packageSites: inputs.remedy?.siteIds.length ?? 0,
        packageRevision: inputs.remedy?.revision ?? null,
        terms: inputs.terms !== null,
        buyer: inputs.buyer !== null,
        feedbackRounds: inputs.feedback.length,
        revisions: inputs.revisions.length,
        commitments: inputs.commitments.length,
      },
      clearance: { band, reasons: [...pre, ...critical].map((finding) => finding.title) },
      markets: {
        overlapping: markets.length,
        presumed: markets.filter((market) => market.presumed).length,
        top: [...markets].sort((a, b) => b.delta - a.delta).slice(0, 15),
      },
      coherence: inputs.remedy ? coherence(inputs.sites, inputs.remedy) : null,
      certainty: terms ? { ...certaintyStatus(terms, asOf), divestitureCap: terms.divestitureCap, outsideDate: terms.outsideDate, effortsStandard: terms.effortsStandard, currency: terms.currency } : null,
      commitments: inputs.commitments.map((entry) => {
        const payload = entry.payload as Omit<Commitment, 'id'>;
        return { id: entry.id, text: payload.text, grade: gradeCommitment({ id: entry.id, ...payload }) };
      }),
      findings,
      entries: entries.map((entry) => ({ id: entry.id, kind: entry.kind, payload: entry.payload, citation: { documentId: entry.citation.documentId, pageNumber: entry.citation.pageNumber, quote: entry.citation.quote }, createdAt: entry.createdAt.toISOString() })),
    };
  }

  /**
   * Record the current results as DRAFT findings in the register, each citing
   * the evidence it rests on. Idempotent by fingerprint. Two certainty lines
   * carry a proposed price for the bridge: the termination fee the acquirer
   * could owe, and — when the analyst gave a multiple — the value of the
   * divested sites. A person reviews and prices every one.
   */
  async propose(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canDraftFindings, { action: 'regulatory.proposed', requestId });
    const { pack, evidence, entries, initiatedBy } = await withTenant(this.prisma, tenant, async (tx) => ({
      ...(await this.load(tx, dealId)),
      initiatedBy: (await tx.deal.findFirst({ where: { id: dealId }, select: { initiatedBy: true } }))?.initiatedBy ?? 'BUYER',
    }));
    const inputs = this.assemble(evidence, entries);
    const findings = this.run(regulatoryProfile(pack.id).depth, inputs, new Date().toISOString().slice(0, 10));
    const link = (evidenceItemId: string | null, documentCitation: DocumentCitation | null): FindingEvidenceLink => ({
      evidenceItemId,
      documentCitation,
      commitSha: null,
      toolName: TOOL,
      toolVersion: TOOL_VERSION,
      rulesetVersion: null,
      path: null,
      lineStart: null,
      lineEnd: null,
    });
    const sitesIn = (markets: readonly string[]) => inputs.sites.filter((site) => markets.includes(site.market) && site.party !== 'RIVAL');
    const evidenceFor = (finding: RegFinding): FindingEvidenceLink[] => {
      const sites = (ids: readonly string[], from: Map<string, string>) => ids.flatMap((id) => (from.get(id) ? [link(from.get(id) as string, null)] : [])).slice(0, MAX_LINKS);
      const entry = (kind: string) => [...entries].reverse().find((item) => item.kind === kind);
      switch (finding.check) {
        case 'overlap-pockets':
          return sites(sitesIn(finding.inputs['presumedMarkets'] as string[]).map((site) => site.siteId), inputs.siteEvidence);
        case 'labor-exposure':
          return sites(sitesIn(finding.inputs['markets'] as string[]).filter((site) => site.unionized).map((site) => site.siteId), inputs.siteEvidence);
        case 'unused-headroom': {
          const terms = entry('TERMS');
          return [...(terms ? [link(null, terms.citation)] : []), ...sites(inputs.remedy?.siteIds ?? [], inputs.packageEvidence)].slice(0, MAX_LINKS);
        }
        case 'cherry-pick':
        case 'incoherent-package':
          return sites(inputs.remedy?.siteIds ?? [], inputs.packageEvidence);
        case 'buyer-viability': {
          const buyer = entry('BUYER');
          return buyer ? [link(null, buyer.citation)] : sites(inputs.remedy?.siteIds ?? [], inputs.packageEvidence);
        }
        case 'unaddressed-feedback': {
          const round = inputs.feedback.find((item) => (item.payload as FeedbackRound).round === finding.inputs['round']);
          return round ? [link(null, round.citation)] : [];
        }
        case 'unverifiable-pledge': {
          const pledge = inputs.commitments.find((item) => item.id === finding.inputs['commitment']);
          return pledge ? [link(null, pledge.citation)] : [];
        }
        default:
          return [];
      }
    };
    const severity = (value: RegFinding['severity']): FindingSeverity => value;
    const proposals: ProposedFinding[] = findings
      .map((finding) => ({
        domain: 'REGULATORY' as const,
        title: finding.title,
        description: `${finding.description} (${finding.phase === 'PRE' ? 'Pre-screen' : 'Diligence'} check: ${finding.check}.)`,
        severity: severity(finding.severity),
        confidence: 'HIGH' as const,
        origin: 'HEURISTIC' as const,
        fingerprint: `regulatory:${finding.check}:${JSON.stringify(finding.inputs['round'] ?? finding.inputs['commitment'] ?? '')}`,
        evidence: evidenceFor(finding),
        pricedRisk: null,
        direction: -1 as const,
        directionRationale: 'Clearance risk: a remedy, a delay or a failed deal — priced by the reviewer.',
      }))
      .filter((proposal) => proposal.evidence.length > 0);

    // Certainty lines for the bridge (acquirer side only: a seller-led pact prices certainty from the other seat).
    const terms = [...entries].reverse().find((entry) => entry.kind === 'TERMS');
    if (terms && initiatedBy === 'BUYER') {
      const payload = terms.payload as DealCertaintyTerms & { ebitdaMultiple: string | null };
      const fee = payload.terminationFees.filter((item) => item.payer === 'ACQUIRER').reduce((total, item) => total + Number(item.amount), 0);
      if (fee > 0) {
        proposals.push({
          domain: 'REGULATORY',
          title: 'Termination fee exposure if clearance fails',
          description: `The agreement makes the acquirer pay ${payload.currency} ${fee.toLocaleString('en-US')} if clearance is not obtained by the outside date (${payload.outsideDate}).`,
          severity: 'HIGH',
          confidence: 'HIGH',
          origin: 'HEURISTIC',
          fingerprint: 'regulatory:termination-fee',
          evidence: [link(null, terms.citation)],
          pricedRisk: { type: 'REMEDIATION_COST', currency: payload.currency, low: '0', high: payload.terminationFees.filter((item) => item.payer === 'ACQUIRER').map((item) => item.amount).reduce((a, b) => (Number(a) >= Number(b) ? a : b)), basis: 'The termination fee the agreement makes the acquirer pay if clearance fails; zero if the deal clears.' },
          direction: -1,
          directionRationale: 'Certainty risk priced as a range: nothing if the deal clears, the fee if it does not.',
        });
      }
      if (payload.ebitdaMultiple && inputs.remedy) {
        const divested = inputs.sites.filter((site) => inputs.remedy?.siteIds.includes(site.siteId));
        const ebitda = divested.reduce((total, site) => total + Number(site.sales) * Number(site.performance), 0);
        const value = Math.round(ebitda * Number(payload.ebitdaMultiple));
        if (value > 0) {
          proposals.push({
            domain: 'REGULATORY',
            title: 'Expected remedy cost: the divested sites',
            description: `The ${divested.length} sites in package revision ${inputs.remedy.revision} earn about ${payload.currency} ${Math.round(ebitda).toLocaleString('en-US')} a year (sales × performance margin); at the analyst's ${payload.ebitdaMultiple}× multiple that is ${payload.currency} ${value.toLocaleString('en-US')} of value the acquirer does not keep.`,
            severity: 'HIGH',
            confidence: 'MEDIUM',
            origin: 'HEURISTIC',
            fingerprint: `regulatory:remedy-cost:${inputs.remedy.revision}`,
            evidence: [link(null, terms.citation), ...[...inputs.packageEvidence.values()].slice(0, MAX_LINKS - 1).map((id) => link(id, null))],
            pricedRisk: { type: 'PRICE_REDUCTION', currency: payload.currency, low: String(value), high: String(value), basis: `Divested sites' EBITDA × ${payload.ebitdaMultiple} (the multiple in the cited terms entry).` },
            direction: -1,
            directionRationale: 'Value given up to obtain clearance.',
          });
        }
      }
    }
    if (proposals.length === 0) throw new NotFoundException({ code: 'NOTHING_TO_PROPOSE' });
    const recorded = await this.findings.recordProposals(tenant, dealId, proposals, { kind: 'SYSTEM', component: `${TOOL}@${TOOL_VERSION}` }, requestId);
    return { created: recorded.created.length, existing: recorded.existing };
  }
}
