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
    // The sponsor's offering (T-106): only on a multifamily syndication, never on Multifamily itself.
    expect(sectionApplies('/syndication', { companyType: 'MULTIFAMILY_SYNDICATION', initiatedBy: 'BUYER' })).toBe(true);
    expect(sectionApplies('/syndication', { companyType: 'MULTIFAMILY', initiatedBy: 'BUYER' })).toBe(false);
    expect(sectionCompanyTypes('/syndication')).toEqual(['MULTIFAMILY_SYNDICATION']);
    // A music catalog's register (T-140): only on a music rights pact.
    expect(sectionCompanyTypes('/catalog')).toEqual(['MUSIC_RIGHTS']);
    // An energy package's register (T-142): only on an energy generation & rights pact.
    expect(sectionCompanyTypes('/energy')).toEqual(['ENERGY_GENERATION']);
    // A fintech target's payments and licence checks (T-159): only on a fintech pact.
    expect(sectionCompanyTypes('/fintech')).toEqual(['FINTECH']);
    // A healthcare services target's practice checks (T-160): on a healthcare pact and its few-site clinic variant (T-161), never hospitals.
    expect(sectionCompanyTypes('/healthcare')).toEqual(['HEALTHCARE', 'SMALL_CLINICS']);
    // A clinic's owner-operator, referral and premises checks (T-161): only on a small clinics pact.
    expect(sectionCompanyTypes('/clinics')).toEqual(['SMALL_CLINICS']);
    // A pharma or biotech target's pipeline, patent and obligation checks (T-163): only on a pharma pact.
    expect(sectionCompanyTypes('/pharma')).toEqual(['PHARMA_BIOTECH']);
    // An e-commerce brand's channel, unit-economics, platform and stock checks (T-164): only on an e-commerce pact.
    expect(sectionCompanyTypes('/ecommerce')).toEqual(['ECOMMERCE_DTC']);
    // A services firm's realization, concentration, ageing and covenant checks (T-167): only on a professional services pact.
    expect(sectionCompanyTypes('/services')).toEqual(['PROFESSIONAL_SERVICES']);
    // A pooled vehicle's seats, economics and investor view (T-141): only on a startup equity SPV, which has no acquisition close.
    expect(sectionCompanyTypes('/spv')).toEqual(['STARTUP_SPV']);
    expect(sectionApplies('/closing', { companyType: 'STARTUP_SPV', initiatedBy: 'BUYER' })).toBe(false);
  });

  it('shows subscription metrics only for subscription businesses', () => {
    expect(hasSubscriptionMetrics('SOFTWARE_SAAS')).toBe(true);
    expect(hasSubscriptionMetrics('MULTIFAMILY')).toBe(false);
    expect(hasSubscriptionMetrics('HOTELS')).toBe(false);
  });
});

describe('tabs a pact will never fill are hidden (Kumar, 2026-11-14)', () => {
  it('a venture raise shows no acquisition terms, letter, committee, financing, closing or post-close', () => {
    for (const path of ['/terms', '/loi', '/ic', '/financing', '/closing', '/post-close']) {
      expect(sectionApplies(path, { companyType: 'VENTURE_RAISE', initiatedBy: 'BUYER' }), path).toBe(false);
      expect(sectionApplies(path, { companyType: 'SOFTWARE_SAAS', initiatedBy: 'BUYER' }), path).toBe(true);
    }
    expect(sectionApplies('/raise', { companyType: 'VENTURE_RAISE', initiatedBy: 'BUYER' })).toBe(true);
  });

  it('a seller-led sale keeps the diligence tabs: the seller can fill them later', () => {
    for (const path of ['/documents', '/findings', '/finances', '/valuation', '/financing']) expect(sectionApplies(path, { companyType: 'MULTIFAMILY', initiatedBy: 'SELLER' }), path).toBe(true);
  });
});
