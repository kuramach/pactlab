/**
 * Synthetic data rooms for fixture document sources (T-098). Shaped like what
 * a seller actually hands over: inconsistent names, folders that do not match
 * the content, and deliberate tests for intake. The software-saas room is
 * the same Brightwave data room the public demo data ships as `dataroom/`.
 * Everything is invented.
 *
 * Each room's `expect` is what intake should conclude — the e2e expectation.
 */
export interface FixtureFile {
  readonly folder: string;
  readonly name: string;
  readonly text: string;
  /** Bumped to simulate a new version at the source. */
  readonly version: number;
}

export interface FixtureRoom {
  readonly id: string;
  readonly label: string;
  readonly files: readonly FixtureFile[];
  readonly expect: {
    /** File name → category intake should settle on (by the AI, or after the one question). */
    readonly categories: Readonly<Record<string, string>>;
    /** Files that are the same content as another and should show once. */
    readonly duplicates: readonly string[];
    /** The file the AI should ask about rather than file alone. */
    readonly ambiguous: string;
    /** A file whose folder says one thing and content another. */
    readonly misfiled: string;
    /** Expected inputs that should show as missing. */
    readonly gaps: readonly string[];
  };
}

const lines = (...rows: string[]) => rows.join('\n');

const NORTHGATE_MSA = lines(
  'MASTER SERVICES AGREEMENT',
  'This Master Services Agreement is made between Brightwave Software Inc. ("Supplier") and Northgate Logistics (synthetic) ("Customer").',
  '1. Term. Twelve months, renewing automatically for further twelve-month terms.',
  "14. Change of control. Customer may terminate this agreement on thirty days' written notice if the Supplier undergoes a change of control.",
  'Signed for Brightwave Software Inc.: Dana Whitlow, CEO. Signed for the Customer: Morgan Ashby, COO.',
);

const BRIGHTWAVE_BALANCE_SHEET = lines(
  'Brightwave Software Inc. — balance sheet at 30 September 2026 (synthetic, unaudited)',
  'Cash and cash equivalents: USD 310,000',
  'Trade receivables: USD 118,000',
  'Term loan with Lakeshore Commercial Bank, outstanding principal: USD 450,000',
  'Deferred revenue on annual subscriptions billed in advance: USD 96,000',
  "Total equity: USD 512,000",
);

