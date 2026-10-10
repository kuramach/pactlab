/**
 * Scenario form ⇄ engine inputs. Rates are typed as percents ("12.5") and
 * stored as fractions ("0.125"); the conversion shifts the decimal point in
 * the string, so no value ever passes through a JavaScript number.
 */

const DECIMAL = /^-?\d{1,18}(\.\d{1,12})?$/;
const PERCENT = /^-?\d{1,6}(\.\d{1,8})?$/;

function trimDecimal(sign: string, integer: string, fraction: string): string {
  const int = integer.replace(/^0+(?=\d)/, '') || '0';
  const frac = fraction.replace(/0+$/, '');
  const body = frac ? `${int}.${frac}` : int;
  return sign && body !== '0' ? `-${body}` : body;
}

/** "12.5" → "0.125"; null when not a percent. */
export function percentToFraction(raw: string): string | null {
  const text = raw.trim().replaceAll(',', '');
  if (!PERCENT.test(text)) return null;
  const sign = text.startsWith('-') ? '-' : '';
  const [integer = '0', fraction = ''] = text.replace('-', '').split('.');
  const padded = integer.padStart(3, '0');
  return trimDecimal(sign, padded.slice(0, -2), padded.slice(-2) + fraction);
}

/** "0.125" → "12.5". */
export function fractionToPercent(value: string): string {
  const sign = value.startsWith('-') ? '-' : '';
  const [integer = '0', fraction = ''] = value.replace('-', '').split('.');
  const padded = fraction.padEnd(2, '0');
  return trimDecimal(sign, integer + padded.slice(0, 2), padded.slice(2));
}

/** Plain amount or multiple: commas allowed, otherwise a decimal string. */
function amount(raw: FormDataEntryValue | null): string | null {
  const text = String(raw ?? '').trim().replaceAll(',', '');
  return DECIMAL.test(text) ? text : null;
}

export const ADJUSTMENT_POINTS = ['LOW', 'MID', 'HIGH'] as const;
export const MAX_YEARS = 10;

export interface ScenarioValues {
  assumptions:
    | { method: 'ARR_MULTIPLE'; arr: string; multiple: string }
    | {
        method: 'DCF';
        baseRevenue: string;
        years: { growth: string; fcfMargin: string }[];
        discountRate: string;
        terminal: { kind: 'GORDON'; growth: string } | { kind: 'EXIT_MULTIPLE'; revenueMultiple: string };
      };
  bridge: { cash: string; debt: string; debtLikeItems: string; workingCapitalAdjustment: string };
  stockConsiderationShare: string;
  findingLinks: { findingId: string; point: (typeof ADJUSTMENT_POINTS)[number] }[];
  lbo: {
    entryEbitda: string;
    leverageMultiple: string;
    exitEbitda: string;
    exitMultiple: string;
    holdYears: number;
    debtRepaid: string;
  } | null;
  accretionDilution: unknown;
  sensitivity: unknown;
}

export type ParsedScenario = { ok: true; name: string; values: ScenarioValues } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the scenario form. Settings the form does not edit (sensitivity,
 * stock consideration, accretion/dilution) are carried over from `previous`.
 */
export function scenarioFromForm(form: FormData, previous: Partial<ScenarioValues> | null): ParsedScenario {
  const name = String(form.get('name') ?? '').trim();
  if (!name || name.length > 200) return { ok: false, message: 'Give the scenario a name.' };
  const method = form.get('method') === 'DCF' ? 'DCF' : 'ARR_MULTIPLE';

  let assumptions: ScenarioValues['assumptions'];
  if (method === 'ARR_MULTIPLE') {
    const arr = amount(form.get('arr'));
    const multiple = amount(form.get('multiple'));
    if (!arr || !multiple) return { ok: false, message: 'Enter ARR and the ARR multiple.' };
    assumptions = { method, arr, multiple };
  } else {
    const baseRevenue = amount(form.get('baseRevenue'));
    const discountRate = percentToFraction(String(form.get('discountRate') ?? ''));
    if (!baseRevenue || !discountRate) return { ok: false, message: 'Enter base revenue and the discount rate (%).' };
    const count = Math.min(Math.max(Number.parseInt(String(form.get('yearCount') ?? '5'), 10) || 5, 1), MAX_YEARS);
    const years: { growth: string; fcfMargin: string }[] = [];
    for (let year = 1; year <= count; year += 1) {
      const growth = percentToFraction(String(form.get(`growth_${year}`) ?? ''));
      const fcfMargin = percentToFraction(String(form.get(`margin_${year}`) ?? ''));
      if (!growth || !fcfMargin) return { ok: false, message: `Enter growth and free-cash-flow margin (%) for year ${year}.` };
      years.push({ growth, fcfMargin });
    }
    const terminalKind = form.get('terminalKind') === 'EXIT_MULTIPLE' ? 'EXIT_MULTIPLE' : 'GORDON';
    let terminal: Extract<ScenarioValues['assumptions'], { method: 'DCF' }>['terminal'];
    if (terminalKind === 'GORDON') {
      const growth = percentToFraction(String(form.get('terminalGrowth') ?? ''));
      if (!growth) return { ok: false, message: 'Enter the terminal growth rate (%).' };
      terminal = { kind: 'GORDON', growth };
    } else {
      const revenueMultiple = amount(form.get('terminalMultiple'));
      if (!revenueMultiple) return { ok: false, message: 'Enter the exit revenue multiple.' };
      terminal = { kind: 'EXIT_MULTIPLE', revenueMultiple };
    }
    assumptions = { method, baseRevenue, years, discountRate, terminal };
  }

  const bridgeFields = ['cash', 'debt', 'debtLikeItems', 'workingCapitalAdjustment'] as const;
  const bridge = Object.fromEntries(bridgeFields.map((field) => [field, amount(form.get(field)) ?? (String(form.get(field) ?? '').trim() === '' ? '0' : null)]));
  if (Object.values(bridge).some((value) => value === null)) return { ok: false, message: 'Bridge amounts must be numbers (use a minus sign for negatives).' };

  const findingLinks: ScenarioValues['findingLinks'] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('link_')) continue;
    const findingId = key.slice(5);
    const point = String(value);
    if (UUID.test(findingId) && (ADJUSTMENT_POINTS as readonly string[]).includes(point)) {
      findingLinks.push({ findingId, point: point as (typeof ADJUSTMENT_POINTS)[number] });
    }
  }

  let lbo: ScenarioValues['lbo'] = null;
  if (form.get('lboEnabled') === 'on') {
    const fields = ['entryEbitda', 'leverageMultiple', 'exitEbitda', 'exitMultiple', 'debtRepaid'] as const;
    const values = Object.fromEntries(fields.map((field) => [field, amount(form.get(field))]));
    const holdYears = Number.parseInt(String(form.get('holdYears') ?? ''), 10);
    if (Object.values(values).some((value) => value === null) || !Number.isInteger(holdYears))
      return { ok: false, message: 'Complete every LBO field (entry and exit EBITDA, multiples, hold years, debt repaid).' };
    lbo = { ...(values as Record<(typeof fields)[number], string>), holdYears };
  }

  return {
    ok: true,
    name,
    values: {
      assumptions,
      bridge: bridge as ScenarioValues['bridge'],
      stockConsiderationShare: previous?.stockConsiderationShare ?? '0',
      findingLinks,
      lbo,
      accretionDilution: previous?.accretionDilution ?? null,
      sensitivity: previous?.sensitivity ?? null,
    },
  };
}
