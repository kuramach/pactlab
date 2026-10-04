import { SourceIndex, type ExtractedItem, type ResolvedCitation } from '@pactlab/ai';
import { newId } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import {
  decideDocumentFinding,
  draftFromExtraction,
  type DecisionActor,
} from './document-findings';
import type { DocumentFinding } from './documents.types';
import { extractPages, TARGET_PAGE_CHARS } from './extraction';
import {
  MAX_DOCUMENT_BYTES,
  retainUntil,
  retentionExpired,
  safeFileName,
  SignatureMalwareScanner,
  validateUpload,
} from './upload-policy';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const scanner = new SignatureMalwareScanner();

describe('upload policy', () => {
  it('accepts UTF-8 text and hashes the bytes', async () => {
    const upload = await validateUpload(
      { fileName: '../../etc/MSA.txt', contentType: 'text/plain', contentBase64: b64('Hello') },
      scanner,
    );
    expect(upload).toMatchObject({ fileName: 'MSA.txt', contentType: 'text/plain', text: 'Hello' });
    expect(upload.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(safeFileName('..\\..\\evil<script>.md')).toBe('evil_script_.md');
  });

  it.each([
    [
      'UNSUPPORTED_TYPE',
      { fileName: 'a.exe', contentType: 'application/x-msdownload', contentBase64: b64('x') },
    ],
    ['TYPE_MISMATCH', { fileName: 'a.pdf', contentType: 'text/plain', contentBase64: b64('x') }],
    [
      'TYPE_MISMATCH',
      { fileName: 'a.txt', contentType: 'text/plain', contentBase64: b64('%PDF-1.7 binary') },
    ],
    [
      'TYPE_MISMATCH',
      {
        fileName: 'a.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from([0x41, 0, 0x42]).toString('base64'),
      },
    ],
    [
      'BAD_ENCODING',
      {
        fileName: 'a.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from([0xc3, 0x28]).toString('base64'),
      },
    ],
    [
      'BAD_ENCODING',
      { fileName: 'a.txt', contentType: 'text/plain', contentBase64: 'not base64!' },
    ],
    [
      'TOO_LARGE',
      {
        fileName: 'a.txt',
        contentType: 'text/plain',
        contentBase64: b64('a'.repeat(MAX_DOCUMENT_BYTES + 1)),
      },
    ],
    [
      'MALWARE',
      {
        fileName: 'a.txt',
        contentType: 'text/plain',
        contentBase64: b64('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      },
    ],
  ] as const)('rejects %s', async (reason, input) => {
    await expect(validateUpload(input, scanner)).rejects.toMatchObject({ reason });
  });

  it('fails closed when the scanner is unavailable', async () => {
    const down = { name: 'down', scan: async () => 'UNAVAILABLE' as const };
    await expect(
      validateUpload(
        { fileName: 'a.txt', contentType: 'text/plain', contentBase64: b64('x') },
        down,
      ),
    ).rejects.toMatchObject({
      reason: 'SCAN_UNAVAILABLE',
    });
  });

  it('computes retention windows; legal hold never expires', () => {
    const now = new Date('2026-10-04T00:00:00Z');
    expect(retainUntil('SHORT_90D', now)).toBe('2027-01-02T00:00:00.000Z');
    expect(retainUntil('LEGAL_HOLD', now)).toBeNull();
    expect(
      retentionExpired({ retentionClass: 'SHORT_90D', retainUntil: '2026-10-01T00:00:00Z' }, now),
    ).toBe(true);
    expect(
      retentionExpired({ retentionClass: 'LEGAL_HOLD', retainUntil: '2026-10-01T00:00:00Z' }, now),
    ).toBe(false);
  });
});

describe('page extraction', () => {
  it('uses form feeds as page breaks and checksums each page', () => {
    const pages = extractPages('Page one\r\n\fPage two\n\f\n');
    expect(pages.map((p) => [p.pageNumber, p.text])).toEqual([
      [1, 'Page one'],
      [2, 'Page two'],
    ]);
    expect(pages[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pages long text at paragraph boundaries', () => {
    const paragraph = `${'word '.repeat(200)}\n\n`;
    const pages = extractPages(paragraph.repeat(10));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.text.length <= TARGET_PAGE_CHARS)).toBe(true);
  });

  it('rejects documents without text', () => {
    expect(() => extractPages('\n\f  \n')).toThrow(/NO_TEXT/);
  });
});

describe('document finding review', () => {
  const pageId = newId();
  const pageText =
    'If Vendor undergoes a Change of Control, Customer may terminate this Agreement.';
  const page = {
    citationId: pageId,
    documentId: 'doc',
    documentName: 'MSA.txt',
    pageNumber: 3,
    text: pageText,
    classification: 'BUSINESS' as const,
  };
  const check = new SourceIndex([page]).verify({
    citationId: pageId,
    quote: 'Customer may terminate this Agreement',
  });
  if (!check.ok) throw new Error('fixture citation must resolve');
  const citation: ResolvedCitation = check.citation;
  const item: ExtractedItem = {
    kind: 'CLAUSE',
    subtype: 'CHANGE_OF_CONTROL',
    title: 'Change of control clause',
    summary: 'Termination right on vendor change of control.',
    severity: 'HIGH',
    citations: [citation],
  };
  const run = {
    id: newId(),
    promptId: 'contract.extract',
    promptVersion: '1',
    promptHash: 'h',
    resolvedModelId: 'm',
  };
  const draft: DocumentFinding = draftFromExtraction({
    organizationId: newId(),
    dealId: newId(),
    documentId: 'doc',
    createdBy: newId(),
    run,
    item,
    now: new Date(),
  });
  const pages = new Map([[pageId, { pageNumber: 3, text: pageText }]]);
  const human: DecisionActor = { kind: 'HUMAN', userId: newId(), displayName: 'Riley Reviewer' };
  const decide = (overrides: Partial<Parameters<typeof decideDocumentFinding>[0]>) =>
    decideDocumentFinding({
      finding: draft,
      decision: 'ACCEPT',
      actor: human,
      rationale: 'Verified on page 3.',
      pages,
      now: new Date(),
      ...overrides,
    });

  it('drafts from AI output only as DRAFT with provenance', () => {
    expect(draft).toMatchObject({
      status: 'DRAFT',
      reviewer: null,
      provenance: { promptId: 'contract.extract' },
    });
  });

  it('accepts with exact page citations and a named human reviewer', () => {
    const { finding, review } = decide({});
    expect(finding).toMatchObject({
      status: 'ACCEPTED',
      reviewer: { displayName: 'Riley Reviewer' },
      version: 2,
    });
    expect(finding.citations[0]).toMatchObject({
      pageNumber: 3,
      quote: 'Customer may terminate this Agreement',
    });
    expect(review).toMatchObject({
      decision: 'ACCEPT',
      reviewer: { displayName: 'Riley Reviewer' },
    });
  });

  it('never lets AI or an unnamed actor decide', () => {
    expect(() => decide({ actor: { kind: 'AI', aiRunId: run.id } })).toThrow(/HUMAN_REQUIRED/);
    expect(() =>
      decide({
        actor: {
          kind: 'HUMAN',
          userId: human.kind === 'HUMAN' ? human.userId : '',
          displayName: ' ',
        },
      }),
    ).toThrow(/HUMAN_REQUIRED/);
  });

  it('refuses acceptance without citations or with stale citations', () => {
    expect(() => decide({ finding: { ...draft, citations: [] } })).toThrow(/CITATION_REQUIRED/);
    expect(() =>
      decide({
        pages: new Map([[pageId, { pageNumber: 3, text: pageText.replace('terminate', 'renew') }]]),
      }),
    ).toThrow(/CITATION_STALE/);
    expect(() => decide({ pages: new Map([[pageId, { pageNumber: 3, text: null }]]) })).toThrow(
      /CITATION_STALE/,
    );
    expect(() => decide({ pages: new Map([[pageId, { pageNumber: 4, text: pageText }]]) })).toThrow(
      /CITATION_STALE/,
    );
    expect(() => decide({ pages: new Map() })).toThrow(/CITATION_STALE/);
  });

  it('rejection needs a rationale; decided findings cannot be re-decided', () => {
    expect(() => decide({ decision: 'REJECT', rationale: '' })).toThrow(/RATIONALE_REQUIRED/);
    const { finding } = decide({ decision: 'REJECT', rationale: 'Not material.' });
    expect(finding.status).toBe('REJECTED');
    expect(() => decide({ finding })).toThrow(/INVALID_TRANSITION/);
  });
});
