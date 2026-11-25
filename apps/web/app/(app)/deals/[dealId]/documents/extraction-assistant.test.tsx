import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ extractWithGuidance: vi.fn(), importDocument: vi.fn(), understandOne: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ExtractionAssistant, groupDrafts, guidanceFrom, ReadSpreadsheet } from './extraction-assistant';

const draft = (kind: string, title: string, severity = 'INFO') => ({ id: title, kind, subtype: kind, title, summary: title, severity, citations: [{ documentId: 'd', pageNumber: 2, quote: 'a quote' }] });

describe('AI extraction that talks first (Kumar, 2026-11-25)', () => {
  it('turns the answers into guidance: only questions answered, then anything else', () => {
    expect(guidanceFrom(['Is Schedule 3 included?', 'Who is the target?'], ['', 'Northwind'], ' It runs to 2028. ')).toBe('Q: Who is the target?\nA: Northwind\nAlso: It runs to 2028.');
    expect(guidanceFrom(['Q?'], [''], '')).toBe('');
  });

  it('groups what was picked up as a person reads it: parties, dates, clauses, drafting problems', () => {
    const groups = groupDrafts([draft('CLAUSE', 'Change of control clause', 'HIGH'), draft('PARTY', 'Party: Acme'), draft('CONSISTENCY', 'Undefined term'), draft('DATE', 'Effective date')]);
    expect(groups.map((group) => group.label)).toEqual(['Parties', 'Dates', 'Clauses', 'Drafting problems']);
  });

  it('starts by offering to read the document first, or to extract straight away', () => {
    const html = renderToStaticMarkup(<ExtractionAssistant dealId="d" documentId="x" />);
    expect(html).toContain('Read with AI');
    expect(html).toContain('Extract straight away');
  });

  it('a spreadsheet is read as data, or says what to do when Pactlab cannot tell what it is', () => {
    expect(renderToStaticMarkup(<ReadSpreadsheet dealId="d" documentId="x" target="FINANCIAL_PNL" />)).toContain('Read this spreadsheet');
    expect(renderToStaticMarkup(<ReadSpreadsheet dealId="d" documentId="x" target={null} />)).toContain('Sort it with AI');
  });
});
