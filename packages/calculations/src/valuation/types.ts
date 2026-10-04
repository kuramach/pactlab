import type { MoneyValue } from '../metrics/types';

/** Bumped whenever a formula, bridge rule, rounding rule or output shape changes. */
export const VALUATION_ENGINE_VERSION = 'valuation-1';

export const VALUATION_METHODS = ['ARR_MULTIPLE', 'DCF'] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

/** Mirrors the deal's transaction type; it decides which extra engines must run. */
export const VALUATION_TRANSACTION_TYPES = [
  'PUBLIC_ACQUIRER',
  'PRIVATE_ACQUIRER',
  'TAKE_PRIVATE',
] as const;
export type ValuationTransactionType = (typeof VALUATION_TRANSACTION_TYPES)[number];

/** Same vocabulary as a finding's priced risk. */
export const ADJUSTMENT_TYPES = [
  'PRICE_REDUCTION',
  'ESCROW',
  'INDEMNITY',
  'REMEDIATION_COST',
] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

/** Which point of a priced-risk range a scenario applies. */
export const ADJUSTMENT_POINTS = ['LOW', 'MID', 'HIGH'] as const;
export type AdjustmentPoint = (typeof ADJUSTMENT_POINTS)[number];

/** All amounts, rates and multiples are decimal strings; rates are fractions (`'0.12'` = 12%). */
export interface ArrMultipleAssumptions {
  readonly method: 'ARR_MULTIPLE';
  readonly arr: string;
  readonly multiple: string;
}

export interface DcfYear {
  /** Revenue growth over the prior year. */
  readonly growth: string;
  /** Unlevered free cash flow as a share of revenue. */
  readonly fcfMargin: string;
}

export type TerminalValue =
  | { readonly kind: 'GORDON'; readonly growth: string }
  | { readonly kind: 'EXIT_MULTIPLE'; readonly revenueMultiple: string };

export interface DcfAssumptions {
  readonly method: 'DCF';
  /** Last actual (year 0) revenue. */
  readonly baseRevenue: string;
  readonly years: readonly DcfYear[];
  readonly discountRate: string;
  readonly terminal: TerminalValue;
}

export type MethodAssumptions = ArrMultipleAssumptions | DcfAssumptions;

/** Enterprise-to-equity bridge items, before diligence adjustments. */
export interface BridgeAssumptions {
  readonly cash: string;
  readonly debt: string;
  readonly debtLikeItems: string;
  /** Signed: positive when delivered working capital exceeds the peg. */
  readonly workingCapitalAdjustment: string;
}

/**
 * A valuation adjustment linked to an accepted finding's priced risk. The
 * finding id and version are the dependency that makes a result stale.
 */
export interface LinkedAdjustment {
  readonly findingId: string;
  readonly findingVersion: number;
  readonly type: AdjustmentType;
  readonly currency: string;
  readonly low: string;
  readonly high: string;
  readonly point: AdjustmentPoint;
  readonly basis: string;
}

/** Leveraged-buyout inputs, required for take-privates. */
export interface LboAssumptions {
  readonly entryEbitda: string;
  /** Acquisition debt as a multiple of entry EBITDA. */
  readonly leverageMultiple: string;
  readonly exitEbitda: string;
  readonly exitMultiple: string;
  /** Whole years. */
  readonly holdYears: number;
  /** Acquisition debt repaid by exit. */
  readonly debtRepaid: string;
}

/** Acquirer EPS inputs, required when any consideration is paid in stock. */
export interface AccretionDilutionAssumptions {
  readonly acquirerNetIncome: string;
  readonly acquirerShares: string;
  readonly acquirerSharePrice: string;
  readonly targetNetIncome: string;
  readonly pretaxSynergies: string;
  readonly taxRate: string;
  /** Pre-tax yield forgone on the cash portion of consideration. */
  readonly cashInterestRate: string;
}

export const SENSITIVITY_VARIABLES = [
  'arr',
  'multiple',
  'discountRate',
  'terminalGrowth',
  'terminalMultiple',
] as const;
export type SensitivityVariable = (typeof SENSITIVITY_VARIABLES)[number];

export interface SensitivityAxis {
  readonly variable: SensitivityVariable;
  readonly values: readonly string[];
}

