import { COMPANY_TYPES, type CompanyType } from './types';
import { sourcesFor } from './catalog';

/**
 * Which deal sections a pact shows (batch 2): one table, built from the pack
 * catalog rather than kept page by page. A section with no rule here fails the
 * test, so a new section always decides where it applies.
 */
export interface SectionContext {
  /** The seller's company type; null for pacts started before it was recorded (everything shows). */
  readonly companyType: CompanyType | null;
  readonly initiatedBy: 'BUYER' | 'SELLER';
}

const everywhere = () => true;
const usesSource = (kinds: readonly string[]) => (context: SectionContext) =>
  context.companyType === null || sourcesFor(context.companyType).sources.some((source) => kinds.includes(source.kind));

export const DEAL_SECTION_RULES: Readonly<Record<string, (context: SectionContext) => boolean>> = {
  '': everywhere,
  '/bidders': (context) => context.initiatedBy === 'SELLER',
  '/listing': (context) => context.initiatedBy === 'SELLER',
  '/screening': everywhere,
  '/team': everywhere,
  '/documents': everywhere,
  '/findings': everywhere,
  '/sources': everywhere,
  '/evidence': everywhere,
  '/finances': everywhere,
  // Code and delivery analysis: only packs that collect code or delivery data.
  '/engineering': usesSource(['CODE', 'DELIVERY']),
  '/regulatory': everywhere,
  '/claims': everywhere,
  '/raise': (context) => context.companyType === 'VENTURE_RAISE',
  '/valuation': everywhere,
  '/foresight': everywhere,
  '/terms': (context) => context.initiatedBy === 'BUYER',
  // The buyer's investment committee (T-118): a buyer-led pact's own side.
  '/ic': (context) => context.initiatedBy === 'BUYER',
  '/closing': (context) => context.initiatedBy === 'BUYER',
  '/post-close': everywhere,
};

export function sectionApplies(path: string, context: SectionContext): boolean {
  const rule = DEAL_SECTION_RULES[path];
  return rule ? rule(context) : true;
}

/** Packs whose businesses sell subscriptions: the ARR, retention and churn cards apply. */
export const SUBSCRIPTION_COMPANY_TYPES: readonly CompanyType[] = ['SOFTWARE_SAAS', 'FINTECH', 'TELECOM_MEDIA', 'ECOMMERCE_DTC', 'VENTURE_RAISE'];

export function hasSubscriptionMetrics(companyType: CompanyType | null): boolean {
  return companyType === null || SUBSCRIPTION_COMPANY_TYPES.includes(companyType);
}

/** Every company type a section applies to, for messages such as "Engineering doesn't apply to Multifamily pacts". */
export function sectionCompanyTypes(path: string, initiatedBy: 'BUYER' | 'SELLER' = 'BUYER'): CompanyType[] {
  return COMPANY_TYPES.filter((companyType) => sectionApplies(path, { companyType, initiatedBy }));
}
