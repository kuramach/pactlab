import { describe, expect, it } from 'vitest';
import { comparableDuplicateKey, comparableTemplateCsv, csvCell, parseComparableBatch, parseDelimited } from './comparables-batch';

describe('batch comparables (T-111)', () => {
  it('reads CSV with quoted commas, doubled quotes and line breaks, a BOM and blank lines', () => {
    expect(parseDelimited('﻿a,b\r\n"1,000","say ""hi""\nthere"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1,000', 'say "hi"\nthere'],
    ]);
  });

  it('reads tab-separated paste, where commas are part of the value', () => {
    expect(parseDelimited('EV\tARR\n25,000,000\t5,000,000')).toEqual([
      ['EV', 'ARR'],
      ['25,000,000', '5,000,000'],
    ]);
  });

  it('round-trips the template, whose example row is valid', () => {
    const parsed = parseComparableBatch(comparableTemplateCsv());
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.unknownColumns).toEqual([]);
    expect(parsed.rows[0]?.problems).toEqual([]);
    expect(parsed.rows[0]?.entry).toMatchObject({ kind: 'PRECEDENT_TRANSACTION', companyType: 'SOFTWARE_SAAS', enterpriseValue: '25000000', arrGrowth: '0.2500' });
  });

  it('accepts spreadsheet wording and other header spellings, and names unknown and missing columns', () => {
    const parsed = parseComparableBatch(
      'kind,NAME,target company,enterprise_value,ARR,basis,currency,source,Notes\npublic peer,Peer A,Peer A Inc,"$30,000,000",6000000,revenue,usd,10-K 2025,ignored',
    );
    expect(parsed.unknownColumns).toEqual(['Notes']);
    expect(parsed.missingColumns).toEqual(['Company type']);
    expect(parsed.rows[0]?.problems.map((problem) => problem.column)).toEqual(['Company type']);
    const ok = parseComparableBatch('Kind,Name,Target,Company type,EV,ARR,Basis,Currency,Source\nPublic peer,Peer A,Peer A Inc,Fintech,"$30,000,000",6000000,revenue,usd,10-K 2025');
    expect(ok.rows[0]?.entry).toMatchObject({ kind: 'PUBLIC_PEER', companyType: 'FINTECH', enterpriseValue: '30000000', arrBasis: 'REVENUE', currency: 'USD' });
  });

  it('never floats money: amounts stay decimal strings', () => {
    const parsed = parseComparableBatch('Kind,Name,Target,Company type,EV,ARR,Currency,Source\nPrecedent,A,B,Fintech,0.1,0.2,USD,Filing');
    expect(parsed.rows[0]?.entry).toMatchObject({ enterpriseValue: '0.1', arr: '0.2' });
  });

  it('writes CSV cells safely, defusing spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5000000')).toBe('-5000000');
  });

  it('treats the same name, target and date as a duplicate, ignoring case and spacing', () => {
    expect(comparableDuplicateKey({ name: 'Deal  A', targetName: 'Target', announcedOn: '2025-01-01' })).toBe(
      comparableDuplicateKey({ name: 'deal a', targetName: ' TARGET ', announcedOn: '2025-01-01' }),
    );
  });
});
