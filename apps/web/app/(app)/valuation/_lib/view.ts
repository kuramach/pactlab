/**
 * View model for valuation scenarios as returned by the API. Amounts stay
 * decimal strings end to end; the page only groups digits and shifts
 * percent points, never parses into JavaScript numbers.
 */

export interface MoneyValue {
  amount: string;
  currency: string;
}

export type ScenarioStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED';

export interface BridgeLine {
  kind: string;
  label: string;
  amount: MoneyValue;
  findingId: string | null;
  adjustmentType: string | null;
}

export interface ValuationResultView {
  engineVersion: string;
  inputHash: string;
  method:
    | { method: 'ARR_MULTIPLE'; arr: MoneyValue; multiple: string }
    | {
        method: 'DCF';
        years: { year: number; revenue: MoneyValue; freeCashFlow: MoneyValue; presentValue: MoneyValue }[];
        terminalValue: MoneyValue;
        presentValueOfTerminal: MoneyValue;
      };
  enterpriseValue: MoneyValue;
  bridge: { lines: BridgeLine[]; equityPurchasePrice: MoneyValue; cashAtClose: MoneyValue };
  sensitivity: {
    rowVariable: string;
    columnVariable: string;
    rows: string[];
    columns: string[];
    cells: (MoneyValue | null)[][];
  } | null;
  lbo: { entryEquity: MoneyValue; exitEquity: MoneyValue; moic: string | null; irr: string | null } | null;
  accretionDilution: {
    newSharesIssued: string;
    standaloneEps: string;
    proFormaEps: string;
    accretion: string;
    accretive: boolean;
  } | null;
}

export interface StaleReason {
  kind: 'ASSUMPTIONS_CHANGED' | 'FINDING_MISSING' | 'FINDING_NOT_ACCEPTED' | 'PRICED_RISK_REMOVED' | 'FINDING_CHANGED';
  findingId?: string;
}

export interface ScenarioView {
  scenario: {
    id: string;
    name: string;
    currency: string;
    transactionType: string;
    status: ScenarioStatus;
    assumptionVersion: number;
    version: number;
  };
  latestRun: {
    id: string;
    assumptionVersion: number;
    ranAt: string;
    ranBy: string;
    result: ValuationResultView;
  } | null;
  stale: boolean | null;
  staleReasons: StaleReason[];
  submissions: { id: string; digest: string; submittedAt: string; submittedBy: string }[];
  decisions: { id: string; submissionId: string; decision: 'APPROVED' | 'REJECTED'; rationale: string; decidedAt: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept only a UUID deal id from the query string. */
export function parseDealParam(value: string | string[] | undefined): string | undefined {
  const single = (Array.isArray(value) ? value[0] : value)?.trim();
  return single && UUID.test(single) ? single : undefined;
}

export function statusVariant(status: ScenarioStatus): 'draft' | 'reviewed' | 'neutral' {
  if (status === 'APPROVED') return 'reviewed';
  if (status === 'DRAFT') return 'draft';
  return 'neutral';
}

export function freshness(view: Pick<ScenarioView, 'stale'>): {
  label: string;
  variant: 'calculation' | 'danger' | 'neutral';
} {
  if (view.stale === null) return { label: 'Not run', variant: 'neutral' };
  return view.stale
    ? { label: 'Stale — re-run required', variant: 'danger' }
    : { label: 'Current', variant: 'calculation' };
}

export function describeStaleReason(reason: StaleReason): string {
  const finding = reason.findingId ? ` (finding ${reason.findingId.slice(0, 8)})` : '';
  switch (reason.kind) {
    case 'ASSUMPTIONS_CHANGED':
      return 'Assumptions changed since the last run';
    case 'FINDING_CHANGED':
      return `A linked accepted risk was re-priced${finding}`;
    case 'FINDING_NOT_ACCEPTED':
      return `A linked finding is no longer accepted${finding}`;
    case 'PRICED_RISK_REMOVED':
      return `A linked finding lost its priced risk${finding}`;
    case 'FINDING_MISSING':
      return `A linked finding no longer resolves${finding}`;
  }
}

export const SENSITIVITY_LABELS: Readonly<Record<string, string>> = {
  arr: 'ARR',
  multiple: 'ARR multiple',
  discountRate: 'Discount rate',
  terminalGrowth: 'Terminal growth',
  terminalMultiple: 'Terminal revenue multiple',
};

/** Rates are fractions; multiples and amounts are shown as given. */
export function isRateVariable(variable: string): boolean {
  return variable === 'discountRate' || variable === 'terminalGrowth';
}

/** Bridge subtotals are emphasised; signed contributions are not. */
export function isSubtotal(line: Pick<BridgeLine, 'kind'>): boolean {
  return ['ENTERPRISE_VALUE', 'EQUITY_VALUE', 'EQUITY_PURCHASE_PRICE', 'CASH_AT_CLOSE'].includes(
    line.kind,
  );
}
