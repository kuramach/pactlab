import { describe, expect, it } from 'vitest';
import {
  canBrowseEvidence,
  canSeeEvidence,
  canonicalJson,
  createCsvEvidenceSource,
  lineageTrail,
  normalizeCsv,
  parseCsv,
  type EvidenceLineage,
} from './index';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines and CRLF', () => {
    const table = parseCsv(
      'id,name,note\r\n1,"Acme, Inc.","said ""hi"""\r\n2,Beta,"multi\nline"\r\n',
    );
    expect(table.header).toEqual(['id', 'name', 'note']);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['1', 'Acme, Inc.', 'said "hi"'],
      ['2', 'Beta', 'multi\nline'],
    ]);
    expect(table.rows[0]?.text).toBe('1,"Acme, Inc.","said ""hi"""');
  });

  it('rejects ragged rows, duplicate headers and unterminated quotes', () => {
    expect(() => parseCsv('a,b\n1\n')).toThrow(/expected 2/);
    expect(() => parseCsv('a,a\n1,2\n')).toThrow(/unique/);
    expect(() => parseCsv('a\n"open\n')).toThrow(/Unterminated/);
  });
});

describe('normalizeCsv', () => {
  const mapping = {
    dataset: 'SparseCo/customers.csv',
    evidenceType: 'billing.customer',
    recordIdColumn: 'customer_id',
    observedAtColumn: 'as_of',
  };

  it('keeps source system, record id and exact locator on every record', () => {
    const { records, issues } = normalizeCsv(
      'csv',
      mapping,
      'customer_id,name,as_of\nc1,Acme,2026-09-30\n',
    );
    expect(issues).toEqual([]);
    expect(records).toEqual([
      {
        evidenceType: 'billing.customer',
        sourceSystem: 'csv',
        sourceRecordId: 'c1',
        observedAt: '2026-09-30T00:00:00.000Z',
        canonical: { customer_id: 'c1', name: 'Acme', as_of: '2026-09-30' },
        locator: { kind: 'csv_row', dataset: 'SparseCo/customers.csv', row: 1 },
        quote: 'c1,Acme,2026-09-30',
      },
    ]);
  });

  it('surfaces missing ids, duplicate ids and bad dates instead of guessing', () => {
    const text =
      'customer_id,name,as_of\n,NoId,2026-01-01\nc1,Acme,\nc1,Acme again,2026-01-01\nc2,Dup Name,yesterday\n';
    const { records, issues } = normalizeCsv('csv', mapping, text);
    expect(records.map((record) => record.sourceRecordId)).toEqual(['c1', 'c2']);
    expect(records[0]?.canonical['as_of']).toBeNull();
    expect(issues.map((issue) => [issue.code, issue.row])).toEqual([
      ['MISSING_RECORD_ID', 1],
      ['DUPLICATE_RECORD_ID', 3],
      ['INVALID_DATE', 4],
    ]);
  });

  it('reports a missing id column and malformed files as issues', () => {
    expect(normalizeCsv('csv', mapping, 'name\nAcme\n').issues[0]?.code).toBe('MISSING_COLUMN');
    expect(normalizeCsv('csv', mapping, 'a,b\n1\n').issues[0]?.code).toBe('MALFORMED_CSV');
  });

  it('pulls every dataset through one source', async () => {
    const source = createCsvEvidenceSource({
      provider: 'csv',
      version: 'csv-1',
      datasets: [mapping, { ...mapping, dataset: 'SparseCo/other.csv' }],
      load: async () => 'customer_id,name,as_of\nc1,Acme,2026-01-01\n',
    });
    const pull = await source.pull();
    expect(pull.records.map((record) => record.locator.kind === 'csv_row' && record.locator.dataset)).toEqual([
      'SparseCo/customers.csv',
      'SparseCo/other.csv',
    ]);
  });
});

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: null, c: [1, 'x'] } })).toBe(
      '{"a":{"c":[1,"x"],"d":null},"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('contributor boundary', () => {
  it('hides buyer-only evidence from target contributors only', () => {
    expect(canSeeEvidence('TARGET_CONTRIBUTOR', 'BUYER_ONLY')).toBe(false);
    expect(canSeeEvidence('TARGET_CONTRIBUTOR', 'SHARED')).toBe(true);
    expect(canSeeEvidence('ANALYST', 'BUYER_ONLY')).toBe(true);
  });

  it('lets contributors and evidence readers browse, but not viewers without EVIDENCE_READ', () => {
    expect(canBrowseEvidence('TARGET_CONTRIBUTOR')).toBe(true);
    expect(canBrowseEvidence('REVIEWER')).toBe(true);
    expect(canBrowseEvidence('VIEWER')).toBe(false);
  });
});

describe('lineageTrail', () => {
  it('orders the trail from source system to evidence', () => {
    const lineage: EvidenceLineage = {
      evidence: {
        id: 'e1',
        dealId: 'd1',
        evidenceType: 'billing.customer',
        sourceSystem: 'csv',
        sourceRecordId: 'c1',
        observedAt: null,
        contentHash: 'a'.repeat(64),
        visibility: 'BUYER_ONLY',
        connectionId: 'k1',
        createdAt: '2026-10-01T00:00:00.000Z',
        canonical: {},
      },
      citations: [
        {
          id: 'q1',
          locator: { kind: 'csv_row', dataset: 'HealthyCo/customers.csv', row: 3 },
          quoteHash: 'b'.repeat(64),
        },
      ],
      syncRun: {
        id: 'r1',
        connectorVersion: 'csv-1',
        status: 'SUCCEEDED',
        startedAt: null,
        completedAt: null,
      },
      lastSeenSyncRunId: 'r1',
      connection: { id: 'k1', provider: 'csv', displayName: 'Billing export', mode: 'FIXTURE' },
      related: [],
    };
    expect(lineageTrail(lineage).map((step) => step.label)).toEqual([
      'Source system',
      'Connection',
      'Sync run',
      'Citation',
      'Evidence',
    ]);
    expect(lineageTrail(lineage)[3]?.value).toBe('HealthyCo/customers.csv row 3');
  });
});
