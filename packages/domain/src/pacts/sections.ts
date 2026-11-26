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
/**
 * A tab a pact will never have data for is hidden; one it may have later stays (Kumar, 2026-11-14).
 * A venture raise is negotiated on its Raise tab: it never has acquisition terms, a letter of intent,
 * a buyer's committee or financing, a closing checklist or a post-close register. Nor does a startup
 * equity SPV (T-141): the vehicle takes one line in a round; its work is on the SPV tab.
 */
const notRaise = (context: SectionContext) => context.companyType !== 'VENTURE_RAISE' && context.companyType !== 'STARTUP_SPV';
const buyerLedAcquisition = (context: SectionContext) => context.initiatedBy === 'BUYER' && notRaise(context);
const usesSource = (kinds: readonly string[]) => (context: SectionContext) =>
  context.companyType === null || sourcesFor(context.companyType).sources.some((source) => kinds.includes(source.kind));

export const DEAL_SECTION_RULES: Readonly<Record<string, (context: SectionContext) => boolean>> = {
  '': everywhere,
  '/bidders': (context) => context.initiatedBy === 'SELLER',
  '/listing': (context) => context.initiatedBy === 'SELLER',
  '/screening': everywhere,
  '/team': everywhere,
  // Connected AI apps' suggestions (T-084b): the pact's own side; shown where apps can connect.
  '/suggestions': everywhere,
  '/documents': everywhere,
  '/findings': everywhere,
  '/sources': everywhere,
  '/evidence': everywhere,
  '/finances': everywhere,
  // Quality of earnings (T-135): the pact's own-side analysis of an acquisition's earnings and working capital.
  '/qoe': notRaise,
  // Code and delivery analysis: only packs that collect code or delivery data.
  '/engineering': usesSource(['CODE', 'DELIVERY']),
  '/regulatory': everywhere,
  '/claims': everywhere,
  '/raise': (context) => context.companyType === 'VENTURE_RAISE',
  // The offering a sponsor raises equity on (T-106): terms, claims, track record and the waterfall check.
  '/syndication': (context) => context.companyType === 'MULTIFAMILY_SYNDICATION',
  // A music catalog's works and rights register, royalty income and termination exposure (T-140).
  '/catalog': (context) => context.companyType === 'MUSIC_RIGHTS',
  // An energy package's asset and interest register, reserves and production, and liabilities (T-142).
  '/energy': (context) => context.companyType === 'ENERGY_GENERATION',
  // A fintech target's payments and licence checks (T-159): volume and take rate recomputed, the claims, licences, loss rates and compliance evidence.
  '/fintech': (context) => context.companyType === 'FINTECH',
  // A healthcare services target's practice checks (T-160): payer mix and collections, denials and days in AR, credentialing, clinician concentration and compliance evidence.
  // Small clinics reuse it as it is (T-161): the same evidence set, scaled to a few sites.
  '/healthcare': (context) => context.companyType === 'HEALTHCARE' || context.companyType === 'SMALL_CLINICS',
  // A few-site clinic's own checks (T-161): the owner-operator's share by service line, referral concentration and the clinic lease.
  '/clinics': (context) => context.companyType === 'SMALL_CLINICS',
  // A pharma or biotech target (T-163): pipeline claims, the patent estate, licence obligations, dependence and burn against the timeline.
  '/pharma': (context) => context.companyType === 'PHARMA_BIOTECH',
  // A pooled vehicle (T-141): the round checks, the vehicle economics, side letters, investor seats and the published investor view.
  '/spv': (context) => context.companyType === 'STARTUP_SPV',
  '/valuation': everywhere,
  '/foresight': everywhere,
  '/terms': buyerLedAcquisition,
  // A letter of intent from the agreed terms (T-119): buyer-led pacts, both sides.
  '/loi': buyerLedAcquisition,
  // The buyer's investment committee (T-118): a buyer-led pact's own side.
  '/ic': buyerLedAcquisition,
  // How the buyer funds the deal (T-117): every acquisition; each bidder keeps their own on a seller-led one.
  '/financing': notRaise,
  '/closing': buyerLedAcquisition,
  '/post-close': notRaise,
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
