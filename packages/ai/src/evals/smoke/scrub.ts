import type { CitableSource } from '../../context';

/**
 * Lane smoke set for the consistency checks (T-132, job type `contract_scrub`). Synthetic documents
 * with known answers, not a bake-off: the planted agreement carries one error of each common kind,
 * and the clean agreement carries none. Recorded responses replay in CI; `live` runs the same
 * documents against a real lane before it is enabled.
 */
const PLANTED = '01920000-0000-7000-8000-00000000d5c1';
const CLEAN = '01920000-0000-7000-8000-00000000d5c2';
export const SCRUB_PAGE_IDS = {
  planted1: '01920000-0000-7000-8000-0000000c5001',
  planted2: '01920000-0000-7000-8000-0000000c5002',
  clean1: '01920000-0000-7000-8000-0000000c5101',
} as const;

const page = (citationId: string, documentId: string, documentName: string, pageNumber: number, text: string): CitableSource => ({
  citationId,
  documentId,
  documentName,
  pageNumber,
  text,
  classification: 'BUSINESS',
});

export const PLANTED_AGREEMENT: readonly CitableSource[] = [
  page(
    SCRUB_PAGE_IDS.planted1,
    PLANTED,
    'TroubledCo - Harbor reseller agreement (synthetic).txt',
    1,
    `RESELLER AGREEMENT
This Reseller Agreement (the "Agreement") is made between TroubledCo Systems, Inc. ("Supplier") and Harbor Distribution LLC ("Reseller").
1. DEFINITIONS. "Territory" means the United States. "Products" means the Supplier software listed in Schedule A.
2. APPOINTMENT. Supplier appoints Reseller as a non-exclusive reseller of the Products to Qualified Customers in the Territory.
3. TERM. This Agreement has an initial term of two (2) years.`,
  ),
  page(
    SCRUB_PAGE_IDS.planted2,
    PLANTED,
    'TroubledCo - Harbor reseller agreement (synthetic).txt',
    2,
    `4. FEES. Reseller shall pay the fees in Schedule A within thirty (30) days of invoice.
5. TERMINATION. Either party may terminate as provided in Section 9.
6. TERM OF COMMITMENT. The initial term of this Agreement is three (3) years.
7. NOTICES. Notices to Harbour Distribution, Inc. are sent to the address on the signature page.`,
  ),
];

export const CLEAN_AGREEMENT: readonly CitableSource[] = [
  page(
    SCRUB_PAGE_IDS.clean1,
    CLEAN,
    'HealthyCo - Atlas services agreement (synthetic).txt',
    1,
    `SERVICES AGREEMENT
This Services Agreement (the "Agreement") is made between HealthyCo Software, Inc. ("Provider") and Atlas Freight LLC ("Client").
1. SERVICES. Provider shall perform the Services described in Section 2.
2. DESCRIPTION. "Services" means implementation and support of the Provider platform.
3. TERM. This Agreement has a term of one (1) year. Either party may terminate under Section 4.
4. TERMINATION. Either party may terminate on sixty (60) days' written notice to the other.`,
  ),
];

const cite = (citationId: string, quote: string) => ({ citationId, quote });

export interface ScrubCase {
  readonly id: string;
  readonly sources: readonly CitableSource[];
  readonly responses: readonly string[];
  /** Expected drafted finding kinds, each with the page numbers it must cite. */
  readonly expect: readonly { kind: string; pages: readonly number[] }[];
}

export const SCRUB_CASES: readonly ScrubCase[] = [
  {
    id: 'scrub.planted',
    sources: PLANTED_AGREEMENT,
    responses: [
      JSON.stringify({
        findings: [
          {
            kind: 'UNDEFINED_TERM',
            title: '"Qualified Customers" is used but never defined',
            explanation: 'Section 2 limits the appointment to Qualified Customers, a capitalized term that Section 1 does not define.',
            severity: 'MEDIUM',
            citations: [cite(SCRUB_PAGE_IDS.planted1, 'reseller of the Products to Qualified Customers in the Territory')],
          },
          {
            kind: 'BROKEN_CROSS_REFERENCE',
            title: 'Section 9 is referenced but does not exist',
            explanation: 'Section 5 points to Section 9 for termination rights; the agreement ends at Section 7. The pages given may be incomplete.',
            severity: 'LOW',
            citations: [cite(SCRUB_PAGE_IDS.planted2, 'Either party may terminate as provided in Section 9.')],
          },
          {
            kind: 'INTERNAL_CONTRADICTION',
            title: 'Initial term is two years in Section 3 and three years in Section 6',
            explanation: 'The two sections state different initial terms for the same agreement.',
            severity: 'HIGH',
            citations: [
              cite(SCRUB_PAGE_IDS.planted1, 'This Agreement has an initial term of two (2) years.'),
              cite(SCRUB_PAGE_IDS.planted2, 'The initial term of this Agreement is three (3) years.'),
            ],
          },
          {
            kind: 'PARTY_NAME_MISMATCH',
            title: 'Reseller named as "Harbour Distribution, Inc." in Notices',
            explanation: 'The Reseller is defined as Harbor Distribution LLC; Section 7 uses a different spelling and entity type.',
            severity: 'MEDIUM',
            citations: [
              cite(SCRUB_PAGE_IDS.planted1, 'Harbor Distribution LLC ("Reseller")'),
              cite(SCRUB_PAGE_IDS.planted2, 'Notices to Harbour Distribution, Inc.'),
            ],
          },
        ],
      }),
    ],
    expect: [
      { kind: 'UNDEFINED_TERM', pages: [1] },
      { kind: 'BROKEN_CROSS_REFERENCE', pages: [2] },
      { kind: 'INTERNAL_CONTRADICTION', pages: [1, 2] },
      { kind: 'PARTY_NAME_MISMATCH', pages: [1, 2] },
    ],
  },
  { id: 'scrub.clean', sources: CLEAN_AGREEMENT, responses: [JSON.stringify({ findings: [] })], expect: [] },
];

/** A recorded answer that invents a problem with a quote not in the file: it must never be drafted. */
export const SCRUB_PROBES: readonly ScrubCase[] = [
  {
    id: 'probe.scrub-invented',
    sources: CLEAN_AGREEMENT,
    responses: [
      JSON.stringify({
        findings: [
          {
            kind: 'BROKEN_CROSS_REFERENCE',
            title: 'Exhibit C is referenced but missing',
            explanation: 'Invented: the clean agreement has no Exhibit C reference.',
            severity: 'HIGH',
            citations: [cite(SCRUB_PAGE_IDS.clean1, 'as set out in Exhibit C')],
          },
        ],
      }),
    ],
    expect: [],
  },
];
