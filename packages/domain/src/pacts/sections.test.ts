import { describe, expect, it } from 'vitest';
import { hasSubscriptionMetrics, sectionApplies, sectionCompanyTypes } from './sections';

describe('deal sections per pact (batch 2)', () => {
  it('shows Engineering only for packs with code or delivery data', () => {
    expect(sectionApplies('/engineering', { companyType: 'SOFTWARE_SAAS', initiatedBy: 'BUYER' })).toBe(true);
    expect(sectionApplies('/engineering', { companyType: 'PROFESSIONAL_SERVICES', initiatedBy: 'BUYER' })).toBe(true);
    for (const companyType of ['MULTIFAMILY', 'COMMERCIAL_PROPERTY', 'HOTELS', 'SMALL_CLINICS', 'HOSPITALS', 'PHARMA_BIOTECH', 'OTHER'] as const) {
      expect(sectionApplies('/engineering', { companyType, initiatedBy: 'BUYER' }), companyType).toBe(false);
    }
    expect(sectionApplies('/engineering', { companyType: null, initiatedBy: 'BUYER' })).toBe(true);
    expect(sectionCompanyTypes('/engineering')).not.toContain('MULTIFAMILY');
  });

  it('keeps the side- and pack-specific sections where they were', () => {
    expect(sectionApplies('/bidders', { companyType: 'SOFTWARE_SAAS', initiatedBy: 'BUYER' })).toBe(false);
    expect(sectionApplies('/listing', { companyType: 'MULTIFAMILY', initiatedBy: 'SELLER' })).toBe(true);
    expect(sectionApplies('/terms', { companyType: 'MULTIFAMILY', initiatedBy: 'SELLER' })).toBe(false);
    expect(sectionApplies('/raise', { companyType: 'VENTURE_RAISE', initiatedBy: 'SELLER' })).toBe(true);
    expect(sectionApplies('/raise', { companyType: 'SOFTWARE_SAAS', initiatedBy: 'BUYER' })).toBe(false);
  });

  it('shows subscription metrics only for subscription businesses', () => {
    expect(hasSubscriptionMetrics('SOFTWARE_SAAS')).toBe(true);
    expect(hasSubscriptionMetrics('MULTIFAMILY')).toBe(false);
    expect(hasSubscriptionMetrics('HOTELS')).toBe(false);
  });
});
