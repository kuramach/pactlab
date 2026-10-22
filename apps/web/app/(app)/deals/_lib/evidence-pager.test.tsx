import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EvidencePagerNav } from './evidence-pager';
import { evidenceApiQuery, evidencePager, evidenceQuery, MAX_TRAIL, parseEvidenceFilters } from './filters';

const base = '/deals/d/evidence';
const C1 = '01900000-0000-7000-8000-0000000e0001';
const C2 = '01900000-0000-7000-8000-0000000e0002';
const C3 = '01900000-0000-7000-8000-0000000e0003';
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&'));

describe('evidence pager', () => {
  it('first page: shows the count and window, Previous disabled, Next keeps the filters', () => {
    const filters = parseEvidenceFilters({ type: 'billing.invoice_line', visibility: 'SHARED' });
    const pager = evidencePager(filters, { itemCount: 50, total: 342, limit: 50, nextCursor: C1 });
    expect(pager.totalLabel).toBe('342 records');
    expect(pager.windowLabel).toBe('1–50 of 342');
    const html = renderToStaticMarkup(<EvidencePagerNav pager={pager} base={base} />);
    expect(html).toContain('1–50 of 342');
    expect(html).toMatch(/<span aria-disabled="true"[^>]*>← Previous<\/span>/);
    expect(hrefs(html)).toEqual([`${base}?type=billing.invoice_line&visibility=SHARED&cursor=${C1}`]);
  });

  it('later page: both directions keep the filters, and Previous walks the trail back', () => {
    // Page 3: reached via C1 then C2.
    const filters = parseEvidenceFilters({ type: 'billing.invoice_line', cursor: C2, trail: C1 });
    expect(filters).toEqual({ type: 'billing.invoice_line', cursor: C2, trail: [C1] });
    const pager = evidencePager(filters, { itemCount: 50, total: 342, limit: 50, nextCursor: C3 });
    expect(pager.windowLabel).toBe('101–150 of 342');
    const [previous, next] = hrefs(renderToStaticMarkup(<EvidencePagerNav pager={pager} base={base} />));
    expect(previous).toBe(`${base}?type=billing.invoice_line&cursor=${C1}`);
    expect(next).toBe(`${base}?type=billing.invoice_line&cursor=${C3}&trail=${C1}%2C${C2}`);
  });

  it('second page steps back to the first page with the filters only', () => {
    const filters = parseEvidenceFilters({ recordId: 'cus-1', cursor: C1 });
    const pager = evidencePager(filters, { itemCount: 42, total: 92, limit: 50, nextCursor: null });
    expect(pager.windowLabel).toBe('51–92 of 92');
    const html = renderToStaticMarkup(<EvidencePagerNav pager={pager} base={base} />);
    expect(hrefs(html)).toEqual([`${base}?recordId=cus-1`]);
    expect(html).toMatch(/<span aria-disabled="true"[^>]*>Next →<\/span>/);
  });

  it('a single record and no matches', () => {
    expect(evidencePager({}, { itemCount: 1, total: 1, limit: 50, nextCursor: null })).toMatchObject({ totalLabel: '1 record', windowLabel: '1–1 of 1' });
    const none = evidencePager({}, { itemCount: 0, total: 0, limit: 50, nextCursor: null });
    expect(none.windowLabel).toBeNull();
    expect(renderToStaticMarkup(<EvidencePagerNav pager={none} base={base} />)).toBe('');
  });

  it('an untrustworthy position restarts at page 1, and the trail never reaches the API', () => {
    expect(parseEvidenceFilters({ cursor: C2, trail: `${C1},../admin` })).toEqual({});
    expect(parseEvidenceFilters({ trail: C1 })).toEqual({});
    expect(parseEvidenceFilters({ cursor: C2, trail: Array.from({ length: MAX_TRAIL + 1 }, () => C1).join(',') })).toEqual({});
    const filters = parseEvidenceFilters({ type: 't', cursor: C2, trail: C1 });
    expect(evidenceApiQuery(filters)).toBe(`type=t&cursor=${C2}`);
    expect(evidenceQuery(filters)).toBe(`type=t&cursor=${C2}&trail=${C1}`);
  });
});
