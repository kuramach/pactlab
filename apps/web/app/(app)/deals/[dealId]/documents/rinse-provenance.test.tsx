import type { ClaimView, DocumentProvenanceView } from '@pactlab/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HandSourcedBadge, restsOnHandSourced, SellerClaims } from '../../_lib/seller-claims';
import { provenanceDetails, provenanceLine, RinseProvenance, RinseSets } from './rinse-provenance';

const PROVENANCE: DocumentProvenanceView = {
  documentId: '0193a1b2-0000-7000-8000-0000000000d1',
  set: { id: '0193a1b2-0000-7000-8000-0000000000s1', name: 'Harbour Lane — diligence set (synthetic)', preparedBy: { name: 'Dana Whitlow', organization: 'Harbour Lane Apartments LLC (synthetic)' }, readyAt: '2026-11-20T09:00:00.000Z', origin: 'ARCHIVE' },
  role: 'CONVERTED',
  manifestDocumentId: '0193a1b2-0000-7000-8000-000000000002',
  canonical: { path: 'rinsed/Financials/Balance sheet Sept 2026.pdf', sha256: 'a'.repeat(64) },
  original: { path: 'Financials/Balance sheet Sept 2026.docx', sha256: 'b'.repeat(64), sizeBytes: 1200, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  entry: {
    route: 'CONVERT',
    classification: { category: 'BALANCE_SHEET', by: 'AI', confidence: 0.96, promptVersion: 'document.classify@1' },
    checks: [{ code: 'SOURCE_DISCREPANCY', severity: 'WARNING', message: 'The original does not foot.', resolution: null }],
    conversionLog: [{ at: '2026-11-20T09:00:00.000Z', step: 'CONVERTED', tool: 'libreoffice', detail: null }],
    audit: { version: 'rinse-audit-1', originalReadBy: 'TEXT_LAYER', figuresCompared: 4, figuresMatched: 4, pages: { original: 1, converted: 1 }, tables: { original: 1, converted: 1 }, mismatches: [], sourceDiscrepancies: [{ label: 'Total current assets', page: 1, stated: '468000', computed: '458000' }] },
    duplicateOf: null,
  },
  recordedAt: '2026-11-27T10:00:00.000Z',
};

const claim = (origin: ClaimView['origin']): ClaimView => ({ id: `c-${origin}`, statement: 'Occupied units: 106', source: 'Hand-sourced — entered by Dana Whitlow', origin, status: 'UNVERIFIED', rationale: null, evidenceItemIds: [], findings: [{ id: 'f1', title: 'Occupancy', status: 'DRAFT' }], version: 1, updatedByName: null, updatedAt: '2026-11-27T10:00:00.000Z' });

describe('Rinse provenance on documents and citations (T-178d)', () => {
  it('names the seller’s original a cited copy reproduces, and how it was checked', () => {
    expect(provenanceLine(PROVENANCE)).toBe('Canonical copy of the seller’s original Financials/Balance sheet Sept 2026.docx, rinsed by Dana Whitlow, Harbour Lane Apartments LLC (synthetic); 4 of 4 figures matched the original.');
    const details = provenanceDetails(PROVENANCE);
    expect(details.join('\n')).toContain('Total current assets on page 1 states 468000; its lines sum to 458000');
    expect(details.join('\n')).toContain('converted (libreoffice)');
    expect(provenanceLine({ ...PROVENANCE, role: 'AS_IS', original: null })).toContain('Carried as it is');
    expect(renderToStaticMarkup(<RinseProvenance items={[PROVENANCE]} />)).toContain('imported once as a zip');
    expect(renderToStaticMarkup(<RinseProvenance items={[]} />)).toBe('');
  });

  it('lists a set’s noted gaps and links each source discrepancy to its draft', () => {
    const html = renderToStaticMarkup(
      <RinseSets
        dealId="d1"
        sets={[
          {
            id: 's1',
            name: 'Harbour Lane',
            pack: 'MULTIFAMILY',
            preparedBy: PROVENANCE.set.preparedBy,
            readyAt: PROVENANCE.set.readyAt,
            origin: 'SYNC',
            documents: 6,
            gaps: [{ input: 'MULTIFAMILY_DELINQUENCY', label: 'Delinquency report', need: 'OPTIONAL', state: 'NOTED', note: 'Follows next week.', documentIds: [] }],
            sourceDiscrepancies: [{ manifestDocumentId: 'm2', documentId: 'doc', title: 'Balance sheet', label: 'Total current assets', page: 1, stated: '468000', computed: '458000', findingId: 'f9' }],
            recordedAt: PROVENANCE.recordedAt,
          },
        ]}
      />,
    );
    expect(html).toContain('Follows next week.');
    expect(html).toContain('href="/deals/d1/findings/f9"');
  });

  it('labels a hand-sourced claim, and any finding resting on one', () => {
    expect(restsOnHandSourced([claim('MANUAL')])).toBe(false);
    expect(restsOnHandSourced([claim('HAND_SOURCED')])).toBe(true);
    expect(renderToStaticMarkup(<HandSourcedBadge claims={[claim('HAND_SOURCED')]} />)).toContain('Rests on a hand-sourced claim');
    expect(renderToStaticMarkup(<HandSourcedBadge claims={[claim('PACK_RULE')]} />)).toBe('');
    expect(renderToStaticMarkup(<SellerClaims claims={[claim('HAND_SOURCED')]} />)).toContain('Hand-sourced');
  });
});
