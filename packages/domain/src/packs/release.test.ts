import { describe, expect, it } from 'vitest';
import { COMPANY_TYPES } from '../pacts/types';
import { isReleasedCompanyType, RELEASED_COMPANY_TYPES, selectableCompanyTypes } from './release';

describe('released packs', () => {
  it('launches with Software & SaaS and Multifamily only', () => {
    expect([...RELEASED_COMPANY_TYPES]).toEqual(['SOFTWARE_SAAS', 'MULTIFAMILY']);
    expect(isReleasedCompanyType('HOSPITALS')).toBe(false);
    expect(isReleasedCompanyType('OTHER')).toBe(false);
    expect(isReleasedCompanyType('VENTURE_RAISE')).toBe(false);
  });

  it('offers every type in preview, and only released ones otherwise', () => {
    expect(selectableCompanyTypes(true)).toEqual(COMPANY_TYPES);
    expect(selectableCompanyTypes(false)).toEqual(['SOFTWARE_SAAS', 'MULTIFAMILY']);
  });
});
