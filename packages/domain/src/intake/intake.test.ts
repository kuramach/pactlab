import { describe, expect, it } from 'vitest';
import { PACKS } from '../packs/registry';
import { categoriesForPack, categoryDefinition, isIntakeCategory } from './categories';
import { expectedInputs, intakeChecklist, missingRequest, type IntakeFile } from './checklist';
import { decideIntake } from './decide';

const saas = PACKS.SOFTWARE_SAAS;
const multifamily = PACKS.MULTIFAMILY;

describe('intake categories', () => {
  it('offers the pack import targets beside the document categories', () => {
    const ids = categoriesForPack(multifamily).map((category) => category.id);
    expect(ids).toContain('MULTIFAMILY_RENT_ROLL');
    expect(ids).toContain('BALANCE_SHEET');
    expect(ids).not.toContain('CRE_RENT_ROLL');
    expect(isIntakeCategory(saas, 'MULTIFAMILY_RENT_ROLL')).toBe(false);
  });

  it('routes each category to its next step', () => {
    expect(categoryDefinition('MULTIFAMILY_RENT_ROLL').route).toEqual({ kind: 'IMPORT', target: 'MULTIFAMILY_RENT_ROLL' });
    expect(categoryDefinition('BALANCE_SHEET').route.kind).toBe('BALANCE_SHEET');
    expect(categoryDefinition('CUSTOMER_CONTRACT').route.kind).toBe('EXTRACT');
    expect(categoryDefinition('PEOPLE_RECORD').people).toBe(true);
  });
});

describe('decideIntake', () => {
  it('files a clear document with no human step', () => {
    expect(decideIntake(saas, { category: 'CUSTOMER_CONTRACT', confidence: 0.95, alternatives: [], question: null })).toEqual({
      state: 'FILED',
      category: 'CUSTOMER_CONTRACT',
    });
  });

  it('needs more certainty for files that feed numbers', () => {
    const proposal = { confidence: 0.85, alternatives: [], question: null };
    expect(decideIntake(saas, { ...proposal, category: 'CUSTOMER_CONTRACT' }).state).toBe('FILED');
    expect(decideIntake(saas, { ...proposal, category: 'BILLING_INVOICE_LINE' }).state).toBe('NEEDS_YOU');
    expect(decideIntake(saas, { ...proposal, category: 'BALANCE_SHEET' }).state).toBe('NEEDS_YOU');
  });

  it('asks when two categories are close', () => {
    const decision = decideIntake(saas, {
      category: 'INCOME_STATEMENT',
      confidence: 0.92,
      alternatives: [{ category: 'CASH_FLOW_STATEMENT', confidence: 0.85 }],
      question: null,
    });
    expect(decision).toEqual({
      state: 'NEEDS_YOU',
      category: 'INCOME_STATEMENT',
      question: 'Is this an income statement (P&L) or a cash flow statement?',
    });
  });

  it('ignores runners-up the pack does not offer', () => {
    const decision = decideIntake(saas, {
      category: 'INCOME_STATEMENT',
      confidence: 0.92,
      alternatives: [{ category: 'MULTIFAMILY_T12', confidence: 0.9 }],
      question: null,
    });
    expect(decision.state).toBe('FILED');
  });

  it('asks when the model returns a category the pack does not offer', () => {
    expect(decideIntake(saas, { category: 'MULTIFAMILY_RENT_ROLL', confidence: 0.99, alternatives: [], question: null })).toEqual({
      state: 'NEEDS_YOU',
      category: null,
      question: 'What is this file?',
    });
  });

  it('asks the model question even when confident', () => {
    const decision = decideIntake(saas, {
      category: 'BALANCE_SHEET',
      confidence: 0.97,
      alternatives: [],
      question: 'This balance sheet is for Brightwave Holdings, not Brightwave Inc. Is that the target?',
    });
    expect(decision.state).toBe('NEEDS_YOU');
  });
});

describe('intake checklist', () => {
  const file = (id: string, category: IntakeFile['category'], intakeState: IntakeFile['intakeState'] = 'FILED'): IntakeFile => ({
    id,
    fileName: `${id}.pdf`,
    category,
    intakeState,
  });

  it('derives what a SaaS pact expects', () => {
    const inputs = expectedInputs(saas);
    expect(inputs).toContainEqual({ id: 'BILLING_INVOICE_LINE', need: 'REQUIRED' });
    expect(inputs).toContainEqual({ id: 'CUSTOMER_CONTRACT', need: 'REQUIRED' });
    expect(inputs).toContainEqual({ id: 'CODE_AND_DELIVERY', need: 'OPTIONAL' });
  });

  it('makes billing optional outside software-like packs', () => {
    expect(expectedInputs(multifamily)).toContainEqual({ id: 'BILLING_INVOICE_LINE', need: 'OPTIONAL' });
    expect(expectedInputs(multifamily)).toContainEqual({ id: 'MULTIFAMILY_RENT_ROLL', need: 'REQUIRED' });
    expect(expectedInputs(multifamily)).toContainEqual({ id: 'LEASE', need: 'REQUIRED' });
  });

  it('counts only settled files and prefers connections', () => {
    const items = intakeChecklist(
      saas,
      [file('bs', 'BALANCE_SHEET'), file('pl', 'INCOME_STATEMENT', 'NEEDS_YOU'), file('inv', 'BILLING_INVOICE_LINE')],
      ['stripe', 'github'],
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get('BALANCE_SHEET')).toMatchObject({ state: 'RECEIVED', documentIds: ['bs'] });
    expect(byId.get('INCOME_STATEMENT')?.state).toBe('MISSING');
    expect(byId.get('BILLING_INVOICE_LINE')).toMatchObject({ state: 'CONNECTED', connections: ['stripe'], documentIds: ['inv'] });
    expect(byId.get('CODE_AND_DELIVERY')).toMatchObject({ state: 'CONNECTED', connections: ['github'] });
  });

  it('offers connections for a missing input that one can feed', () => {
    const delivery = intakeChecklist(saas, [], []).find((item) => item.id === 'CODE_AND_DELIVERY');
    expect(delivery).toMatchObject({ state: 'MISSING', connectable: ['github', 'jira'] });
  });

  it('writes the request list with required items first', () => {
    const items = intakeChecklist(saas, [file('bs', 'BALANCE_SHEET')], ['stripe', 'github']);
    const text = missingRequest(items);
    expect(text.startsWith('Please share:\n- Income statement (P&L)\n- Customer contract')).toBe(true);
    expect(text).toContain('If available, also:\n- Lease');
    expect(text).not.toContain('Balance sheet');
    expect(text).not.toContain('Invoice lines');
  });
});
