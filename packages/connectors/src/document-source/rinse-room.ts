import { createHash } from 'node:crypto';
import { RINSE_MANIFEST_FILE, RINSE_MANIFEST_SCHEMA, RINSE_MANIFEST_VERSION, type RinseManifest, type RinseManifestDocument } from '@pactlab/contracts';
import { auditConversion, check, HAND_ENTRY_VERSION, PACKS, readDocument, renderHandEntry, rinseGaps, type GapResolution } from '@pactlab/domain';
import type { FixtureFile, FixtureRoom } from './fixture-rooms';

/**
 * A folder finished by Pactlab Rinse (T-178), as the seller uploads it: originals, their canonical copies
 * under `rinsed/`, a hand-sourced vacancy schedule, and a hand-built `pactlab-manifest.json` naming each
 * file by its SHA-256. Fixture rooms carry text, so the canonical copies here are text renderings of what
 * Rinse writes as normalized PDFs. Everything is invented.
 */
const lines = (...rows: string[]) => rows.join('\n');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const AT = '2026-11-20T09:00:00.000Z';
const PREPARER = { userId: '0193a1b2-0000-7000-8000-00000000a001', name: 'Dana Whitlow', organization: 'Harbour Lane Apartments LLC (synthetic)' };
const id = (n: number) => `0193a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`;

const INCOME = lines(
  'Harbour Lane Apartments LLC — income statement, year to 30 September 2026 (synthetic)',
  'Statement date: 2026-09-30',
  'Rental income: USD 1,642,000',
  'Other income: USD 58,000',
  'Total revenue: USD 1,700,000',
);
// The seller's own balance sheet does not foot: a source discrepancy that travels as a noted gap.
const BALANCE = lines(
  'Harbour Lane Apartments LLC — balance sheet at 30 September 2026 (synthetic)',
  'Cash: USD 420,000',
  'Tenant receivables: USD 38,000',
  'Total current assets: USD 468,000',
  'Mortgage loan, Aire Valley Bank: USD 14,200,000',
);
const LEASE = lines('COMMERCIAL LEASE — GROUND FLOOR RETAIL UNIT (synthetic)', 'Landlord: Harbour Lane Apartments LLC. Tenant: Quayside Coffee Ltd.', 'Term: 2024-03-01 to 2029-02-28. Annual rent: USD 42,000.');
const RENT_ROLL = lines('unit,building,type,sqft,status,lease_start,lease_end,in_place_rent,market_rent,balance_due', '101,A,1BR,680,occupied,2025-11-01,2026-10-31,1240.00,1310.00,0.00', '102,A,2BR,910,vacant,,,0.00,1620.00,0.00');
const T12 = lines('month,rental_income,other_income,operating_expenses,net_operating_income', '2026-08,137100.00,4800.00,58900.00,83000.00', '2026-09,136900.00,4850.00,59200.00,82550.00');
const VACANCY_ROWS = [{ period: '2026-09', unitType: 'All', units: '120', occupiedUnits: '106', averageRent: '1450' }];
const VACANCY = renderHandEntry('VACANCY_SCHEDULE', VACANCY_ROWS, PREPARER, AT, 'USD').join('\n');

const file = (folder: string, name: string, text: string): FixtureFile => ({ folder, name, text, version: 1 });
const ref = (path: string, text: string, mediaType: string) => ({ path, sha256: hash(text), sizeBytes: Buffer.byteLength(text), mediaType });
const log = (step: RinseManifestDocument['conversionLog'][number]['step'], tool: string) => ({ at: AT, step, tool, detail: null });

function converted(n: number, folder: string, name: string, text: string, category: string): RinseManifestDocument {
  const reading = readDocument([text]);
  const audit = auditConversion(reading, reading);
  return {
    id: id(n),
    source: 'FILE',
    original: ref(`${folder}/${name}`, text, 'text/markdown'),
    converted: { ...ref(`rinsed/${folder}/${name}`, text, 'text/markdown'), pages: 1, anchors: ['p1'] },
    route: 'CONVERT',
    classification: { category, by: 'AI', confidence: 0.96, promptVersion: 'document.classify@1' },
    metadata: { title: text.split('\n')[0] ?? null, dates: [...reading.dates], parties: [...reading.parties] },
    checks: audit.sourceDiscrepancies.map((discrepancy) => check('SOURCE_DISCREPANCY', `The original does not foot — ${discrepancy.label} on page ${discrepancy.page} states ${discrepancy.stated}; its lines sum to ${discrepancy.computed}.`)),
    conversionLog: [log('INSPECTED', 'rinse-1'), log('CONVERTED', 'fixture'), log('TEXT_EXTRACTED', 'fixture'), log('AUDITED', audit.version), log('CLASSIFIED', 'document.classify@1')],
    audit: { ...audit, originalReadBy: 'TEXT_LAYER', mismatches: [], sourceDiscrepancies: [...audit.sourceDiscrepancies] },
    handEntry: null,
    duplicateOf: null,
  };
}

