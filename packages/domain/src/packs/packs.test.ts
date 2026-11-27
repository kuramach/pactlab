import { describe, expect, it } from 'vitest';
import { parseCsv } from '../evidence';
import { applyMapping, mappedEvidence } from '../imports/mapping';
import { BILLING_INVOICE_LINE, IMPORT_TARGET_DEFINITIONS, peopleColumnProblems, targetTemplateCsv, type TargetDefinition } from '../imports/targets';
import { expectedInputs } from '../intake/checklist';
import { COMPANY_TYPES } from '../pacts/types';
import { sourceKindForProvider, sourcesFor } from '../pacts/catalog';
import { PACK_IDS, PACKS, packFor } from './registry';

describe('pack registry', () => {
  it('has one pack per company type except OTHER, each with unique slugs', () => {
    expect([...PACK_IDS].sort()).toEqual(COMPANY_TYPES.filter((type) => type !== 'OTHER').sort());
    expect(PACK_IDS).toHaveLength(17);
    const slugs = PACK_IDS.map((id) => PACKS[id].slug);
    expect(new Set(slugs).size).toBe(17);
    for (const id of PACK_IDS) expect(PACKS[id].id).toBe(id);
  });

  it('Multifamily syndication reuses the Multifamily pack by reference and only adds the offering (T-106)', () => {
    const mf = PACKS.MULTIFAMILY;
    const syn = PACKS.MULTIFAMILY_SYNDICATION;
    expect(syn.slug).toBe('multifamily-syndication');
    expect(syn.cluster).toBe(mf.cluster);
    expect(syn.metricCalculator).toBe(mf.metricCalculator);
    expect(syn.valuationMethods).toEqual(mf.valuationMethods);
    expect(syn.importTargets.slice(0, mf.importTargets.length)).toEqual(mf.importTargets);
    expect(syn.findingRules.slice(0, mf.findingRules.length)).toEqual(mf.findingRules);
    expect(syn.importTargets.slice(mf.importTargets.length)).toEqual(['SYNDICATION_TRACK_RECORD']);
    expect(syn.documentCategories).toEqual(['OFFERING_PPM', 'OPERATING_AGREEMENT', 'INVESTOR_DECK']);
    expect(mf.documentCategories).toBeUndefined();
  });

  it('Music rights reads the works register, splits, chain of title and statements, and names its multiple (T-140)', () => {
    const music = PACKS.MUSIC_RIGHTS;
    expect(music).toMatchObject({ slug: 'music-rights', label: 'Music rights', cluster: 'media-rights', metricCalculator: 'music-royalties', built: true });
    expect(music.importTargets).toEqual(['BILLING_INVOICE_LINE', 'MUSIC_WORKS', 'MUSIC_SPLITS', 'MUSIC_TITLE_CHAIN', 'MUSIC_ROYALTY_STATEMENTS']);
    expect(music.findingRules).toHaveLength(9);
    expect(music.methodLabels?.ARR_MULTIPLE?.label).toBe('Royalty multiple');
    expect(music.documentCategories).toContain('LIEN_SEARCH');
    for (const target of music.importTargets.slice(1)) expect(IMPORT_TARGET_DEFINITIONS[target].refusesPeopleColumns, target).toBe(true);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.MUSIC_SPLITS, ['split_id', 'work_id', 'writer_ref', 'share_pct', 'source'])).toEqual([]);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.MUSIC_SPLITS, ['work_id', 'full_name', 'share_pct'])).toHaveLength(1);
  });

  it('Energy generation & rights reads plants, interests, leases, production and the liability schedule, and names its methods (T-142)', () => {
    const energy = PACKS.ENERGY_GENERATION;
    expect(energy).toMatchObject({ slug: 'energy-generation', label: 'Energy generation & rights', cluster: 'energy', metricCalculator: 'energy-assets', built: true });
    expect(energy.importTargets).toEqual(['BILLING_INVOICE_LINE', 'ENERGY_PLANTS', 'ENERGY_INTERESTS', 'ENERGY_LEASES', 'ENERGY_PRODUCTION', 'ENERGY_LIABILITIES']);
    expect(energy.findingRules).toHaveLength(9);
    expect(energy.methodLabels?.DCF?.label).toBe('Reserve-based DCF');
    expect(energy.methodLabels?.ARR_MULTIPLE?.label).toBe('Capacity value ($/kW)');
    expect(energy.documentCategories).toContain('RESERVE_REPORT');
    for (const target of energy.importTargets.slice(1)) expect(IMPORT_TARGET_DEFINITIONS[target].refusesPeopleColumns, target).toBe(true);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.ENERGY_LEASES, ['lease_id', 'lessor_ref', 'net_acres', 'royalty_rate', 'held_by_production'])).toEqual([]);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.ENERGY_LEASES, ['lease_id', 'full_name', 'net_acres'])).toHaveLength(1);
  });

  it('Startup equity SPV reads the startup by reference to Venture Raise and adds the vehicle checks (T-141)', () => {
    const spv = PACKS.STARTUP_SPV;
    expect(spv).toMatchObject({ slug: 'startup-spv', label: 'Startup equity SPV', cluster: 'capital', metricCalculator: 'spv-round', built: true });
    expect(spv.importTargets).toBe(PACKS.VENTURE_RAISE.importTargets);
    expect(spv.findingRules).toHaveLength(6);
    expect(spv.documentCategories).toEqual(expect.arrayContaining(['SIDE_LETTER', 'FORM_D', 'SPV_OPERATING_AGREEMENT']));
  });

  it('Fintech reads the loan tape, AML alerts, the processor export and the licence register, and its compliance documents (T-159)', () => {
    const fintech = PACKS.FINTECH;
    expect(fintech).toMatchObject({ slug: 'fintech', cluster: 'technology', metricCalculator: 'fintech-payments', built: true });
    expect(fintech.importTargets).toEqual(['BILLING_INVOICE_LINE', 'FINTECH_LOAN_TAPE', 'FINTECH_AML_ALERT', 'FINTECH_PROCESSOR_VOLUME', 'FINTECH_LICENCES']);
    // The T-058 rules stay, first and unchanged; the payments, licence, compliance and trend rules follow.
    expect(fintech.findingRules.slice(0, 3)).toEqual(['fintech-credit-loss', 'fintech-aml-unreviewed', 'fintech-partner-bank-coc']);
    expect(fintech.findingRules).toHaveLength(13);
    // Five years of history (T-184): the driver trends come last.
    expect(fintech.findingRules.slice(-2)).toEqual(['fintech-take-rate-trend', 'fintech-loss-rate-trend']);
    expect(fintech.documentCategories).toEqual(['REGULATORY_LICENCE', 'SPONSOR_BANK_AGREEMENT', 'PCI_ATTESTATION', 'AML_PROGRAM', 'REGULATORY_EXAM']);
    for (const target of fintech.importTargets.slice(1)) expect(IMPORT_TARGET_DEFINITIONS[target].refusesPeopleColumns, target).toBe(true);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.FINTECH_PROCESSOR_VOLUME, ['month', 'processor', 'gross_volume', 'transactions', 'net_revenue', 'chargeback_count'])).toEqual([]);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.FINTECH_LICENCES, ['licence_id', 'kind', 'email'])).toHaveLength(1);
  });

  it('Healthcare reads remittances, collections by clinician and the credentialing and payer contract registers, and its compliance documents (T-160)', () => {
    const healthcare = PACKS.HEALTHCARE;
    expect(healthcare).toMatchObject({ slug: 'healthcare', cluster: 'healthcare', metricCalculator: 'healthcare-collections', built: true });
    expect(healthcare.importTargets.slice(0, 3)).toEqual(['BILLING_INVOICE_LINE', 'HEALTHCARE_CLAIMS_SUMMARY', 'HEALTHCARE_PROVIDER_ROSTER']);
    // The T-061 rules stay, first and unchanged (the clinics and hospitals packs reuse them); the T-160 rules follow.
    expect(healthcare.findingRules.slice(0, 4)).toEqual(['healthcare-government-concentration', 'healthcare-director-fee', 'healthcare-privacy-assessment', 'healthcare-credentials-expiring']);
    expect(healthcare.findingRules).toHaveLength(15);
    expect(healthcare.documentCategories).toEqual(['LICENCE_VERIFICATION', 'CODING_AUDIT', 'HIPAA_RISK_ASSESSMENT', 'PAYER_CONTRACT', 'RESTRICTIVE_COVENANTS']);
    for (const target of healthcare.importTargets.slice(1)) expect(IMPORT_TARGET_DEFINITIONS[target].refusesPeopleColumns, target).toBe(true);
    // Clinicians only as pseudonymous references: a name or a pay column is refused.
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.HEALTHCARE_CLINICIAN_COLLECTIONS, ['month', 'provider_ref', 'collected'])).toEqual([]);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.HEALTHCARE_CLINICIAN_COLLECTIONS, ['month', 'provider_ref', 'full_name', 'salary'])).toHaveLength(2);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.HEALTHCARE_REMITTANCES, ['month', 'payer', 'patient_id'])).toHaveLength(1);
    // Hospitals is untouched; small clinics reuses the T-160 set by reference (below).
    expect(PACKS.HOSPITALS.findingRules).not.toContain('healthcare-credentialing');
  });

  it('Small clinics reuses the T-160 evidence set and adds service lines, referrals and the lease (T-161)', () => {
    const clinics = PACKS.SMALL_CLINICS;
    expect(clinics).toMatchObject({ slug: 'small-clinics', cluster: 'healthcare', metricCalculator: 'clinics-practice', built: true });
    // The T-068 targets and rules stay first and unchanged.
    expect(clinics.importTargets.slice(0, 4)).toEqual(['BILLING_INVOICE_LINE', 'CLINICS_PATIENT_VOLUME', 'CLINICS_EQUIPMENT', 'CLINICS_CODING_SUMMARY']);
    expect(clinics.findingRules.slice(0, 3)).toEqual(['clinics-provider-carries-site', 'clinics-coding-above-policy', 'clinics-equipment-past-life']);
    // The T-160 targets and rules by reference: the same ids, never copies.
    for (const target of ['HEALTHCARE_REMITTANCES', 'HEALTHCARE_CLINICIAN_COLLECTIONS', 'HEALTHCARE_CREDENTIALS', 'HEALTHCARE_PAYER_CONTRACTS'] as const) expect(clinics.importTargets).toContain(target);
    for (const rule of ['healthcare-practice-claims', 'healthcare-collections-trend', 'healthcare-payer-mix-shift', 'healthcare-credentialing', 'healthcare-payer-contracts']) {
      expect(PACKS.HEALTHCARE.findingRules).toContain(rule);
      expect(clinics.findingRules).toContain(rule);
    }
    expect(clinics.findingRules).not.toContain('healthcare-clinician-concentration');
    expect(clinics.findingRules.slice(-6)).toEqual(['clinics-owner-dependence', 'clinics-referral-concentration', 'clinics-premises', 'clinics-pnl-trend', 'clinics-pnl-margin-drift', 'clinics-pnl-expense-outpacing']);
    expect(expectedInputs(clinics).find((input) => input.id === 'LEASE')).toEqual({ id: 'LEASE', need: 'REQUIRED' });
    expect(expectedInputs(PACKS.HEALTHCARE).find((input) => input.id === 'LEASE')).toEqual({ id: 'LEASE', need: 'OPTIONAL' });
    // Providers and referral sources: pseudonymous references and organisations only.
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.CLINICS_SERVICE_LINES, ['month', 'service_line', 'provider_ref', 'collected'])).toEqual([]);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.CLINICS_SERVICE_LINES, ['month', 'provider_ref', 'full_name', 'salary'])).toHaveLength(2);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.CLINICS_REFERRALS, ['month', 'referral_source', 'patient_name'])).toHaveLength(1);
  });

  it('Pharma & biotech reads the pipeline against the registry records, the patent estate, the obligations model and the R&D roster (T-163)', () => {
    const pharma = PACKS.PHARMA_BIOTECH;
    expect(pharma).toMatchObject({ slug: 'pharma-biotech', cluster: 'life-sciences', metricCalculator: 'pharma-pipeline', built: true, valuationMethods: ['DCF'] });
    expect(pharma.importTargets).toEqual(['BILLING_INVOICE_LINE', 'PHARMA_PATENTS', 'PHARMA_TRIAL_REGISTRY', 'PHARMA_PIPELINE', 'PHARMA_OBLIGATIONS', 'PHARMA_RD_ROSTER']);
    // The T-064 rules stay, first and unchanged.
    expect(pharma.findingRules.slice(0, 3)).toEqual(['pharma-patent-before-forecast', 'pharma-supplier-observations', 'pharma-partner-concentration']);
    expect(pharma.findingRules).toHaveLength(12);
    expect(pharma.documentCategories).toEqual(['REGULATORY_CORRESPONDENCE', 'PATENT_RECORD', 'LICENCE_AGREEMENT', 'SUPPLY_AGREEMENT']);
    for (const target of pharma.importTargets.slice(1)) expect(IMPORT_TARGET_DEFINITIONS[target].refusesPeopleColumns, target).toBe(true);
    expect(IMPORT_TARGET_DEFINITIONS.PHARMA_RD_ROSTER.people).toBe('PSEUDONYMOUS');
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.PHARMA_RD_ROSTER, ['scientist_ref', 'function', 'programmes_led', 'patent_families'])).toEqual([]);
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.PHARMA_RD_ROSTER, ['scientist_ref', 'full_name', 'salary'])).toHaveLength(2);
  });

  it('E-commerce & DTC reads orders by channel, the stock report and the platform-account documents (T-164)', () => {
    const ecommerce = PACKS.ECOMMERCE_DTC;
    expect(ecommerce).toMatchObject({ slug: 'ecommerce-dtc', cluster: 'consumer', metricCalculator: 'ecommerce-channels', built: true, valuationMethods: ['DCF', 'ARR_MULTIPLE'] });
    expect(ecommerce.importTargets).toEqual(['BILLING_INVOICE_LINE', 'ECOMMERCE_COHORTS', 'ECOMMERCE_AD_SPEND', 'ECOMMERCE_CHANNEL_ORDERS', 'ECOMMERCE_INVENTORY']);
    // The T-065 rules stay, first and unchanged.
    expect(ecommerce.findingRules.slice(0, 3)).toEqual(['ecommerce-marketplace-majority', 'ecommerce-cohort-repeat-decline', 'ecommerce-channel-cac-rising']);
    expect(ecommerce.findingRules).toHaveLength(12);
    expect(ecommerce.documentCategories).toEqual(['PLATFORM_ACCOUNT_RECORD', 'MARKETPLACE_AGREEMENT']);
    for (const target of ecommerce.importTargets.slice(1)) expect(IMPORT_TARGET_DEFINITIONS[target]).toMatchObject({ people: 'NONE', refusesPeopleColumns: true });
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.ECOMMERCE_CHANNEL_ORDERS, ['month', 'channel', 'customer_email'])).toHaveLength(1);
  });

  it('IT & professional services reads time and billing, the ageing reports and the covenant register (T-167)', () => {
    const services = PACKS.PROFESSIONAL_SERVICES;
    expect(services).toMatchObject({ slug: 'professional-services', cluster: 'services', metricCalculator: 'services-practice', built: true, valuationMethods: ['DCF', 'ARR_MULTIPLE'] });
    expect(services.importTargets).toEqual(['BILLING_INVOICE_LINE', 'SERVICES_TIMESHEETS', 'SERVICES_HEADCOUNT', 'SERVICES_TIME_BILLING', 'SERVICES_AGEING']);
    // The T-063 rules stay, first and unchanged.
    expect(services.findingRules.slice(0, 3)).toEqual(['services-utilization-gap', 'services-client-termination', 'services-delivery-attrition']);
    expect(services.findingRules).toHaveLength(12);
    expect(services.documentCategories).toEqual(['COVENANT_REGISTER']);
    expect(IMPORT_TARGET_DEFINITIONS.SERVICES_TIME_BILLING).toMatchObject({ people: 'PSEUDONYMOUS', refusesPeopleColumns: true });
    expect(IMPORT_TARGET_DEFINITIONS.SERVICES_AGEING).toMatchObject({ people: 'NONE', refusesPeopleColumns: true });
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.SERVICES_TIME_BILLING, ['month', 'fee_earner', 'full_name', 'salary'])).toHaveLength(2);
  });

  it('Telecom & media reads subscriber movements, the rights register, counterparty revenue and capex (T-168)', () => {
    const telecom = PACKS.TELECOM_MEDIA;
    expect(telecom).toMatchObject({ slug: 'telecom-media', cluster: 'technology', metricCalculator: 'telecom-subscribers', built: true, valuationMethods: ['ARR_MULTIPLE', 'DCF'] });
    expect(telecom.importTargets).toEqual(['BILLING_INVOICE_LINE', 'TELECOM_SUBSCRIBERS', 'TELECOM_SUBSCRIBER_MOVEMENTS', 'TELECOM_AGREEMENTS', 'TELECOM_REVENUE_STREAMS', 'TELECOM_CAPEX']);
    // The T-062 rules stay, first and unchanged.
    expect(telecom.findingRules.slice(0, 4)).toEqual(['telecom-reported-subscribers', 'telecom-churn-turning', 'telecom-regional-concentration', 'telecom-wholesale-review']);
    expect(telecom.findingRules).toHaveLength(13);
    expect(telecom.documentCategories).toEqual(['RIGHTS_AGREEMENT']);
    for (const target of ['TELECOM_SUBSCRIBER_MOVEMENTS', 'TELECOM_AGREEMENTS', 'TELECOM_REVENUE_STREAMS', 'TELECOM_CAPEX'] as const) expect(IMPORT_TARGET_DEFINITIONS[target]).toMatchObject({ people: 'NONE', refusesPeopleColumns: true });
    expect(peopleColumnProblems(IMPORT_TARGET_DEFINITIONS.TELECOM_SUBSCRIBER_MOVEMENTS, ['month', 'region', 'subscriber_email', 'full_name'])).toHaveLength(2);
  });

  it('every pack offers billing first, and only targets that exist (rule ids resolve in the API test)', () => {
    for (const id of PACK_IDS) {
      const pack = PACKS[id];
      expect(pack.importTargets[0], id).toBe('BILLING_INVOICE_LINE');
      for (const target of pack.importTargets) expect(IMPORT_TARGET_DEFINITIONS[target], `${id}: ${target}`).toBeDefined();
      expect(pack.valuationMethods.length, id).toBeGreaterThan(0);
    }
  });

  it('every pack is built; OTHER and unknown read the software core', () => {
    expect(PACK_IDS.filter((id) => !PACKS[id].built)).toEqual([]);
    expect(sourcesFor('FINTECH').packAvailable).toBe(true);
    expect(packFor('OTHER').id).toBe('SOFTWARE_SAAS');
    expect(packFor(null).id).toBe('SOFTWARE_SAAS');
    expect(packFor('HOTELS').slug).toBe('hotels');
  });

  it('the five new seller types get a source plan', () => {
    for (const type of ['COMMERCIAL_PROPERTY', 'HOTELS', 'SMALL_CLINICS', 'HOSPITALS'] as const) {
      expect(sourcesFor(type).sources.map((source) => source.kind), type).toEqual(PACKS[type].built ? ['BILLING', 'DOCUMENTS', 'INDUSTRY'] : ['BILLING', 'DOCUMENTS']);
    }
    // A built pack with sector extracts adds them as a source to collect (T-060).
    expect(sourcesFor('MULTIFAMILY').sources.map((source) => source.kind)).toEqual(['BILLING', 'DOCUMENTS', 'INDUSTRY']);
    expect(sourcesFor('FINTECH').sources.map((source) => source.kind)).toEqual(['BILLING', 'CODE', 'DELIVERY', 'DOCUMENTS', 'INDUSTRY']);
    expect(sourcesFor('SOFTWARE_SAAS').sources.map((source) => source.kind)).not.toContain('INDUSTRY');
  });

  it('pack extract uploads count as the Industry data source', () => {
    expect(sourceKindForProvider('pack_upload')).toBe('INDUSTRY');
    expect(sourceKindForProvider('billing_upload')).toBe('BILLING');
  });
});

describe('pack import targets (ADR 0010)', () => {
  // A pack-style target, as T-058+ will add (no DB enum value needed for a unit test).
  const RENT_ROLL = {
    target: 'BILLING_INVOICE_LINE',
    label: 'Rent roll',
    fileName: 'rent-roll.csv',
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
