import { IMPORT_TARGET_DEFINITIONS } from '../imports/targets';
import type { ImportTarget } from '../imports/targets';
import type { PackDefinition } from '../packs/registry';

/**
 * Document intake (T-098, ADR 0016). Every file that arrives — uploaded one
 * by one, unpacked from a zip, or read from a connected data room — is read
 * by the AI and filed under one category. The category decides where the
 * file goes next. A person is asked only when the AI is unsure.
 */

/** What happens to a file once its category is settled. */
export type IntakeRoute =
  /** Structured rows: the pack's import mapping for this target (ADR 0010). */
  | { readonly kind: 'IMPORT'; readonly target: ImportTarget }
  /** The T-094 B9 balance-sheet reader: debt and cash lines, confirmed before the bridge. */
  | { readonly kind: 'BALANCE_SHEET' }
  /** Contract extraction into DRAFT findings for review. */
  | { readonly kind: 'EXTRACT' }
  /** Kept and listed under its category; nothing is extracted from it yet. */
  | { readonly kind: 'FILE' };

/** Categories for documents that are not one of the import targets. */
export const DOCUMENT_CATEGORIES = [
  'BALANCE_SHEET',
  'INCOME_STATEMENT',
  'CASH_FLOW_STATEMENT',
  'CUSTOMER_CONTRACT',
  'SUPPLIER_CONTRACT',
  'LEASE',
  'LOAN_AGREEMENT',
  'CORPORATE_RECORD',
  'POLICY',
  'PEOPLE_RECORD',
  'OTHER',
] as const;
/**
 * Categories a pack adds on top of the common ones (`PackDefinition.documentCategories`).
 * A multifamily syndication (T-106) reads its offering documents: the PPM, the operating
 * agreement and the investor deck, whose terms and claims are extracted for the sponsor to confirm.
 */
export const OFFERING_CATEGORIES = ['OFFERING_PPM', 'OPERATING_AGREEMENT', 'INVESTOR_DECK'] as const;
export type OfferingCategory = (typeof OFFERING_CATEGORIES)[number];
/**
 * A music catalog (T-140) is diligenced from its rights documents: royalty statements, split
 * sheets, publishing and administration agreements, Copyright Office records and lien searches.
 * Their entries are read on the Catalog page for a person to confirm.
 */
export const MUSIC_CATEGORIES = ['ROYALTY_STATEMENT', 'SPLIT_SHEET', 'PUBLISHING_AGREEMENT', 'COPYRIGHT_RECORD', 'LIEN_SEARCH'] as const;
export type MusicCategory = (typeof MUSIC_CATEGORIES)[number];
/**
 * A startup equity SPV (T-141) reads two sets of documents: the startup's round (the round
 * summary or deck, the signed SAFEs and notes) and the vehicle's own (the operating agreement,
 * the investor-facing summary, side letters and the Form D). The SPV page and the pack checks
 * read them; nothing in them is shared with investors except what the organizer publishes.
 */
export const SPV_CATEGORIES = ['ROUND_SUMMARY', 'CONVERTIBLE_INSTRUMENT', 'SPV_OPERATING_AGREEMENT', 'SPV_INVESTOR_SUMMARY', 'SIDE_LETTER', 'FORM_D'] as const;
export type SpvCategory = (typeof SPV_CATEGORIES)[number];
/**
 * An energy package (T-142) is diligenced from its title opinions, leases, division orders,
 * third-party reserve reports, power purchase agreements and environmental reports and permits.
 * Their entries are read on the Assets page for a person to confirm.
 */
export const ENERGY_CATEGORIES = ['TITLE_OPINION', 'OIL_GAS_LEASE', 'DIVISION_ORDER', 'RESERVE_REPORT', 'POWER_PURCHASE_AGREEMENT', 'ENVIRONMENTAL_REPORT'] as const;
export type EnergyCategory = (typeof ENERGY_CATEGORIES)[number];
/**
 * A fintech target (T-159) is diligenced from its licences and sponsor-bank agreements and from its
 * compliance evidence: the PCI attestation, the KYC/AML programme and regulatory exam reports or
 * consent orders. The Payments page reads their status and dates; absence is shown as absence.
 */
