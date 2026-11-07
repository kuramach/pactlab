import { describe, expect, it } from 'vitest';
import {
  BRIEF_TONES,
  BUYER_PERSONAS,
  PERSONA_PROFILE,
  personaRun,
  resolvePersona,
  runValuation,
  SCENARIO_CASES,
  TERM_LEVERS,
  termMix,
  weightedPrice,
  type BuyerPersona,
  type LinkedAdjustment,
  type ValuationInputs,
} from '.';
import { D } from '../metrics/decimal';

const ARR_GAP = '0190f000-0000-7000-8000-00000000000a';
const KEY_PERSON = '0190f000-0000-7000-8000-00000000000b';
const SMALL_FIX = '0190f000-0000-7000-8000-00000000000c';
const ESCROWED = '0190f000-0000-7000-8000-00000000000d';

const adjustment = (findingId: string, type: LinkedAdjustment['type'], low: string, high: string): LinkedAdjustment => ({
  findingId,
  findingVersion: 1,
  type,
  currency: 'USD',
  low,
  high,
  point: 'MID',
  basis: 'test',
});

/** EV 65m: the ARR gap is material to all; the remediation (1–2% of EV) only clears Value and Grave's bars. */
const inputs: ValuationInputs = {
  currency: 'USD',
  transactionType: 'PRIVATE_ACQUIRER',
  assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple: '6.5' },
  bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
  stockConsiderationShare: '0',
  adjustments: [
    adjustment(ARR_GAP, 'PRICE_REDUCTION', '2000000', '4000000'),
    adjustment(KEY_PERSON, 'PRICE_REDUCTION', '1500000', '2500000'),
    adjustment(SMALL_FIX, 'REMEDIATION_COST', '650000', '1300000'),
    adjustment(ESCROWED, 'ESCROW', '1000000', '2000000'),
  ],
  lbo: null,
  accretionDilution: null,
  sensitivity: null,
};
const keyPeople = new Set([KEY_PERSON]);
const price = (persona: BuyerPersona) => new D(personaRun(inputs, persona, keyPeople).result.bridge.equityPurchasePrice.amount);

describe('persona registry (T-105)', () => {
  it('defines every knob for every persona', () => {
    expect(Object.keys(PERSONA_PROFILE).sort()).toEqual([...BUYER_PERSONAS].sort());
    for (const persona of BUYER_PERSONAS) {
      const profile = PERSONA_PROFILE[persona];
      expect(profile.label.length, persona).toBeGreaterThan(0);
      expect(profile.descriptor.length, persona).toBeGreaterThan(0);
      expect(profile.icon, persona).toBeTruthy();
      expect(profile.caption.split(' ').length, persona).toBeLessThanOrEqual(2);
      expect(['LOW', 'MID', 'HIGH']).toContain(profile.drag.point);
      expect(new D(profile.drag.materiality).greaterThanOrEqualTo(0)).toBe(true);
      expect(Object.keys(profile.weights).sort()).toEqual([...SCENARIO_CASES].sort());
      expect(SCENARIO_CASES.reduce((total, scenario) => total.plus(profile.weights[scenario]), new D(0)).toFixed()).toBe('1');
      expect([...profile.levers.order].sort()).toEqual([...TERM_LEVERS].sort());
      expect(BRIEF_TONES).toContain(profile.briefTone);
    }
  });

  it('gives each persona its own icon', () => {
    expect(new Set(BUYER_PERSONAS.map((persona) => PERSONA_PROFILE[persona].icon)).size).toBe(BUYER_PERSONAS.length);
  });

  it('never uses a villain’s name as a label', () => {
    expect(JSON.stringify(PERSONA_PROFILE).toLowerCase()).not.toContain('shylock');
  });

  it('defaults to the pact, then the organization, then Value Investor', () => {
    expect(resolvePersona('GRAVE_DANCER', 'QUALITY_COMPOUNDER')).toBe('GRAVE_DANCER');
    expect(resolvePersona(null, 'QUALITY_COMPOUNDER')).toBe('QUALITY_COMPOUNDER');
    expect(resolvePersona(null, null)).toBe('VALUE_INVESTOR');
  });
});

