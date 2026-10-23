import { describe, expect, it } from 'vitest';
import { FINDING_RULES, findingRule } from '../findings/rules';
import { parseCsv } from '../evidence';
import { applyMapping, mappedEvidence } from '../imports/mapping';
import { BILLING_INVOICE_LINE, IMPORT_TARGET_DEFINITIONS, peopleColumnProblems, targetTemplateCsv, type TargetDefinition } from '../imports/targets';
import { COMPANY_TYPES } from '../pacts/types';
import { sourcesFor } from '../pacts/catalog';
import { PACK_IDS, PACKS, packFor } from './registry';

describe('pack registry', () => {
  it('has one pack per company type except OTHER, each with unique slugs', () => {
    expect([...PACK_IDS].sort()).toEqual(COMPANY_TYPES.filter((type) => type !== 'OTHER').sort());
    expect(PACK_IDS).toHaveLength(12);
    const slugs = PACK_IDS.map((id) => PACKS[id].slug);
    expect(new Set(slugs).size).toBe(12);
    for (const id of PACK_IDS) expect(PACKS[id].id).toBe(id);
  });

  it('every pack offers billing first, and only targets and rules that exist', () => {
    for (const id of PACK_IDS) {
      const pack = PACKS[id];
      expect(pack.importTargets[0], id).toBe('BILLING_INVOICE_LINE');
      for (const target of pack.importTargets) expect(IMPORT_TARGET_DEFINITIONS[target], `${id}: ${target}`).toBeDefined();
      for (const rule of pack.findingRules) expect(() => findingRule(rule, FINDING_RULES), `${id}: ${rule}`).not.toThrow();
      expect(pack.valuationMethods.length, id).toBeGreaterThan(0);
    }
  });

  it('only the software pack is built so far; OTHER and unknown read the software core', () => {
    expect(PACK_IDS.filter((id) => PACKS[id].built)).toEqual(['SOFTWARE_SAAS']);
    expect(packFor('OTHER').id).toBe('SOFTWARE_SAAS');
    expect(packFor(null).id).toBe('SOFTWARE_SAAS');
    expect(packFor('HOTELS').slug).toBe('hotels');
  });

  it('the five new seller types get a source plan', () => {
    for (const type of ['MULTIFAMILY', 'COMMERCIAL_PROPERTY', 'HOTELS', 'SMALL_CLINICS', 'HOSPITALS'] as const) {
      expect(sourcesFor(type).sources.map((source) => source.kind)).toEqual(['BILLING', 'DOCUMENTS']);
    }
  });
});

describe('pack import targets (ADR 0010)', () => {
  // A pack-style target, as T-058+ will add (no DB enum value needed for a unit test).
  const RENT_ROLL = {
    target: 'BILLING_INVOICE_LINE',
    label: 'Rent roll',
    people: 'PSEUDONYMOUS',
    refusesPeopleColumns: true,
    evidenceType: 'test.rent_roll',
    recordIdField: 'unit',
    observedAtFields: ['as_of'],
    fields: [
      { name: 'unit', label: 'Unit', kind: 'text', required: true, hint: '' },
      { name: 'currency', label: 'Currency', kind: 'currency', required: true, hint: '' },
      { name: 'in_place_rent', label: 'In-place rent', kind: 'money', required: true, hint: '' },
      { name: 'as_of', label: 'As of', kind: 'date', required: false, hint: '' },
    ],
  } as const satisfies TargetDefinition;

  it('refuses named, contact, identity, health and pay columns on pack targets only', () => {
    expect(peopleColumnProblems(RENT_ROLL, ['unit', 'Resident Name', 'email', 'Monthly Salary', 'DOB', 'currency'])).toHaveLength(4);
    expect(peopleColumnProblems(RENT_ROLL, ['unit', 'unit_type', 'currency', 'in_place_rent', 'customer_name', 'ownership'])).toEqual([]);
    // Billing keeps ADR 0004 behaviour: unmapped columns are simply never imported.
    expect(peopleColumnProblems(BILLING_INVOICE_LINE, ['line_id', 'email'])).toEqual([]);
  });

  it('maps a pack extract through the same pipeline, citing each row', () => {
    const table = parseCsv('unit,currency,in_place_rent,as_of\nA01,EUR,"1.450,00",2026-09-30\nA02,EUR,n/a,2026-09-30\n');
    const mapping = {
      target: 'BILLING_INVOICE_LINE' as const,
      fields: { unit: { kind: 'column', column: 'unit' }, currency: { kind: 'column', column: 'currency' }, in_place_rent: { kind: 'column', column: 'in_place_rent' }, as_of: { kind: 'column', column: 'as_of' } },
      dateFormat: 'YYYY-MM-DD' as const,
      numberFormat: 'COMMA_DECIMAL' as const,
      amountUnit: 'MAJOR' as const,
      negateAmounts: false,
    } as const;
    const result = applyMapping(table, mapping, 'uploads/x/rent-roll.csv', RENT_ROLL);
    expect(result.rows.map((row) => row.canonical)).toEqual([{ unit: 'A01', currency: 'EUR', in_place_rent: '1450', as_of: '2026-09-30' }]);
    expect(result.issues.map((issue) => [issue.row, issue.code])).toEqual([[2, 'INVALID_VALUE']]);
    const pull = mappedEvidence(result, { target: mapping.target, sourceSystem: 'pack_upload:rent_roll', dataset: 'uploads/x/rent-roll.csv' }, RENT_ROLL);
    expect(pull.records[0]).toMatchObject({ evidenceType: 'test.rent_roll', sourceRecordId: 'A01', locator: { kind: 'csv_row', row: 1 }, observedAt: '2026-09-30T00:00:00.000Z' });
    expect(targetTemplateCsv(RENT_ROLL)).toBe('unit,currency,in_place_rent,as_of\n');
  });
});
