import { describe, expect, it } from 'vitest';
import { PACKS } from '../packs/registry';
import { categoriesForPack, categoryDefinition, isIntakeCategory } from './categories';
import { expectedInputs, intakeChecklist, missingRequest, type IntakeFile } from './checklist';
import { customerContractGaps, scaledAmount } from './customers';
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

describe('customer contract gaps', () => {
  const line = (customerId: string, customerName: string, amount: string) => ({ customerId, customerName, amount });
  const lines = [
    line('c1', 'Harborline Freight (synthetic)', '14500.00'),
    line('c1', 'Harborline Freight (synthetic)', '14500.00'),
    line('c2', 'Northgate Logistics (synthetic)', '8160.00'),
    line('c3', 'Granite Peak Energy (synthetic)', '6240.00'),
    line('c4', 'Copperfield Legal (synthetic)', '4200.10'),
    line('c5', 'Tidewater Marine (synthetic)', '0.00'),
  ];

  it('names the largest customers without a contract, largest first', () => {
    const gaps = customerContractGaps(lines, ['Northgate Logistics, LLC', 'HARBORLINE FREIGHT INC.'], 10);
    expect(gaps).toEqual({ checked: 4, missing: ['Granite Peak Energy (synthetic)', 'Copperfield Legal (synthetic)'] });
  });

  it('checks only the top N', () => {
    expect(customerContractGaps(lines, [], 2)).toEqual({ checked: 2, missing: ['Harborline Freight (synthetic)', 'Northgate Logistics (synthetic)'] });
  });

  it('sums money exactly', () => {
    expect(scaledAmount('0.1')).toBe(1000n);
    expect(scaledAmount('4200.10')).toBe(42001000n);
    expect(scaledAmount('-3.5')).toBe(-35000n);
    expect(scaledAmount('1e3')).toBeNull();
  });

  it('shows a received input with named gaps as partial, and lists the names in the request', () => {
    const items = intakeChecklist(
      saas,
      [{ id: 'c', fileName: 'msa.pdf', category: 'CUSTOMER_CONTRACT', intakeState: 'FILED' }],
      [],
      { CUSTOMER_CONTRACT: ['Granite Peak Energy', 'Copperfield Legal'] },
    );
    expect(items.find((item) => item.id === 'CUSTOMER_CONTRACT')).toMatchObject({ state: 'PARTIAL', missingFor: ['Granite Peak Energy', 'Copperfield Legal'] });
    expect(missingRequest(items)).toContain('- Customer contract: Granite Peak Energy, Copperfield Legal');
  });
});
