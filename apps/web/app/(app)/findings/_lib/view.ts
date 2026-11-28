import { FINDING_DOMAINS, FINDING_STATUSES, type Finding, type FindingDomain, type FindingStatus, type PricedRisk } from '@pactlab/domain';
import { EN, type I18n } from '../../../../lib/i18n';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FindingFilters {
  dealId?: string;
  status?: FindingStatus;
  domain?: FindingDomain;
  /** Only findings brought in from document review. */
  source?: 'document-review';
  /** Only drags that still need a price before they can be accepted. */
  pricing?: 'needed';
}

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

/** Keep only values the API accepts; anything else is dropped rather than forwarded. */
/** A register finding brought in from the Documents review queue (pilot bug 11). */
/**
 * A drag (−1) with no price yet: acceptance refuses it until a person prices
 * it (T-058 gap note), so the register says so instead of leaving it silent.
 */
export const needsPricing = (finding: { direction: number | null; pricedRisk: unknown; status: string }) =>
  finding.direction === -1 && finding.pricedRisk === null && finding.status !== 'REJECTED';

export const fromDocumentReview = (finding: { fingerprint: string }) => finding.fingerprint.startsWith('document:');

export function parseFindingFilters(params: SearchParams): FindingFilters {
  const dealId = single(params['deal']);
  const status = single(params['status']);
  const domain = single(params['domain']);
  const source = single(params['source']);
  return {
    ...(dealId && UUID.test(dealId) ? { dealId } : {}),
    ...(status && (FINDING_STATUSES as readonly string[]).includes(status)
      ? { status: status as FindingStatus }
      : {}),
    ...(domain && (FINDING_DOMAINS as readonly string[]).includes(domain)
      ? { domain: domain as FindingDomain }
      : {}),
    ...(source === 'document-review' ? { source: 'document-review' as const } : {}),
    ...(single(params['pricing']) === 'needed' ? { pricing: 'needed' as const } : {}),
  };
}

export function findingsQuery(filters: FindingFilters): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.domain) query.set('domain', filters.domain);
  if (filters.source) query.set('source', filters.source);
  return query.toString();
}

/** The English labels; a reader's come from `t.m.findings.domains`. */
export const DOMAIN_LABELS: Readonly<Record<FindingDomain, string>> = EN.m.findings.domains;

/** Findings grouped by domain (technology review, then pack domains), in a fixed order, empty groups omitted. */
export function groupByDomain(findings: readonly Finding[]): [FindingDomain, Finding[]][] {
  return FINDING_DOMAINS.map(
    (domain) =>
      [domain, findings.filter((finding) => finding.domain === domain)] as [
        FindingDomain,
        Finding[],
      ],
  ).filter(([, items]) => items.length > 0);
}

/** Thousands separators on a decimal string, without converting to a number. */
export function formatPricedRisk(risk: PricedRisk | null, t: I18n = EN): string {
  if (!risk) return t.m.findings.notPriced;
  return t.moneyRange(risk.low, risk.high, risk.currency);
}

export const PRICED_RISK_LABELS: Readonly<Record<PricedRisk['type'], string>> = EN.m.findings.pricedRiskTypes;

export function statusVariant(status: FindingStatus): 'draft' | 'reviewed' | 'danger' | 'neutral' {
  if (status === 'ACCEPTED') return 'reviewed';
  if (status === 'REJECTED') return 'danger';
  if (status === 'DRAFT') return 'draft';
  return 'neutral';
}

export type Direction = -1 | 0 | 1;

/** Drag reprices, cushion confirms (never raises the price), neutral is a recorded decision. */
export const DIRECTION_LABELS: Readonly<Record<string, { label: string; word: string; help: string }>> = EN.m.findings.directions;

export function directionVariant(direction: Direction | null): 'danger' | 'calculation' | 'neutral' | 'draft' {
  return direction === -1 ? 'danger' : direction === 1 ? 'calculation' : direction === 0 ? 'neutral' : 'draft';
}

export function directionText(direction: Direction | null, t: I18n = EN): string {
  if (direction === null) return t.m.findings.directionUndecided;
  // The running-text form ("drag" in English; German nouns keep their capital).
  return t.m.findings.directions[String(direction) as '-1' | '0' | '1'].word;
}

/** Plain-language reasons the API refuses an acceptance (422 rule codes). */
export const RULE_MESSAGES: Readonly<Record<string, string>> = EN.m.findings.rules;