export const FIXTURE_ROOMS: Readonly<Record<string, FixtureRoom>> = {
  'brightwave-saas': {
    id: 'brightwave-saas',
    label: 'Brightwave Software — seller data room (synthetic)',
    files: [
      {
        folder: '01 Corporate',
        name: 'Cert of Inc - Brightwave.md',
        version: 1,
        text: lines('CERTIFICATE OF INCORPORATION OF BRIGHTWAVE SOFTWARE INC. (synthetic)', 'Article I. The name of the corporation is Brightwave Software Inc.', 'Article IV. Authorized: 10,000,000 shares of Common Stock.'),
      },
      {
        folder: '02 Finance',
        name: 'Mgmt accounts FY26.md',
        version: 1,
        text: lines(
          'Brightwave Software Inc. — management accounts, year to 30 September 2026 (synthetic)',
          'Profit and loss',
          'Subscription revenue: USD 4,210,000',
          'Cost of revenue: USD 920,000',
          'Gross profit: USD 3,290,000',
          'Operating expenses: USD 2,760,000',
          'Operating profit: USD 530,000',
        ),
      },
      {
        folder: '02 Finance',
        name: 'FY26 summary.md',
        version: 1,
        text: lines(
          'Brightwave Software Inc. — FY26 summary for the board (synthetic)',
          'Revenue: USD 4,210,000. Operating profit: USD 530,000.',
          'Cash generated from operations: USD 610,000. Capital expenditure: USD 85,000. Loan repayments: USD 150,000.',
          'Closing cash: USD 310,000.',
        ),
      },
      {
        folder: '02 Finance',
        name: 'billing_export_2026-09.csv',
        version: 1,
        text: lines(
          'line_id,invoice_id,customer_id,customer_name,currency,amount,interval,period_start,period_end,invoice_status,created',
          'il_bw_00001,in_bw_2609_01,bw-cus-0001,Harborline Freight (synthetic),USD,14500.00,month,2026-09-01,2026-10-01,paid,2026-09-01',
          'il_bw_00002,in_bw_2609_02,bw-cus-0003,Northgate Logistics (synthetic),USD,8160.00,month,2026-09-01,2026-10-01,paid,2026-09-01',
          'il_bw_00003,in_bw_2609_03,bw-cus-0013,Granite Peak Energy (synthetic),USD,6240.00,month,2026-09-01,2026-10-01,paid,2026-09-01',
          'il_bw_00004,in_bw_2609_04,bw-cus-0008,Copperfield Legal (synthetic),USD,4200.00,month,2026-09-01,2026-10-01,paid,2026-09-01',
          'il_bw_00005,in_bw_2609_05,bw-cus-0011,Tidewater Marine (synthetic),USD,3600.00,month,2026-09-01,2026-10-01,open,2026-09-01',
        ),
      },
      { folder: '03 Commercial/Customers', name: 'MSA - Northgate.md', version: 1, text: NORTHGATE_MSA },
      // The same agreement saved twice under another name: shown once.
      { folder: '03 Commercial/Customers', name: 'Northgate MSA (signed copy).md', version: 1, text: NORTHGATE_MSA },
      {
        folder: '03 Commercial/Customers',
        name: 'Order form - Harborline.md',
        version: 1,
        text: lines(
          'ORDER FORM AND SUBSCRIPTION TERMS',
          'Between Brightwave Software Inc. ("Provider") and Harborline Freight (synthetic) ("Customer").',
          'Subscription: Brightwave Workflow, Enterprise plan, USD 14,500 per month, billed monthly.',
          'Term: 24 months from 1 January 2025. Either party may terminate for convenience on 90 days notice.',
        ),
      },
      {
        folder: '04 Legal',
        name: 'Facility agreement - Lakeshore.md',
        version: 1,
        text: lines(
          'TERM LOAN FACILITY AGREEMENT',
          'Between Lakeshore Commercial Bank ("Lender") and Brightwave Software Inc. ("Borrower").',
          'Facility: USD 600,000 term loan. Interest: SOFR plus 4.25% per annum, payable quarterly.',
          'Covenant: the Borrower shall maintain a minimum cash balance of USD 250,000. A change of control is an event of default.',
        ),
      },
      // A balance sheet in the Legal folder: the content decides, not the folder.
      { folder: '04 Legal', name: 'BS 30-09-2026.md', version: 1, text: BRIGHTWAVE_BALANCE_SHEET },
      {
        folder: '05 People',
        name: 'Org chart Sept.md',
        version: 1,
        text: lines('Brightwave Software Inc. — organisation chart, September 2026 (synthetic)', 'Dana Whitlow — Chief Executive Officer', 'Priya Raman — VP Engineering', 'Leo Marsh — Head of Sales'),
      },
    ],
    expect: {
      categories: {
        'Cert of Inc - Brightwave.md': 'CORPORATE_RECORD',
        'Mgmt accounts FY26.md': 'INCOME_STATEMENT',
        'FY26 summary.md': 'INCOME_STATEMENT',
        'billing_export_2026-09.csv': 'BILLING_INVOICE_LINE',
        'MSA - Northgate.md': 'CUSTOMER_CONTRACT',
        'Order form - Harborline.md': 'CUSTOMER_CONTRACT',
        'Facility agreement - Lakeshore.md': 'LOAN_AGREEMENT',
        'BS 30-09-2026.md': 'BALANCE_SHEET',
        'Org chart Sept.md': 'PEOPLE_RECORD',
      },
      duplicates: ['Northgate MSA (signed copy).md'],
      ambiguous: 'FY26 summary.md',
      misfiled: 'BS 30-09-2026.md',
      // No cash flow statement; no contracts for Granite Peak Energy, Copperfield Legal or Tidewater Marine.
      gaps: ['CASH_FLOW_STATEMENT', 'CUSTOMER_CONTRACT:Granite Peak Energy (synthetic)'],
    },
  },

  'larkfield-multifamily': {
    id: 'larkfield-multifamily',
    label: 'Larkfield Residential — seller data room (synthetic)',
    files: [
      {
        folder: 'Rent roll',
        name: 'RR Sept 2026.csv',
        version: 1,
        text: lines(
          'unit,building,type,sqft,status,lease_start,lease_end,in_place_rent,market_rent,balance_due',
          '101,A,1BR,680,occupied,2025-11-01,2026-10-31,1240.00,1310.00,0.00',
          '102,A,2BR,910,occupied,2026-02-01,2027-01-31,1580.00,1620.00,240.00',
          '103,A,2BR,910,vacant,,,0.00,1620.00,0.00',
        ),
      },
      {
        folder: 'Operating',
        name: 'T-12 Oct25-Sep26.csv',
        version: 1,
        text: lines('month,rental_income,other_income,operating_expenses,net_operating_income', '2026-07,182400.00,6100.00,74300.00,114200.00', '2026-08,183100.00,6250.00,76900.00,112450.00', '2026-09,181900.00,6050.00,75200.00,112750.00'),
      },
      {
        folder: 'Leases',
        name: 'Lease 102.md',
        version: 1,
        text: lines('RESIDENTIAL LEASE AGREEMENT', 'Landlord: Larkfield Residential LLC. Tenant: J. Okafor (synthetic). Premises: Unit 102, Building A.', 'Term: 1 February 2026 to 31 January 2027. Monthly rent: USD 1,580.'),
      },
      {
        folder: 'Financials',
        name: 'Larkfield balance sheet Q3.md',
        version: 1,
        text: lines('Larkfield Residential LLC — balance sheet at 30 September 2026 (synthetic)', 'Cash: USD 420,000', 'Mortgage loan, Aire Valley Bank: USD 14,200,000', 'Tenant security deposits held: USD 96,000'),
      },
      {
        folder: 'Financials',
        name: 'P&L YTD.md',
        version: 1,
        text: lines('Larkfield Residential LLC — profit and loss, nine months to 30 September 2026 (synthetic)', 'Rental income: USD 1,642,000', 'Operating expenses: USD 671,000', 'Net operating income: USD 971,000', 'Interest expense: USD 612,000'),
      },
    ],
    expect: {
      categories: {
        'RR Sept 2026.csv': 'MULTIFAMILY_RENT_ROLL',
        'T-12 Oct25-Sep26.csv': 'MULTIFAMILY_T12',
        'Lease 102.md': 'LEASE',
        'Larkfield balance sheet Q3.md': 'BALANCE_SHEET',
        'P&L YTD.md': 'INCOME_STATEMENT',
      },
      duplicates: [],
      ambiguous: 'P&L YTD.md',
      misfiled: 'Lease 102.md',
      gaps: ['MULTIFAMILY_DELINQUENCY', 'MULTIFAMILY_INSPECTION'],
    },
  },

  'quayside-cre': {
    id: 'quayside-cre',
    label: 'Quayside Estates — seller data room (synthetic)',
    files: [
      {
        folder: 'Tenancy',
        name: 'Quayside rent roll.csv',
        version: 1,
        text: lines('tenant,suite,sqft,lease_start,lease_end,monthly_base_rent,monthly_market_rent', 'Marlow Dental (synthetic),100,2400,2022-04-01,2027-03-31,9600.00,10100.00', 'Keel & Co Accountants (synthetic),210,3800,2024-01-01,2029-12-31,14250.00,14400.00'),
      },
      {
        folder: 'Tenancy',
        name: 'CAM recon 2025.csv',
        version: 1,
        text: lines('year,category,expenses,recoveries', '2025,Cleaning,84000.00,79800.00', '2025,Insurance,61000.00,61000.00', '2025,Repairs,47000.00,31200.00'),
      },
      {
        folder: 'Leases',
        name: 'Marlow Dental lease.md',
        version: 1,
        text: lines('COMMERCIAL LEASE', 'Landlord: Quayside Estates Ltd. Tenant: Marlow Dental (synthetic). Premises: Suite 100.', 'Term: 1 April 2022 to 31 March 2027. Base rent: GBP 9,600 per month. Tenant break option on 31 March 2026.'),
      },
      {
        folder: 'Accounts',
        name: 'Quayside BS.md',
        version: 1,
        text: lines('Quayside Estates Ltd — balance sheet at 30 September 2026 (synthetic)', 'Cash at bank: GBP 260,000', 'Bank loan, Calder Bank plc: GBP 6,400,000'),
      },
    ],
    expect: {
      categories: {
        'Quayside rent roll.csv': 'CRE_RENT_ROLL',
        'CAM recon 2025.csv': 'CRE_CAM_RECONCILIATION',
        'Marlow Dental lease.md': 'LEASE',
        'Quayside BS.md': 'BALANCE_SHEET',
      },
      duplicates: [],
      ambiguous: 'Quayside BS.md',
      misfiled: 'Quayside BS.md',
      gaps: ['INCOME_STATEMENT'],
    },
  },
};