function asIs(n: number, folder: string, name: string, text: string, category: string): RinseManifestDocument {
  return {
    id: id(n),
    source: 'FILE',
    original: ref(`${folder}/${name}`, text, 'text/csv'),
    converted: null,
    route: 'GUIDED_IMPORT',
    classification: { category, by: 'PERSON', confidence: null, promptVersion: null },
    metadata: { title: name, dates: [], parties: [] },
    checks: [check('GUIDED_IMPORT', 'A spreadsheet or statement: kept as it is and packaged for guided import in the pact, never flattened.')],
    conversionLog: [log('INSPECTED', 'rinse-1'), log('PACKAGED_FOR_IMPORT', 'rinse-1')],
    audit: null,
    handEntry: null,
    duplicateOf: null,
  };
}

const DOCUMENTS: RinseManifestDocument[] = [
  converted(1, 'Financials', 'Income statement FY2026.md', INCOME, 'INCOME_STATEMENT'),
  converted(2, 'Financials', 'Balance sheet Sept 2026.md', BALANCE, 'BALANCE_SHEET'),
  converted(3, 'Leases', 'Retail unit lease.md', LEASE, 'LEASE'),
  asIs(4, 'Rent roll', 'Rent roll Sept 2026.csv', RENT_ROLL, 'MULTIFAMILY_RENT_ROLL'),
  asIs(5, 'Operating', 'T-12 Oct25-Sep26.csv', T12, 'MULTIFAMILY_T12'),
  {
    id: id(6),
    source: 'HAND_ENTRY',
    original: null,
    converted: { ...ref('hand-sourced/Vacancy and occupancy schedule.md', VACANCY, 'text/markdown'), pages: 1, anchors: ['p1'] },
    route: 'CONVERT',
    classification: { category: 'MULTIFAMILY_OCCUPANCY', by: 'PERSON', confidence: null, promptVersion: null },
    metadata: { title: 'Vacancy and occupancy schedule', dates: [], parties: [] },
    checks: [],
    conversionLog: [log('GENERATED', HAND_ENTRY_VERSION)],
    audit: null,
    handEntry: { form: 'VACANCY_SCHEDULE', formVersion: HAND_ENTRY_VERSION, rows: VACANCY_ROWS, currency: 'USD', enteredBy: PREPARER, enteredAt: AT, revision: 1 },
    duplicateOf: null,
  },
];

const RESOLUTIONS: GapResolution[] = [
  { input: 'MULTIFAMILY_DELINQUENCY', kind: 'NOTED', note: 'The property manager is preparing the September delinquency report; it follows next week.' },
  { input: 'MULTIFAMILY_INSPECTION', kind: 'NOT_APPLICABLE', note: 'No unit inspection has been carried out in the last two years.' },
];

const GAPS = rinseGaps(
  PACKS.MULTIFAMILY,
  DOCUMENTS.map((document) => ({ id: document.id, category: document.classification?.category ?? null, excluded: false, flagged: document.checks.some((item) => item.severity !== 'INFO'), handEntry: document.handEntry?.form ?? null })),
  RESOLUTIONS,
).map((gap) => ({ ...gap, documentIds: [...gap.documentIds] }));

export const RINSED_FIXTURE_MANIFEST: RinseManifest = {
  schema: RINSE_MANIFEST_SCHEMA,
  version: RINSE_MANIFEST_VERSION,
  generator: { app: 'Pactlab Rinse', version: '0.1.0' },
  set: { id: id(100), name: 'Harbour Lane Apartments — diligence set (synthetic)', pack: 'MULTIFAMILY', createdAt: AT, readyAt: AT, preparedBy: PREPARER, intendedPact: null },
  documents: DOCUMENTS,
  gaps: GAPS,
};

export const RINSED_FIXTURE_ROOM: FixtureRoom = {
  id: 'harbour-lane-rinsed',
  label: 'Harbour Lane Apartments — folder finished in Pactlab Rinse (synthetic)',
  files: [
    file('', RINSE_MANIFEST_FILE, JSON.stringify(RINSED_FIXTURE_MANIFEST, null, 2)),
    file('Financials', 'Income statement FY2026.md', INCOME),
    file('Financials', 'Balance sheet Sept 2026.md', BALANCE),
    file('Leases', 'Retail unit lease.md', LEASE),
    file('Rent roll', 'Rent roll Sept 2026.csv', RENT_ROLL),
    file('Operating', 'T-12 Oct25-Sep26.csv', T12),
    file('rinsed/Financials', 'Income statement FY2026.md', INCOME),
    file('rinsed/Financials', 'Balance sheet Sept 2026.md', BALANCE),
    file('rinsed/Leases', 'Retail unit lease.md', LEASE),
    file('hand-sourced', 'Vacancy and occupancy schedule.md', VACANCY),
  ],
  expect: {
    categories: { 'Income statement FY2026.md': 'INCOME_STATEMENT', 'Balance sheet Sept 2026.md': 'BALANCE_SHEET', 'Retail unit lease.md': 'LEASE', 'Rent roll Sept 2026.csv': 'MULTIFAMILY_RENT_ROLL', 'T-12 Oct25-Sep26.csv': 'MULTIFAMILY_T12' },
    duplicates: [],
    // Nothing is ambiguous or misfiled once rinsed; these name the files that carry a noted point instead:
    // the balance sheet that does not foot, and the commercial lease in a residential set.
    ambiguous: 'Balance sheet Sept 2026.md',
    misfiled: 'Retail unit lease.md',
    gaps: ['MULTIFAMILY_DELINQUENCY'],
  },
};