export interface SensitivitySpec {
  readonly rows: SensitivityAxis;
  readonly columns: SensitivityAxis;
}

/** The complete, self-contained input set of one scenario run. */
export interface ValuationInputs {
  readonly currency: string;
  readonly transactionType: ValuationTransactionType;
  readonly assumptions: MethodAssumptions;
  readonly bridge: BridgeAssumptions;
  /** Share of the equity purchase price paid in acquirer stock, 0 to 1. */
  readonly stockConsiderationShare: string;
  readonly adjustments: readonly LinkedAdjustment[];
  readonly lbo: LboAssumptions | null;
  readonly accretionDilution: AccretionDilutionAssumptions | null;
  readonly sensitivity: SensitivitySpec | null;
}

export interface DcfYearResult {
  readonly year: number;
  readonly revenue: MoneyValue;
  readonly freeCashFlow: MoneyValue;
  /** Twelve decimal places. */
  readonly discountFactor: string;
  readonly presentValue: MoneyValue;
}

export type MethodResult =
  | { readonly method: 'ARR_MULTIPLE'; readonly arr: MoneyValue; readonly multiple: string }
  | {
      readonly method: 'DCF';
      readonly years: readonly DcfYearResult[];
      readonly terminalValue: MoneyValue;
      readonly presentValueOfTerminal: MoneyValue;
      readonly presentValueOfCashFlows: MoneyValue;
    };

export const BRIDGE_LINE_KINDS = [
  'ENTERPRISE_VALUE',
  'CASH',
  'DEBT',
  'DEBT_LIKE_ITEMS',
  'WORKING_CAPITAL',
  'EQUITY_VALUE',
  'FINDING_ADJUSTMENT',
  'EQUITY_PURCHASE_PRICE',
  'HOLDBACK',
  'CASH_AT_CLOSE',
] as const;
export type BridgeLineKind = (typeof BRIDGE_LINE_KINDS)[number];

/** One line of the purchase-price bridge. Subtotals carry `findingId: null`. */
export interface BridgeLine {
  readonly kind: BridgeLineKind;
  readonly label: string;
  /** Signed contribution, or the running subtotal for subtotal lines. */
  readonly amount: MoneyValue;
  readonly findingId: string | null;
  readonly adjustmentType: AdjustmentType | null;
}

export interface PurchasePriceBridge {
  readonly lines: readonly BridgeLine[];
  readonly enterpriseValue: MoneyValue;
  readonly equityValue: MoneyValue;
  readonly equityPurchasePrice: MoneyValue;
  readonly holdbacks: MoneyValue;
  readonly cashAtClose: MoneyValue;
}

export interface SensitivityResult {
  readonly rowVariable: SensitivityVariable;
  readonly columnVariable: SensitivityVariable;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  /** Enterprise value per cell, `cells[row][column]`; null where no finite value exists. */
  readonly cells: readonly (readonly (MoneyValue | null)[])[];
}

export interface LboResult {
  readonly entryEnterpriseValue: MoneyValue;
  readonly entryDebt: MoneyValue;
  readonly entryEquity: MoneyValue;
  readonly exitEnterpriseValue: MoneyValue;
  readonly exitDebt: MoneyValue;
  readonly exitEquity: MoneyValue;
  /** Four decimal places; null when entry equity is not positive. */
  readonly moic: string | null;
  /** Annualised, four decimal places; null when MOIC is not positive. */
  readonly irr: string | null;
}

export interface AccretionDilutionResult {
  readonly stockConsideration: MoneyValue;
  readonly cashConsideration: MoneyValue;
  /** Four decimal places. */
  readonly newSharesIssued: string;
  readonly standaloneEps: string;
  readonly proFormaEps: string;
  /** Pro-forma over standalone EPS minus one, four decimal places. */
  readonly accretion: string;
  readonly accretive: boolean;
}

export interface ValuationResult {
  readonly engineVersion: string;
  /** SHA-256 of the canonical input set; same inputs, same hash, same result. */
  readonly inputHash: string;
  readonly currency: string;
  readonly method: MethodResult;
  readonly enterpriseValue: MoneyValue;
  readonly bridge: PurchasePriceBridge;
  readonly sensitivity: SensitivityResult | null;
  readonly lbo: LboResult | null;
  readonly accretionDilution: AccretionDilutionResult | null;
}
