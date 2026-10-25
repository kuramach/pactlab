import {
  FINDING_DOMAINS,
  FINDING_STATUSES,
  type Finding,
  type FindingDomain,
  type FindingStatus,
  type PricedRisk,
} from '@pactlab/domain';

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

export const DOMAIN_LABELS: Readonly<Record<FindingDomain, string>> = {
  ARCHITECTURE: 'Architecture',
  MAINTAINABILITY: 'Maintainability',
  SECURITY: 'Security',
  OSS_LICENSE: 'Open-source & licensing',
  TEST_QUALITY: 'Test quality',
  OPERATIONS: 'Operations',
  CODE_PROVENANCE: 'Code provenance',
  KEY_PERSON: 'Key-person risk',
  FINANCIAL: 'Financial',
  COMMERCIAL: 'Commercial',
  OPERATIONAL: 'Operational',
  REGULATORY: 'Regulatory & compliance',
  LEGAL: 'Legal & contracts',
  PROPERTY: 'Property & assets',
  PEOPLE: 'People (aggregate)',
};

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
function group(amount: string): string {
  const [whole = '0', fraction] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatPricedRisk(risk: PricedRisk | null): string {
  if (!risk) return 'Not priced';
  const range =
    risk.low === risk.high ? group(risk.low) : `${group(risk.low)} – ${group(risk.high)}`;
  return `${risk.currency} ${range}`;
}

export const PRICED_RISK_LABELS: Readonly<Record<PricedRisk['type'], string>> = {
  PRICE_REDUCTION: 'Price reduction',
  ESCROW: 'Escrow',
  INDEMNITY: 'Indemnity',
  REMEDIATION_COST: 'Remediation cost',
};

export function statusVariant(status: FindingStatus): 'draft' | 'reviewed' | 'danger' | 'neutral' {
  if (status === 'ACCEPTED') return 'reviewed';
  if (status === 'REJECTED') return 'danger';
  if (status === 'DRAFT') return 'draft';
  return 'neutral';
}

export type Direction = -1 | 0 | 1;

/** Drag reprices, cushion confirms (never raises the price), neutral is a recorded decision. */
export const DIRECTION_LABELS: Readonly<Record<string, { label: string; short: string; help: string }>> = {
  '-1': { label: 'Drag', short: 'drag', help: 'Reprices the deal or hardens terms. Must be priced before it is accepted.' },
  '0': { label: 'Neutral', short: 'neutral', help: 'Moves no value. Needs a reason — neutral is a decision, not missing data.' },
  '1': { label: 'Cushion', short: 'cushion', help: 'Confirms the thesis. Value confirmed — not price paid; it never raises the price.' },
};

export function directionVariant(direction: Direction | null): 'danger' | 'calculation' | 'neutral' | 'draft' {
  return direction === -1 ? 'danger' : direction === 1 ? 'calculation' : direction === 0 ? 'neutral' : 'draft';
}

export function directionText(direction: Direction | null): string {
  return direction === null ? 'direction not decided' : (DIRECTION_LABELS[String(direction)]?.label ?? 'unknown').toLowerCase();
}

/** Plain-language reasons the API refuses an acceptance (422 rule codes). */
export const RULE_MESSAGES: Readonly<Record<string, string>> = {
  DIRECTION_REQUIRED: 'Choose whether this finding is a drag, a cushion or neutral before accepting it.',
  DRAG_NEEDS_PRICE: 'A drag must be priced before it is accepted. Ask for support to send it back so the analyst can price it.',
  CUSHION_NEEDS_DRIVER: 'A cushion must say which value driver it confirms. Ask for support so the analyst can add it.',
  NEUTRAL_NEEDS_RATIONALE: 'Say why this finding does not move value.',
  RATIONALE_REQUIRED: 'You changed the proposed direction — say why.',
};