describe('persona pricing', () => {
  it('prices Compounder >= Value Investor >= Grave Dancer on the same drags', () => {
    expect(price('QUALITY_COMPOUNDER').greaterThanOrEqualTo(price('VALUE_INVESTOR'))).toBe(true);
    expect(price('VALUE_INVESTOR').greaterThanOrEqualTo(price('GRAVE_DANCER'))).toBe(true);
    expect(price('QUALITY_COMPOUNDER').greaterThan(price('GRAVE_DANCER'))).toBe(true);
  });

  it('prices each drag at the persona’s point of its range', () => {
    const grave = personaRun(inputs, 'GRAVE_DANCER', keyPeople);
    expect(grave.inputs.adjustments.every((entry) => entry.point === 'HIGH')).toBe(true);
    // 65m less every price drag at HIGH: 4m + 2.5m + 1.3m.
    expect(grave.result.bridge.equityPurchasePrice.amount).toBe('57200000.00');
  });

  it('routes immaterial and key-person drags to holdbacks for the Compounder, never editing the finding', () => {
    const compounder = personaRun(inputs, 'QUALITY_COMPOUNDER', keyPeople);
    const routes = Object.fromEntries(compounder.routing.map((entry) => [entry.findingId, entry]));
    expect(routes[ARR_GAP]).toMatchObject({ appliedType: 'PRICE_REDUCTION', lever: 'PRICE_REDUCTION', reason: 'AS_PRICED' });
    expect(routes[KEY_PERSON]).toMatchObject({ pricedRiskType: 'PRICE_REDUCTION', lever: 'RETENTION', reason: 'KEY_PERSON_RETENTION' });
    expect(routes[SMALL_FIX]).toMatchObject({ pricedRiskType: 'REMEDIATION_COST', lever: 'INDEMNITY', reason: 'BELOW_MATERIALITY' });
    // The caller's inputs (the findings' priced risks) are untouched.
    expect(inputs.adjustments.map((entry) => [entry.type, entry.point])).toEqual([
      ['PRICE_REDUCTION', 'MID'],
      ['PRICE_REDUCTION', 'MID'],
      ['REMEDIATION_COST', 'MID'],
      ['ESCROW', 'MID'],
    ]);
  });

  it('moves no price when nothing is linked, under any persona', () => {
    const clean = { ...inputs, adjustments: [] };
    const expected = runValuation(clean).bridge.equityPurchasePrice.amount;
    for (const persona of BUYER_PERSONAS) expect(personaRun(clean, persona).result.bridge.equityPurchasePrice.amount).toBe(expected);
  });
});

describe('scenario weighting', () => {
  const cases = [
    { case: 'DOWNSIDE', equityPurchasePrice: '40000000' },
    { case: 'BASE', equityPurchasePrice: '50000000' },
    { case: 'UPSIDE', equityPurchasePrice: '70000000' },
  ] as const;

  it('weights the cases by persona and never pays above Base', () => {
    expect(weightedPrice(cases, 'QUALITY_COMPOUNDER').toFixed()).toBe('50000000');
    expect(weightedPrice(cases, 'VALUE_INVESTOR').toFixed()).toBe('50000000');
    // 0.5 × 40m + 0.4 × 50m + 0.1 × 70m.
    expect(weightedPrice(cases, 'GRAVE_DANCER').toFixed()).toBe('47000000');
  });

  it('renormalises over the cases present', () => {
    // Grave Dancer, downside and base only: (0.5 × 40m + 0.4 × 50m) ÷ 0.9.
    expect(weightedPrice(cases.slice(0, 2), 'GRAVE_DANCER').toFixed(2)).toBe('44444444.44');
    expect(weightedPrice([cases[1]], 'GRAVE_DANCER').toFixed()).toBe('50000000');
  });

  it('keeps the persona order on ordered cases', () => {
    const [compounder, value, grave] = (['QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER'] as const).map((persona) => weightedPrice(cases, persona));
    expect(compounder!.greaterThanOrEqualTo(value!) && value!.greaterThanOrEqualTo(grave!)).toBe(true);
  });
});

describe('term mix', () => {
  const mix = (persona: BuyerPersona) => {
    const run = personaRun(inputs, persona, keyPeople);
    return termMix(persona, new D(run.result.bridge.equityPurchasePrice.amount), run);
  };

  it('leads with structure for the Compounder and leverage for the Grave Dancer', () => {
    const compounder = mix('QUALITY_COMPOUNDER');
    expect(compounder.lines.map((line) => line.lever)).toEqual(['INDEMNITY', 'RETENTION', 'ESCROW', 'PRICE_REDUCTION']);
    expect(compounder.earnout.amount).toBe('0.00');

    const grave = mix('GRAVE_DANCER');
    expect(grave.lines[0]?.lever).toBe('ESCROW');
    expect(grave.lines.map((line) => line.lever)).toEqual(expect.arrayContaining(['EARNOUT', 'SELLER_FINANCING']));
    expect(new D(grave.earnout.amount).greaterThan(mix('VALUE_INVESTOR').earnout.amount)).toBe(true);
  });

  it('defers part of the price without changing it', () => {
    const grave = mix('GRAVE_DANCER');
    expect(grave.price.amount).toBe('57200000.00');
    // 57.2m − 2m escrow − 15% earnout − 10% seller note.
    expect(grave.cashAtClose.amount).toBe('40900000.00');
  });
});
