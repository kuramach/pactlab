import { D } from '../../metrics/decimal';
import { amountOf, INVOICE_LINE, monthName, percent, rowMonth } from '../common';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';

/**
 * Small clinics pack rules (T-068, spec §19; extends healthcare, T-061).
 * Providers appear only as pseudonymous references and in aggregate; no
 * patient data is accepted and nothing here reaches a model (rule 7).
 */
const VOLUME = 'clinics.volume_month';
const EQUIPMENT = 'clinics.equipment';
const CODING = 'clinics.coding_quarter';
type Decimal = InstanceType<typeof D>;

/** One pseudonymous provider earns at least half of a site's revenue over the last twelve months. */
export const CLINICS_PROVIDER_CARRIES_SITE: PackRule = {
  id: 'clinics-provider-carries-site',
  version: '1',
  evidenceTypes: [VOLUME],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === VOLUME && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''));
    const window = [...new Set(rows.map((row) => row.canonical['month'] ?? ''))].sort().slice(-12);
    const inWindow = rows.filter((row) => window.includes(row.canonical['month'] ?? ''));
    const sites = [...new Set(inWindow.map((row) => row.canonical['site'] ?? ''))].filter(Boolean).sort();
    return sites.flatMap((site) => {
      const atSite = inWindow.filter((row) => row.canonical['site'] === site);
      const total = atSite.reduce((sum, row) => sum.plus(amountOf(row, 'revenue')), new D(0));
      const byProvider = new Map<string, Decimal>();
      for (const row of atSite) byProvider.set(row.canonical['provider_ref'] ?? '', (byProvider.get(row.canonical['provider_ref'] ?? '') ?? new D(0)).plus(amountOf(row, 'revenue')));
      const [provider, revenue] = [...byProvider.entries()].sort((a, b) => b[1].comparedTo(a[1]) || a[0].localeCompare(b[0]))[0] ?? [];
      if (!provider || !revenue || !total.gt(0) || revenue.div(total).lt('0.5')) return [];
      return [
        {
          key: `${site}:${provider}`,
          domain: 'PEOPLE' as const,
          title: `One provider carries ${site}`,
          description: `${provider} earns ${percent(revenue.div(total))} of ${site} revenue over the ${window.length} months to ${monthName(window.at(-1) ?? '')} — a retention risk after closing. Providers are pseudonymous; this is a site aggregate, not a performance view.`,
          severity: revenue.div(total).gte('0.7') ? ('HIGH' as const) : ('MEDIUM' as const),
          confidence: 'HIGH' as const,
          direction: -1 as const,
          directionRationale: 'Retention arrangements as a closing condition, or a price adjustment the reviewer sets.',
          evidenceIds: atSite.filter((row) => row.canonical['provider_ref'] === provider).slice(-MAX_CITED).map((row) => row.id),
        },
      ];
    });
  },
};

/** High-complexity coding above the policy's expected share in every quarter, cited to the policy. */
export const CLINICS_CODING_ABOVE_POLICY: PackRule = {
  id: 'clinics-coding-above-policy',
  version: '1',
  evidenceTypes: [CODING],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = evidence.filter((row) => row.evidenceType === CODING).sort((a, b) => (a.canonical['quarter'] ?? '').localeCompare(b.canonical['quarter'] ?? ''));
    const above = rows.filter((row) => amountOf(row, 'high_complexity_share').gt(amountOf(row, 'policy_benchmark').times('1.5')));
    const policy = findSentence(pages, (sentence) => /(highest|high)[- ]complexity/i.test(sentence) && /\d+\s*%/.test(sentence));
    if (rows.length === 0 || above.length !== rows.length || !policy) return [];
    const shares = rows.map((row) => amountOf(row, 'high_complexity_share'));
    const low = D.min(...shares);
    const high = D.max(...shares);
    return [
      {
        key: `${rows[0]?.canonical['quarter']}:${rows.at(-1)?.canonical['quarter']}`,
        domain: 'REGULATORY',
        title: 'High-complexity coding above policy',
        description: `From ${rows[0]?.canonical['quarter']} to ${rows.at(-1)?.canonical['quarter']}, ${percent(low)}–${percent(high)} of visits are coded at the highest complexity against the ${percent(amountOf(rows[0] as PackRuleEvidence, 'policy_benchmark'))} the coding policy expects: “${policy.quote}” A coding audit before closing; repayment exposure is the reviewer's to price.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Overpayment recovery risk on past claims: an indemnity or escrow the reviewer prices after a coding audit.',
        evidenceIds: rows.map((row) => row.id),
        quotes: [{ documentId: policy.page.documentId, pageNumber: policy.page.pageNumber, quote: policy.quote }],
      },
    ];
  },
};

/** The end of the latest month in the billing import or, without it, the patient-volume extract. */
function asOf(evidence: readonly PackRuleEvidence[]): string | null {
  const months = evidence.map((row) => (row.evidenceType === INVOICE_LINE ? rowMonth(row) : row.evidenceType === VOLUME ? rowMonth(row, ['month']) : null)).filter((month): month is string => month !== null);
  const latest = months.sort().at(-1);
  return latest ? new Date(Date.UTC(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)), 0)).toISOString().slice(0, 10) : null;
}

/** Equipment in service beyond its useful life at the latest month; replacement is a remediation the reviewer prices. */
export const CLINICS_EQUIPMENT_PAST_LIFE: PackRule = {
  id: 'clinics-equipment-past-life',
  version: '1',
  evidenceTypes: [EQUIPMENT, INVOICE_LINE, VOLUME],
  detect: ({ evidence }) => {
    const date = asOf(evidence);
    if (!date) return [];
    const endOfLife = (row: PackRuleEvidence) => {
      const acquired = row.canonical['acquired'] ?? '';
      const years = amountOf(row, 'useful_life_years');
      return /^\d{4}-\d{2}-\d{2}/.test(acquired) && years.isInteger() ? `${Number(acquired.slice(0, 4)) + years.toNumber()}${acquired.slice(4, 10)}` : null;
    };
    const past = evidence.filter((row) => row.evidenceType === EQUIPMENT && !/retired|disposed/i.test(row.canonical['status'] ?? '') && (endOfLife(row) ?? '9999') <= date);
    if (past.length === 0) return [];
    return [
      {
        key: past.map((row) => row.sourceRecordId).sort().join(','),
        domain: 'OPERATIONAL',
        title: past.every((row) => /x-ray|imaging|\bmri\b|\bct\b|ultrasound|scanner/i.test(row.canonical['asset'] ?? '')) ? 'Imaging equipment past its useful life' : 'Equipment past its useful life',
        description: `${past.length} item${past.length > 1 ? 's are' : ' is'} in service past ${past.length > 1 ? 'their' : 'its'} useful life at ${date}: ${past.map((row) => `${row.canonical['asset']} at ${row.canonical['site']} (acquired ${row.canonical['acquired']}, ${row.canonical['useful_life_years']}-year life, ended ${endOfLife(row)})`).join('; ')}. Replacement is capital the buyer funds after closing.`,
        severity: past.length > 1 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Replacement capex as a remediation cost on the bridge, priced by the reviewer from quotes.',
        evidenceIds: past.map((row) => row.id),
      },
    ];
  },
};

export const CLINICS_RULES: readonly PackRule[] = [CLINICS_PROVIDER_CARRIES_SITE, CLINICS_CODING_ABOVE_POLICY, CLINICS_EQUIPMENT_PAST_LIFE];
export const CLINICS_EVIDENCE = { VOLUME, EQUIPMENT, CODING } as const;
