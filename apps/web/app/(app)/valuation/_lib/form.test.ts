import { describe, expect, it } from 'vitest';
import { fractionToPercent, percentToFraction, scenarioFromForm } from './form';

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe('percent conversion', () => {
  it.each([
    ['12', '0.12'],
    ['12.5', '0.125'],
    ['3', '0.03'],
    ['0.5', '0.005'],
    ['100', '1'],
    ['-2', '-0.02'],
    ['0', '0'],
  ])('%s%% → %s', (percent, fraction) => {
    expect(percentToFraction(percent)).toBe(fraction);
    expect(fractionToPercent(fraction)).toBe(percent);
  });

  it('rejects anything that is not a percent', () => {
    expect(percentToFraction('12%')).toBeNull();
    expect(percentToFraction('1e2')).toBeNull();
    expect(percentToFraction('')).toBeNull();
  });
});

describe('scenarioFromForm', () => {
  it('reads an ARR-multiple scenario with bridge, finding links and carried-over settings', () => {
    const parsed = scenarioFromForm(
      form({
        name: 'Base case',
        method: 'ARR_MULTIPLE',
        arr: '402,840',
        multiple: '6.5',
        cash: '250000',
        debt: '',
        debtLikeItems: '40000',
        workingCapitalAdjustment: '-15000',
        'link_01900000-0000-7000-8000-000000000001': 'MID',
        'link_01900000-0000-7000-8000-000000000002': '',
      }),
      { sensitivity: { rows: 'kept' } },
    );
    expect(parsed).toEqual({
      ok: true,
      name: 'Base case',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '402840', multiple: '6.5' },
        bridge: { cash: '250000', debt: '0', debtLikeItems: '40000', workingCapitalAdjustment: '-15000' },
        stockConsiderationShare: '0',
        findingLinks: [{ findingId: '01900000-0000-7000-8000-000000000001', point: 'MID' }],
        lbo: null,
        accretionDilution: null,
        sensitivity: { rows: 'kept' },
      },
    });
  });

  it('reads a DCF with percents converted to fractions and LBO inputs', () => {
    const parsed = scenarioFromForm(
      form({
        name: 'Downside',
        method: 'DCF',
        baseRevenue: '268000',
        discountRate: '14',
        yearCount: '2',
        growth_1: '5',
        margin_1: '5',
        growth_2: '8',
        margin_2: '7.5',
        terminalKind: 'GORDON',
        terminalGrowth: '3',
        lboEnabled: 'on',
        entryEbitda: '30000',
        leverageMultiple: '4',
        exitEbitda: '55000',
        exitMultiple: '9',
        holdYears: '5',
        debtRepaid: '60000',
      }),
      null,
    );
    expect(parsed.ok && parsed.values.assumptions).toEqual({
      method: 'DCF',
      baseRevenue: '268000',
      years: [
        { growth: '0.05', fcfMargin: '0.05' },
        { growth: '0.08', fcfMargin: '0.075' },
      ],
      discountRate: '0.14',
      terminal: { kind: 'GORDON', growth: '0.03' },
    });
    expect(parsed.ok && parsed.values.lbo).toMatchObject({ holdYears: 5, leverageMultiple: '4' });
  });

  it('explains what is missing', () => {
    expect(scenarioFromForm(form({ name: '' }), null)).toEqual({ ok: false, message: 'Give the scenario a name.' });
    expect(scenarioFromForm(form({ name: 'x', method: 'ARR_MULTIPLE', arr: '1' }), null)).toMatchObject({ ok: false });
    expect(scenarioFromForm(form({ name: 'x', method: 'DCF', baseRevenue: '1', discountRate: '10', yearCount: '1', growth_1: '5' }), null)).toEqual({
      ok: false,
      message: 'Enter growth and free-cash-flow margin (%) for year 1.',
    });
  });
});