export const FINTECH_CATEGORIES = ['REGULATORY_LICENCE', 'SPONSOR_BANK_AGREEMENT', 'PCI_ATTESTATION', 'AML_PROGRAM', 'REGULATORY_EXAM'] as const;
export type FintechCategory = (typeof FINTECH_CATEGORIES)[number];
/**
 * A healthcare services target (T-160) is diligenced from its licence verifications, its coding and
 * billing audits, its HIPAA risk assessment, its payer contracts and the schedule of clinicians bound by
 * a non-compete or retention agreement. The Practice page reads their presence and dates; absence is
 * shown as absence.
 */
export const HEALTHCARE_CATEGORIES = ['LICENCE_VERIFICATION', 'CODING_AUDIT', 'HIPAA_RISK_ASSESSMENT', 'PAYER_CONTRACT', 'RESTRICTIVE_COVENANTS'] as const;
export type HealthcareCategory = (typeof HEALTHCARE_CATEGORIES)[number];
/**
 * A pharma or biotech target (T-163) is diligenced from documents: its trial-registry filings and
 * regulatory correspondence (which the pipeline's claims are checked against), its patent certificates
 * and records, its licence and collaboration agreements (whose milestones, royalties and fees are
 * recomputed) and its manufacturing and supply agreements. The Pipeline page reads them; absence is
 * shown as absence.
 */
export const PHARMA_CATEGORIES = ['REGULATORY_CORRESPONDENCE', 'PATENT_RECORD', 'LICENCE_AGREEMENT', 'SUPPLY_AGREEMENT'] as const;
export type PharmaCategory = (typeof PHARMA_CATEGORIES)[number];
/**
 * An e-commerce or DTC brand (T-164) is diligenced from its platform account records (who the storefront,
 * marketplace and ad accounts are registered to), its marketplace and channel agreements, and the
 * investor presentation whose unit-economics claims are checked against the exports. The Channels page
 * reads them; absence is shown as absence.
 */
export const ECOMMERCE_CATEGORIES = ['PLATFORM_ACCOUNT_RECORD', 'MARKETPLACE_AGREEMENT'] as const;
export type EcommerceCategory = (typeof ECOMMERCE_CATEGORIES)[number];
/**
 * An IT or professional services firm (T-167) is diligenced for the people its fees depend on: the
 * register of non-compete and non-solicitation covenants that bind its partners and other revenue-carrying
 * staff, by pseudonymous reference. The Practice page reads it against each rainmaker's book; absence is
 * shown as absence. The covenants' pay terms are not part of it.
 */
export const SERVICES_CATEGORIES = ['COVENANT_REGISTER'] as const;
export type ServicesCategory = (typeof SERVICES_CATEGORIES)[number];
/**
 * A telecom or media business (T-168) is diligenced on the agreements its content and distribution run on:
 * content licences, affiliate, carriage and sports-rights agreements, each read for its end date and
 * renewal against the expected closing. Absence is shown as absence.
 */
export const TELECOM_CATEGORIES = ['RIGHTS_AGREEMENT'] as const;
export type TelecomCategory = (typeof TELECOM_CATEGORIES)[number];
/** Every category a pack may add on top of the common ones. */
export type PackDocumentCategory = OfferingCategory | MusicCategory | EnergyCategory | SpvCategory | FintechCategory | HealthcareCategory | PharmaCategory | EcommerceCategory | ServicesCategory | TelecomCategory;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number] | PackDocumentCategory;

/** A file's category: a document category or one of the import targets. */
export type IntakeCategory = DocumentCategory | ImportTarget;

export interface CategoryDefinition {
  readonly id: IntakeCategory;
  readonly label: string;
  /** What the AI is told the category means. */
  readonly description: string;
  readonly route: IntakeRoute;
  /**
   * Named people data (rule 7). A file filed here is excluded from any
   * further AI processing, whatever its upload classification said.
   */
  readonly people: boolean;
}

