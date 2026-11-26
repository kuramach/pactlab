import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CoverageNote, NarrowForm } from './ask-box';
import type { AskCoverage } from './actions';

vi.mock('./actions', () => ({ askQuestion: vi.fn() }));

const partial: AskCoverage = {
  strategy: 'KEYWORD',
  partial: true,
  documentsSearched: 60,
  pagesSearched: 1500,
  documentsRead: 12,
  pagesRead: 362,
  summary: 'Searched 60 documents (1500 pages); read the 362 most relevant pages.',
  documents: [{ documentId: 'd1', documentName: 'MSA (synthetic).txt', pageNumbers: [11, 12, 13] }],
  moreDocuments: 11,
};

/** Coverage on every answer (T-139): "not found" never looks like "not in the data room". */
describe('answer coverage', () => {
  it('says what was searched and which pages were read', () => {
    const html = renderToStaticMarkup(<CoverageNote coverage={partial} />);
    expect(html).toContain('Searched 60 documents (1500 pages); read the 362 most relevant pages.');
    expect(html).toContain('MSA (synthetic).txt: p. 11, 12, 13');
    expect(html).toContain('and pages of 11 more documents');
  });

  it('a full read lists no pages', () => {
    const html = renderToStaticMarkup(<CoverageNote coverage={{ ...partial, strategy: 'FULL', partial: false, summary: 'Read all 4 pages of 2 documents.', documents: [] }} />);
    expect(html).toContain('Read all 4 pages of 2 documents.');
    expect(html).not.toContain('<li>');
  });

  it('offers to narrow to the documents read and the library page, once each', () => {
    const html = renderToStaticMarkup(
      <NarrowForm action={() => undefined} pending={false} question="Can they walk away?" coverage={partial} choices={[{ id: 'd1', fileName: 'MSA (synthetic).txt' }, { id: 'd2', fileName: 'Lease (synthetic).pdf' }]} />,
    );
    expect(html.match(/name="documentId"/g)).toHaveLength(2);
    expect(html).toContain('value="Can they walk away?"');
    expect(html).toContain('Ask these documents');
  });
});
