import { describe, expect, it } from 'vitest';
import { newId, isUuid } from './ids';
import { permissionsForDealRole } from './roles';

describe('roles', () => {
  it('never grants buyer-only analysis to target contributors', () => {
    expect(permissionsForDealRole('TARGET_CONTRIBUTOR').has('BUYER_ANALYSIS_READ')).toBe(false);
    expect(permissionsForDealRole('ANALYST').has('BUYER_ANALYSIS_READ')).toBe(true);
  });
});

describe('newId', () => {
  it('produces time-ordered UUIDv7 identifiers', () => {
    const first = newId();
    const second = newId();
    expect(isUuid(first)).toBe(true);
    expect(first.charAt(14)).toBe('7');
    expect(first < second).toBe(true);
  });
});
