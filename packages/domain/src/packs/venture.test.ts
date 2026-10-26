import { describe, expect, it } from 'vitest';
import { readinessOf, strictestCounterparty } from './venture';

describe('venture raise readiness (T-083)', () => {
  const held = { importTargets: ['VENTURE_CAP_TABLE', 'BILLING_INVOICE_LINE'], documentNames: ['01-investor-deck.pdf', '02-certificate-of-incorporation.pdf'], connectionProviders: [] };

  it('angels ask for a light set; venture firms for the full institutional pass', () => {
    const angel = readinessOf('ANGEL', held);
    const vc = readinessOf('VC', held);
    expect(angel).toMatchObject({ complete: true, present: 4, total: 4 });
    expect(vc.total).toBeGreaterThan(readinessOf('INCUBATOR', held).total);
    expect(vc.items.filter((item) => !item.present).map((item) => item.id)).toEqual(['founder-agreements', 'financials', 'bylaws', 'ip-assignments', '83b', 'prior-rounds', 'code']);
    expect(vc.items.find((item) => item.id === 'deck')).toMatchObject({ present: true, evidence: '01-investor-deck.pdf' });
  });

  it('the strictest active counterparty decides the default checklist', () => {
    expect(strictestCounterparty(['ANGEL', 'VC', 'INCUBATOR'])).toBe('VC');
    expect(strictestCounterparty(['ANGEL', 'INCUBATOR'])).toBe('INCUBATOR');
    expect(strictestCounterparty([])).toBe('ANGEL');
  });
});
