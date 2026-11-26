/**
 * E-commerce and DTC (T-164, ADR 0054): channel economics, cohort value and platform dependence. This
 * file is the registry of the codes the e-commerce imports use and the words the Channels page carries.
 * Pactlab reads exports and documents only: it never scrapes a marketplace or an ad platform, and the
 * absence of an export is shown as absence.
 */

/** What kind of sales channel an orders row ran through. */
export const ECOMMERCE_PLATFORM_KINDS = ['storefront', 'marketplace', 'wholesale'] as const;
export type EcommercePlatformKind = (typeof ECOMMERCE_PLATFORM_KINDS)[number];
export const ECOMMERCE_PLATFORM_KIND_LABELS = {
  storefront: 'Own storefront',
  marketplace: 'Marketplace',
  wholesale: 'Wholesale',
} as const satisfies Record<EcommercePlatformKind, string>;

/** Who a document says a platform account is registered to. */
export const ECOMMERCE_ACCOUNT_OWNERS = ['COMPANY', 'PERSONAL', 'UNSTATED'] as const;
export type EcommerceAccountOwner = (typeof ECOMMERCE_ACCOUNT_OWNERS)[number];
export const ECOMMERCE_ACCOUNT_OWNER_LABELS = {
  COMPANY: 'The company',
  PERSONAL: 'An individual, personally',
  UNSTATED: 'Not stated in the documents',
} as const satisfies Record<EcommerceAccountOwner, string>;

/** The unit-economics claims a deck may state, checked against the exports. */
export const ECOMMERCE_CLAIM_KEYS = ['LTV', 'CAC'] as const;
export type EcommerceClaimKey = (typeof ECOMMERCE_CLAIM_KEYS)[number];
export const ECOMMERCE_CLAIM_LABELS = {
  LTV: 'Customer lifetime value',
  CAC: 'Paid customer acquisition cost',
} as const satisfies Record<EcommerceClaimKey, string>;

export const ECOMMERCE_GUARDRAIL =
  'Diligence support from exports and documents only: Pactlab never scrapes a marketplace or an ad platform, and never logs in to one. It recomputes revenue, contribution, acquisition cost, returns and stock age from the exports supplied, and reads who holds each account from the documents.';
export const ECOMMERCE_NO_INVENTED_FIGURES =
  'Every figure comes from an import (orders by channel, cohorts, ad spend, the stock report, the P&L) or a sentence quoted from a document; what none of them states is shown as missing, never filled in.';
