import { describe, expect, it } from 'vitest';
import { COMPANY_TYPES } from '../pacts/types';
import { isReleasedCompanyType, RELEASED_COMPANY_TYPES, selectableCompanyTypes } from './release';

describe('released packs', () => {
  it('sells Software & SaaS, Multifamily, Venture Raise, Music rights, Energy generation & rights, Startup equity SPV, Fintech, Healthcare, Small clinics, Pharma & biotech, E-commerce & DTC, IT & professional services, Telecom & media, Hospitals, Commercial property and Hotels only', () => {
    expect([...RELEASED_COMPANY_TYPES]).toEqual(['SOFTWARE_SAAS', 'MULTIFAMILY', 'VENTURE_RAISE', 'MUSIC_RIGHTS', 'ENERGY_GENERATION', 'STARTUP_SPV', 'FINTECH', 'HEALTHCARE', 'SMALL_CLINICS', 'PHARMA_BIOTECH', 'ECOMMERCE_DTC', 'PROFESSIONAL_SERVICES', 'TELECOM_MEDIA', 'HOSPITALS', 'COMMERCIAL_PROPERTY', 'HOTELS']);
    expect(isReleasedCompanyType('HOSPITALS')).toBe(true);
    expect(isReleasedCompanyType('COMMERCIAL_PROPERTY')).toBe(true);
    expect(isReleasedCompanyType('HOTELS')).toBe(true);
    expect(isReleasedCompanyType('OTHER')).toBe(false);
    expect(isReleasedCompanyType('VENTURE_RAISE')).toBe(true);
  });

  it('offers every type in preview, and only released ones otherwise', () => {
    expect(selectableCompanyTypes(true)).toEqual(COMPANY_TYPES);
    expect(selectableCompanyTypes(false)).toEqual(['SOFTWARE_SAAS', 'MULTIFAMILY', 'VENTURE_RAISE', 'MUSIC_RIGHTS', 'ENERGY_GENERATION', 'STARTUP_SPV', 'FINTECH', 'HEALTHCARE', 'SMALL_CLINICS', 'PHARMA_BIOTECH', 'ECOMMERCE_DTC', 'PROFESSIONAL_SERVICES', 'TELECOM_MEDIA', 'HOSPITALS', 'COMMERCIAL_PROPERTY', 'HOTELS']);
  });
});
