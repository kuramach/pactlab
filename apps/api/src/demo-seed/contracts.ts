/**
 * Synthetic contracts for the demo deals. Every party, date and clause the
 * scripted extraction proposes is quoted verbatim from these texts, so the
 * real citation checks accept them. Names and terms are fictional.
 */
export interface SyntheticContract {
  readonly fileName: string;
  readonly text: string;
  /** What a model would propose; quotes must appear in `text`. */
  readonly extraction: {
    readonly parties: readonly { name: string; role: string; quote: string }[];
    readonly dates: readonly { kind: 'EFFECTIVE' | 'EXPIRATION' | 'RENEWAL' | 'NOTICE_DEADLINE'; date: string; quote: string }[];
    readonly clauses: readonly {
      kind: 'CHANGE_OF_CONTROL' | 'ASSIGNMENT' | 'TERMINATION_FOR_CONVENIENCE' | 'AUTO_RENEWAL' | 'EXCLUSIVITY' | 'INDEMNITY' | 'LIMITATION_OF_LIABILITY';
      summary: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      quote: string;
    }[];
  } | null;
}

export const DEMO_CONTRACTS: Readonly<Record<'Project Healthy' | 'Project Troubled' | 'Project Sparse', readonly SyntheticContract[]>> = {
  'Project Healthy': [
    {
      fileName: 'HealthyCo - Master Services Agreement (Birchwood Clinics).txt',
      text: [
        'MASTER SERVICES AGREEMENT (SYNTHETIC)',
        '',
        'This Master Services Agreement is entered into as of March 1, 2025 between HealthyCo Software, Inc. ("Vendor") and Birchwood Clinics Group ("Customer").',
        '',
        '1. Term. The initial term ends on February 28, 2028 and renews automatically for successive one-year terms unless either party gives ninety days written notice.',
        '',
        '2. Fees. Customer pays the subscription fees in the Order Form annually in advance.',
        '',
        '3. Change of Control. If Vendor undergoes a Change of Control, Customer may terminate this Agreement on thirty days written notice without penalty.',
        '',
        '4. Liability. Each party\'s aggregate liability is limited to the fees paid in the twelve months before the claim.',
        '',
        '5. Assignment. Neither party may assign this Agreement without the other party\'s prior written consent, not to be unreasonably withheld.',
      ].join('\n'),
      extraction: {
        parties: [
          { name: 'HealthyCo Software, Inc.', role: 'Vendor', quote: 'HealthyCo Software, Inc. ("Vendor")' },
          { name: 'Birchwood Clinics Group', role: 'Customer', quote: 'Birchwood Clinics Group ("Customer")' },
        ],
        dates: [
          { kind: 'EFFECTIVE', date: '2025-03-01', quote: 'entered into as of March 1, 2025' },
          { kind: 'EXPIRATION', date: '2028-02-28', quote: 'The initial term ends on February 28, 2028' },
        ],
        clauses: [
          {
            kind: 'CHANGE_OF_CONTROL',
            summary: 'The customer may terminate on thirty days notice if the vendor undergoes a change of control.',
            severity: 'HIGH',
            quote: 'If Vendor undergoes a Change of Control, Customer may terminate this Agreement on thirty days written notice without penalty.',
          },
          {
            kind: 'AUTO_RENEWAL',
            summary: 'Renews automatically for one-year terms unless either party gives ninety days notice.',
            severity: 'LOW',
            quote: 'renews automatically for successive one-year terms unless either party gives ninety days written notice',
          },
          {
            kind: 'LIMITATION_OF_LIABILITY',
            summary: 'Liability is capped at twelve months of fees.',
            severity: 'LOW',
            quote: 'aggregate liability is limited to the fees paid in the twelve months before the claim',
          },
        ],
      },
    },
    {
      fileName: 'HealthyCo - Mutual NDA (Alpha Capital).txt',
      text: [
        'MUTUAL NON-DISCLOSURE AGREEMENT (SYNTHETIC)',
        '',
        'This Agreement is made as of July 15, 2026 between HealthyCo Software, Inc. and Alpha Capital, for the purpose of evaluating a possible transaction.',
        '',
        'Each party keeps the other party\'s Confidential Information confidential for three years and uses it only for that purpose.',
      ].join('\n'),
      extraction: null,
    },
  ],
  'Project Troubled': [
    {
      fileName: 'TroubledCo - Reseller Agreement (Northgate Distribution).txt',
      text: [
        'RESELLER AGREEMENT (SYNTHETIC)',
        '',
        'This Reseller Agreement is entered into as of January 10, 2024 between TroubledCo Ltd ("Supplier") and Northgate Distribution PLC ("Reseller").',
        '',
        '1. Exclusivity. Supplier appoints Reseller as its exclusive reseller in the United Kingdom and shall not appoint any other reseller in that territory.',
        '',
        '2. Indemnity. Supplier shall indemnify Reseller without limit against all losses arising from any claim that the Software infringes third-party rights.',
        '',
        '3. Term. This Agreement continues until terminated by either party on twelve months written notice.',
        '',
        '4. Assignment. Supplier may not assign this Agreement, including by merger or change of control, without Reseller\'s prior written consent.',
      ].join('\n'),
      extraction: {
        parties: [
          { name: 'TroubledCo Ltd', role: 'Supplier', quote: 'TroubledCo Ltd ("Supplier")' },
          { name: 'Northgate Distribution PLC', role: 'Reseller', quote: 'Northgate Distribution PLC ("Reseller")' },
        ],
        dates: [{ kind: 'EFFECTIVE', date: '2024-01-10', quote: 'entered into as of January 10, 2024' }],
        clauses: [
          {
            kind: 'EXCLUSIVITY',
            summary: 'Exclusive UK reseller appointment limits the buyer’s own UK channel.',
            severity: 'MEDIUM',
            quote: 'Supplier appoints Reseller as its exclusive reseller in the United Kingdom',
          },
          {
            kind: 'INDEMNITY',
            summary: 'Uncapped IP infringement indemnity given by the target.',
            severity: 'CRITICAL',
            quote: 'Supplier shall indemnify Reseller without limit against all losses',
          },
          {
            kind: 'ASSIGNMENT',
            summary: 'Assignment, including by merger or change of control, needs the reseller’s consent.',
            severity: 'HIGH',
            quote: 'Supplier may not assign this Agreement, including by merger or change of control, without Reseller\'s prior written consent.',
          },
        ],
      },
    },
  ],
  'Project Sparse': [
    {
      fileName: 'SparseCo - Order Form (partial scan).txt',
      text: [
        'ORDER FORM (SYNTHETIC, PARTIAL)',
        '',
        'Customer: Lumen Retail (synthetic). Subscription: Growth plan, annual.',
        '',
        '[Pages 2-4 missing from the data room upload]',
      ].join('\n'),
      extraction: null,
    },
  ],
};
