import { documentClauseRule, revenueConcentrationRule } from '../common';
import { findSentence, MAX_CITED, type PackRule } from '../rule-types';

/**
 * Pharma and biotech pack rules (T-064, spec §19). Exclusivity, supply and
 * partner risks; clinical and regulatory judgement stays with the reviewer.
 */
const PATENT = 'pharma.patent';
const EXCLUSIVITY = /exclusivity (?:through|until|to) (?:the end of )?(\d{4})/i;

/**
 * The forecast assumes exclusivity for a product beyond its core patents: the
 * latest composition-of-matter expiry (or, without one, the latest expiry of
 * any type) falls before the year the forecast assumes.
 */
export const PHARMA_PATENT_BEFORE_FORECAST: PackRule = {
  id: 'pharma-patent-before-forecast',
  version: '1',
  evidenceTypes: [PATENT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const patents = evidence.filter((row) => row.evidenceType === PATENT && /^\d{4}-\d{2}-\d{2}/.test(row.canonical['expiry'] ?? ''));
    const products = [...new Set(patents.map((row) => row.canonical['product'] ?? ''))].filter(Boolean);
    const proposals = [];
    for (const product of products) {
      const hit = findSentence(pages, (sentence) => sentence.includes(product) && EXCLUSIVITY.test(sentence));
      if (!hit) continue;
      const assumed = EXCLUSIVITY.exec(hit.quote)?.[1] ?? '';
      const own = patents.filter((row) => row.canonical['product'] === product);
      const core = own.filter((row) => /composition/i.test(row.canonical['type'] ?? ''));
      const basis = core.length > 0 ? core : own;
      const expiry = basis.map((row) => row.canonical['expiry'] ?? '').sort().at(-1) ?? '';
      if (!expiry || expiry.slice(0, 4) >= assumed) continue;
      const later = own.filter((row) => !basis.includes(row) && (row.canonical['expiry'] ?? '') > expiry);
      proposals.push({
        key: `${product}:${assumed}`,
        domain: 'LEGAL' as const,
        title: 'Key patent expires earlier than the forecast assumes',
        description:
          `The forecast assumes ${product} exclusivity through ${assumed}; its ${core.length > 0 ? 'composition-of-matter' : 'listed'} patents expire by ${expiry} (${basis.map((row) => `${row.canonical['family']} ${row.canonical['jurisdiction']} ${row.canonical['expiry']}`).join('; ')}).` +
          (later.length > 0 ? ` Later ${[...new Set(later.map((row) => row.canonical['type']))].join(' and ')} patents give narrower protection.` : ''),
        severity: 'HIGH' as const,
        confidence: 'HIGH' as const,
        direction: -1 as const,
        directionRationale: 'Revenue after core patent expiry faces generic entry; the exclusivity scenario and price follow, priced by the reviewer.',
        evidenceIds: basis.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }],
      });
    }
    return proposals;
  },
};

export const PHARMA_SUPPLIER_OBSERVATIONS = documentClauseRule({
  id: 'pharma-supplier-observations',
  title: 'Open manufacturing observations at the supplier',
  domain: 'REGULATORY',
  severity: 'HIGH',
  direction: 0,
  directionRationale: 'Corrective-action close-out as a closing deliverable or a supply covenant, not a price term.',
  sentences: [(sentence) => /open observations?:?\s*[1-9]/i.test(sentence)],
  description: ([observations]) => `The contract manufacturer's latest inspection leaves observations open: “${observations}”`,
});

/** The largest partner across its revenue lines ("<Partner> — <line>"). */
export const PHARMA_PARTNER_CONCENTRATION = revenueConcentrationRule({
  id: 'pharma-partner-concentration',
  title: 'Partner concentration',
  domain: 'COMMERCIAL',
  threshold: '0.4',
  groupBy: { key: (name) => /^(.+?) — /.exec(name)?.[1] ?? name.replace(/\s*\([^)]*\)\s*$/, ''), label: (partner) => partner },
  direction: 0,
  directionRationale: 'A partner-renewal or royalty-term sensitivity in the scenarios, not a price term.',
  consequence: 'A dispute or a renegotiation with that partner moves most of the revenue.',
});

export const PHARMA_RULES: readonly PackRule[] = [PHARMA_PATENT_BEFORE_FORECAST, PHARMA_SUPPLIER_OBSERVATIONS, PHARMA_PARTNER_CONCENTRATION];
export const PHARMA_EVIDENCE = { PATENT } as const;
