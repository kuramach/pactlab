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
}

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

/** Keep only values the API accepts; anything else is dropped rather than forwarded. */
export function parseFindingFilters(params: SearchParams): FindingFilters {
  const dealId = single(params['deal']);
  const status = single(params['status']);
  const domain = single(params['domain']);
  return {
    ...(dealId && UUID.test(dealId) ? { dealId } : {}),
    ...(status && (FINDING_STATUSES as readonly string[]).includes(status)
      ? { status: status as FindingStatus }
      : {}),
    ...(domain && (FINDING_DOMAINS as readonly string[]).includes(domain)
      ? { domain: domain as FindingDomain }
      : {}),
  };
}

export function findingsQuery(filters: FindingFilters): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.domain) query.set('domain', filters.domain);
  return query.toString();
}

export const DOMAIN_LABELS: Readonly<Record<FindingDomain, string>> = {
  ARCHITECTURE: 'Architecture',
  MAINTAINABILITY: 'Maintainability',
  SECURITY: 'Security',
  OSS_LICENSE: 'OSS & licensing',
  TEST_QUALITY: 'Test quality',
  OPERATIONS: 'Operations',
  CODE_PROVENANCE: 'Code provenance',
  KEY_PERSON: 'Key-person risk',
};

/** Findings grouped by technology-review domain, in a fixed order, empty groups omitted. */
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
