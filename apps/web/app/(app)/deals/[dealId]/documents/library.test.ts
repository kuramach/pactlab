import { describe, expect, it } from 'vitest';
import type { DocumentIntakeView } from '../../../documents/_lib/view';
import { categoryCell } from './library';

const intake = (overrides: Partial<DocumentIntakeView>): { intake: DocumentIntakeView } => ({
  intake: {
    state: 'FILED',
    category: 'CUSTOMER_CONTRACT',
    source: 'AI',
    confidence: 0.96,
    reason: 'Titled Master Subscription Agreement.',
    question: null,
    entityName: null,
    counterpartyName: null,
    sourcePath: null,
    ...overrides,
  },
});
const labels = { CUSTOMER_CONTRACT: 'Customer contract' };

describe('library category column (T-098)', () => {
  it('names the category, the customer and who filed it', () => {
    expect(categoryCell(intake({ counterpartyName: 'Acme Logistics LLC' }), labels)).toEqual({
      label: 'Customer contract · Acme Logistics LLC',
      tone: 'reviewed',
      title: 'Filed by AI (96% sure) — Titled Master Subscription Agreement.',
    });
    expect(categoryCell(intake({ source: 'PERSON', confidence: null, reason: null }), labels).title).toBe('Filed by a person');
  });

  it('flags files waiting for a person, with the question on hover', () => {
    expect(categoryCell(intake({ state: 'NEEDS_YOU', question: 'Is this a lease?' }), labels)).toEqual({ label: 'Needs you', tone: 'draft', title: 'Is this a lease?' });
    expect(categoryCell(intake({ state: 'NOT_READ', question: null }), labels)).toEqual({ label: 'Needs you', tone: 'draft' });
  });

  it('shows documents from before intake as not sorted', () => {
    expect(categoryCell({ intake: undefined }, labels)).toEqual({ label: 'Not sorted', tone: 'neutral' });
  });
});
