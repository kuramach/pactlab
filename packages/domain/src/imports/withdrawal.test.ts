import { describe, expect, it } from 'vitest';
import { DEAL_ROLES } from '../roles';
import { canManageImports, lineageOrder, reimportProblem, withdrawalProblem } from '.';

describe('import withdrawal (T-154)', () => {
  it('only an imported upload can be withdrawn, once, with a reason', () => {
    expect(withdrawalProblem('IMPORTED', 'Wrong month')).toBeNull();
    expect(withdrawalProblem('IMPORTED', '  ')).toBe('REASON_REQUIRED');
    expect(withdrawalProblem('UPLOADED', 'Wrong month')).toBe('NOT_IMPORTED');
    expect(withdrawalProblem('PURGED', 'Wrong month')).toBe('NOT_IMPORTED');
    expect(withdrawalProblem('WITHDRAWN', 'Wrong month')).toBe('ALREADY_WITHDRAWN');
  });

  it('manage rights are the deal team write right; counterparties and readers cannot withdraw', () => {
    const allowed = DEAL_ROLES.filter(canManageImports);
    expect(allowed).toEqual(['DEAL_LEAD', 'ANALYST']);
  });

  it('a re-import supersedes one withdrawn import of the same kind, once', () => {
    const withdrawn = { status: 'WITHDRAWN' as const, target: 'FINANCIAL_PNL', supersededByUploadId: null };
    expect(reimportProblem(withdrawn, 'FINANCIAL_PNL')).toBeNull();
    expect(reimportProblem({ ...withdrawn, status: 'IMPORTED' }, 'FINANCIAL_PNL')).toBe('NOT_WITHDRAWN');
    expect(reimportProblem({ ...withdrawn, supersededByUploadId: 'x' }, 'FINANCIAL_PNL')).toBe('ALREADY_SUPERSEDED');
    expect(reimportProblem(withdrawn, 'BILLING_INVOICE_LINE')).toBe('OTHER_TARGET');
  });

  it('orders a chain from its first version and stops on a cycle', () => {
    const rows = [
      { id: 'c', supersedesUploadId: 'b' },
      { id: 'a', supersedesUploadId: null },
      { id: 'b', supersedesUploadId: 'a' },
    ];
    expect(lineageOrder(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(lineageOrder([{ id: 'x', supersedesUploadId: 'y' }, { id: 'y', supersedesUploadId: 'x' }])).toEqual([]);
  });
});