const DOCUMENT_DEFINITIONS: Readonly<Record<DocumentCategory, CategoryDefinition>> = {
  BALANCE_SHEET: {
    id: 'BALANCE_SHEET',
    label: 'Balance sheet',
    description: 'Statement of financial position: assets, liabilities and equity at a date, including debt and cash.',
    route: { kind: 'BALANCE_SHEET' },
    people: false,
  },
  INCOME_STATEMENT: {
    id: 'INCOME_STATEMENT',
    label: 'Income statement (P&L)',
    description: 'Profit and loss, income statement or management accounts: revenue, costs and profit over a period.',
    route: { kind: 'FILE' },
    people: false,
  },
  CASH_FLOW_STATEMENT: {
    id: 'CASH_FLOW_STATEMENT',
    label: 'Cash flow statement',
    description: 'Cash flows from operating, investing and financing activities over a period.',
    route: { kind: 'FILE' },
    people: false,
  },
  CUSTOMER_CONTRACT: {
    id: 'CUSTOMER_CONTRACT',
    label: 'Customer contract',
    description: 'An agreement under which a customer buys from the company: MSA, subscription, order form, SOW, statement of work.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  SUPPLIER_CONTRACT: {
    id: 'SUPPLIER_CONTRACT',
    label: 'Supplier contract',
    description: 'An agreement under which the company buys from a supplier, vendor, reseller or partner.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  LEASE: {
    id: 'LEASE',
    label: 'Lease',
    description: 'A real-estate or equipment lease, as landlord or tenant, or a lease abstract.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  LOAN_AGREEMENT: {
    id: 'LOAN_AGREEMENT',
    label: 'Loan agreement',
    description: 'Credit facility, loan, note or security agreement, including covenants.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  CORPORATE_RECORD: {
    id: 'CORPORATE_RECORD',
    label: 'Corporate record',
    description: 'Certificate of incorporation, bylaws, board minutes, resolutions, shareholder agreements.',
    route: { kind: 'FILE' },
    people: false,
  },
  POLICY: {
    id: 'POLICY',
    label: 'Policy',
    description: 'Internal policy or procedure: security, privacy, compliance, insurance certificates.',
    route: { kind: 'FILE' },
    people: false,
  },
  PEOPLE_RECORD: {
    id: 'PEOPLE_RECORD',
    label: 'People record',
    description: 'Named people data: org chart, employee list, payroll, employment or compensation agreements.',
    route: { kind: 'FILE' },
    people: true,
  },
  OTHER: {
    id: 'OTHER',
    label: 'Other',
    description: 'None of the other categories.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Offering documents (T-106): kept and listed here; their terms are read on the Syndication page.
  OFFERING_PPM: {
    id: 'OFFERING_PPM',
    label: 'Private placement memorandum',
    description: 'A private placement memorandum (PPM) or offering memorandum for a real-estate syndication: the offering, fees, distributions and projected returns.',
    route: { kind: 'FILE' },
    people: false,
  },
  OPERATING_AGREEMENT: {
    id: 'OPERATING_AGREEMENT',
    label: 'Operating agreement',
    description: 'The operating agreement (LLC or LP agreement) of the investing entity: capital, fees, preferred return, promote and distribution waterfall.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Music rights documents (T-140): kept and listed here; their entries are read on the Catalog page.
  ROYALTY_STATEMENT: {
    id: 'ROYALTY_STATEMENT',
    label: 'Royalty statement',
    description: 'A royalty or income statement from a performing rights organisation, mechanical society, administrator, label or distributor: income by work and period.',
    route: { kind: 'FILE' },
    people: false,
  },
  SPLIT_SHEET: {
    id: 'SPLIT_SHEET',
    label: 'Split sheet',
    description: 'A split sheet or songwriter agreement stating each writer\'s share of a composition.',
    route: { kind: 'FILE' },
    people: false,
  },
  PUBLISHING_AGREEMENT: {
    id: 'PUBLISHING_AGREEMENT',
    label: 'Publishing or administration agreement',
    description: 'A publishing, co-publishing, administration, recording or assignment agreement granting rights in works or masters, including advances and recoupment.',
    route: { kind: 'FILE' },
    people: false,
  },
  COPYRIGHT_RECORD: {
    id: 'COPYRIGHT_RECORD',
    label: 'Copyright Office record',
    description: 'A copyright registration certificate, a recorded transfer or a search report from the U.S. Copyright Office or another registry.',
    route: { kind: 'FILE' },
    people: false,
  },
  LIEN_SEARCH: {
    id: 'LIEN_SEARCH',
    label: 'Lien or UCC search',
    description: 'A UCC, lien or security-interest search report, or a notice of a claim against the catalog.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Energy documents (T-142): kept and listed here; their entries are read on the Assets page.
  TITLE_OPINION: {
    id: 'TITLE_OPINION',
    label: 'Title opinion',
    description: 'A drilling or division-order title opinion, or a title report on a plant site: the chain of title and its requirements.',
    route: { kind: 'FILE' },
    people: false,
  },
  OIL_GAS_LEASE: {
    id: 'OIL_GAS_LEASE',
    label: 'Oil and gas lease',
    description: 'An oil and gas lease, assignment or memorandum: the royalty, primary term and habendum clause.',
    route: { kind: 'FILE' },
    people: false,
  },
  DIVISION_ORDER: {
    id: 'DIVISION_ORDER',
    label: 'Division order',
    description: 'A division order or check-stub decimal schedule from an operator: the decimal interest paid on each well.',
    route: { kind: 'FILE' },
    people: false,
  },
  RESERVE_REPORT: {
    id: 'RESERVE_REPORT',
    label: 'Reserve report',
    description: 'A third-party petroleum engineering reserve report: reserves by category, decline assumptions and discounted values.',
    route: { kind: 'FILE' },
    people: false,
  },
  POWER_PURCHASE_AGREEMENT: {
    id: 'POWER_PURCHASE_AGREEMENT',
    label: 'Power purchase agreement',
    description: 'A power purchase, tolling, capacity or offtake agreement, or an interconnection agreement for a plant.',
    route: { kind: 'FILE' },
    people: false,
  },
  ENVIRONMENTAL_REPORT: {
    id: 'ENVIRONMENTAL_REPORT',
    label: 'Environmental report or permit',
    description: 'An environmental site assessment, closure or remediation plan, decommissioning study, permit, consent decree or emissions compliance record.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Startup equity SPV documents (T-141): kept and listed; the SPV checks read their pages.
  ROUND_SUMMARY: {
    id: 'ROUND_SUMMARY',
    label: 'Round summary or deck',
    description: 'A startup\'s round summary, term sheet or pitch deck: the round size, price, valuation, traction, runway and prior-round terms it states.',
    route: { kind: 'FILE' },
    people: false,
  },
  CONVERTIBLE_INSTRUMENT: {
    id: 'CONVERTIBLE_INSTRUMENT',
    label: 'SAFE or convertible note',
    description: 'A signed SAFE or convertible note: its principal, valuation cap, discount, most-favoured-nation and pro-rata terms.',
    route: { kind: 'FILE' },
    people: false,
  },
  SPV_OPERATING_AGREEMENT: {
    id: 'SPV_OPERATING_AGREEMENT',
    label: 'SPV operating agreement',
    description: 'The vehicle\'s operating or limited partnership agreement: management fee, carried interest, expenses, the organizer\'s commitment and the offering exemption.',
    route: { kind: 'FILE' },
    people: false,
  },
  SPV_INVESTOR_SUMMARY: {
    id: 'SPV_INVESTOR_SUMMARY',
    label: 'SPV investor summary',
    description: 'The summary of terms or subscription summary investors are given: the fee, carry and expenses as presented to them, and any side letters disclosed.',
    route: { kind: 'FILE' },
    people: false,
  },
  SIDE_LETTER: {
    id: 'SIDE_LETTER',
    label: 'Side letter',
    description: 'A side letter granting one investor different terms: a fee waiver, a different carry, information or co-investment rights.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Fintech documents (T-159): kept and listed; the Payments page reads their status and dates.
  REGULATORY_LICENCE: {
    id: 'REGULATORY_LICENCE',
    label: 'Licence',
    description: 'A money-transmitter, lending, payment-institution or other licence or registration, or its renewal notice.',
    route: { kind: 'FILE' },
    people: false,
  },
  SPONSOR_BANK_AGREEMENT: {
    id: 'SPONSOR_BANK_AGREEMENT',
    label: 'Sponsor-bank agreement',
    description: 'A sponsor-bank or partner-bank program agreement: its term, covenants and monitoring thresholds.',
    route: { kind: 'FILE' },
    people: false,
  },
  PCI_ATTESTATION: {
    id: 'PCI_ATTESTATION',
    label: 'PCI attestation',
    description: 'A PCI DSS attestation of compliance or report on compliance, with its date.',
    route: { kind: 'FILE' },
    people: false,
  },
  AML_PROGRAM: {
    id: 'AML_PROGRAM',
    label: 'KYC/AML programme',
    description: 'The BSA/AML or KYC programme, its procedures and its independent test.',
    route: { kind: 'FILE' },
    people: false,
  },
  REGULATORY_EXAM: {
    id: 'REGULATORY_EXAM',
    label: 'Exam report or consent order',
    description: 'A regulator\'s examination report, a matter requiring attention, a consent order or another enforcement action.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Telecom and media documents (T-168): kept and listed; the Subscribers page and the pack's checks read them.
  RIGHTS_AGREEMENT: {
    id: 'RIGHTS_AGREEMENT',
    label: 'Content, affiliate or carriage agreement',
    description: 'A content licence, affiliate, carriage or sports-rights agreement between the company and a network, distributor, studio or league, with its term and renewal.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Professional services documents (T-167): kept and listed; the Practice page and the pack's checks read them.
  COVENANT_REGISTER: {
    id: 'COVENANT_REGISTER',
    label: 'Restrictive covenant register',
    description: 'A register of the partners and other revenue-carrying staff, by pseudonymous fee-earner reference, bound by a non-compete or non-solicitation covenant, with each term. Not the agreements\' pay terms.',
    route: { kind: 'FILE' },
    people: false,
  },
  // E-commerce documents (T-164): kept and listed; the Channels page and the pack's checks read them.
  PLATFORM_ACCOUNT_RECORD: {
    id: 'PLATFORM_ACCOUNT_RECORD',
    label: 'Platform account record',
    description: 'A storefront, marketplace or ad-platform account registration, or a schedule of the accounts and who each is registered to.',
    route: { kind: 'FILE' },
    people: false,
  },
  MARKETPLACE_AGREEMENT: {
    id: 'MARKETPLACE_AGREEMENT',
    label: 'Marketplace or channel agreement',
    description: 'Marketplace seller terms, a storefront platform agreement or a wholesale channel agreement: fees, delisting and change terms.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Pharma documents (T-163): kept and listed; the Pipeline page and the pack's checks read them.
  REGULATORY_CORRESPONDENCE: {
    id: 'REGULATORY_CORRESPONDENCE',
    label: 'Registry filing or regulatory correspondence',
    description: 'A trial-registry record, or a letter, meeting minutes or filing exchanged with a regulator (FDA, EMA, MHRA) about a programme.',
    route: { kind: 'FILE' },
    people: false,
  },
  PATENT_RECORD: {
    id: 'PATENT_RECORD',
    label: 'Patent record',
    description: 'A patent certificate, register extract or term-extension decision, with the family, jurisdiction and expiry.',
    route: { kind: 'FILE' },
    people: false,
  },
  LICENCE_AGREEMENT: {
    id: 'LICENCE_AGREEMENT',
    label: 'Licence or collaboration agreement',
    description: 'An in-licence, out-licence, collaboration or asset purchase agreement: its milestones, royalties and fees.',
    route: { kind: 'FILE' },
    people: false,
  },
  SUPPLY_AGREEMENT: {
    id: 'SUPPLY_AGREEMENT',
    label: 'Manufacturing or supply agreement',
    description: 'A contract-manufacturing, supply or quality agreement: who makes the product and whether a second source exists.',
    route: { kind: 'FILE' },
    people: false,
  },
  // Healthcare documents (T-160): kept and listed; the Practice page reads their presence and dates.
  LICENCE_VERIFICATION: {
    id: 'LICENCE_VERIFICATION',
    label: 'Licence verification',
    description: 'A primary-source verification of clinicians\' licences or credentials from the issuing board, by pseudonymous provider reference, with status and expiry.',
    route: { kind: 'FILE' },
    people: false,
  },
  CODING_AUDIT: {
    id: 'CODING_AUDIT',
    label: 'Coding or billing audit',
    description: 'An internal or external coding, billing or claims audit report, with its date and findings.',
    route: { kind: 'FILE' },
    people: false,
  },
  HIPAA_RISK_ASSESSMENT: {
    id: 'HIPAA_RISK_ASSESSMENT',
    label: 'HIPAA risk assessment',
    description: 'A HIPAA security or privacy risk assessment of the practice\'s systems, with its date.',
    route: { kind: 'FILE' },
    people: false,
  },
  PAYER_CONTRACT: {
    id: 'PAYER_CONTRACT',
    label: 'Payer contract',
    description: 'A contract or enrolment with a commercial insurer or government programme: its term, renewal and rate basis.',
    route: { kind: 'FILE' },
    people: false,
  },
  RESTRICTIVE_COVENANTS: {
    id: 'RESTRICTIVE_COVENANTS',
    label: 'Non-compete and retention schedule',
    description: 'A schedule of the clinicians, by pseudonymous provider reference, bound by a non-compete, non-solicitation or retention agreement, with each term. Not the agreements\' pay terms.',
    route: { kind: 'FILE' },
    people: false,
  },
  FORM_D: {
    id: 'FORM_D',
    label: 'Form D filing',
    description: 'The SEC Form D notice of exempt offering for the vehicle, or its filing confirmation.',
    route: { kind: 'FILE' },
    people: false,
  },
  INVESTOR_DECK: {
    id: 'INVESTOR_DECK',
    label: 'Investor deck',
    description: 'The sponsor\'s investor presentation: the deal, projected returns and the sponsor\'s track record.',
    route: { kind: 'FILE' },
    people: false,
  },
};

const IMPORT_DESCRIPTIONS: Partial<Record<ImportTarget, string>> = {
  BILLING_INVOICE_LINE: 'A billing or invoicing export: one row per invoice line with customer, amount and dates.',
  MULTIFAMILY_RENT_ROLL: 'Residential rent roll: one row per unit with tenant, rent and lease dates.',
  CRE_RENT_ROLL: 'Commercial rent roll: one row per tenant or suite with area, rent and lease expiry.',
  MULTIFAMILY_T12: 'Trailing-twelve-month operating statement for a residential property, month by month.',
};

function importDefinition(target: ImportTarget): CategoryDefinition {
  const definition = IMPORT_TARGET_DEFINITIONS[target];
  return {
    id: target,
    label: definition.label,
    description:
      IMPORT_DESCRIPTIONS[target] ??
      `A ${definition.label.toLowerCase()} export (spreadsheet or CSV) with columns such as ${definition.fields
        .slice(0, 4)
        .map((field) => field.label)
        .join(', ')}.`,
    route: { kind: 'IMPORT', target },
    // Import targets carry their own people-data handling (aggregate or pseudonymous rows).
    people: false,
  };
}

export function categoryDefinition(id: IntakeCategory): CategoryDefinition {
  return (DOCUMENT_DEFINITIONS as Record<string, CategoryDefinition>)[id] ?? importDefinition(id as ImportTarget);
}

/** The categories offered for a pact: the document categories plus the pack's import targets. */
export function categoriesForPack(pack: PackDefinition): readonly CategoryDefinition[] {
  return [
    ...pack.importTargets.map(importDefinition),
    ...(pack.documentCategories ?? []).map((id) => DOCUMENT_DEFINITIONS[id]),
    ...DOCUMENT_CATEGORIES.map((id) => DOCUMENT_DEFINITIONS[id]),
  ];
}

export function isIntakeCategory(pack: PackDefinition, value: string): value is IntakeCategory {
  return categoriesForPack(pack).some((category) => category.id === value);
}
