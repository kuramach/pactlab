/**
 * Telecom and media (T-168, ADR 0056): subscriber claims, rights windows and revenue concentration. This
 * file is the registry of the codes the telecom imports use and the words the Subscribers page carries.
 * Pactlab reports documents, dates and arithmetic: it never judges content, a market or a counterparty.
 */

/** What kind of agreement a rights and carriage register row is. */
export const TELECOM_AGREEMENT_KINDS = ['affiliate', 'carriage', 'content_licence', 'sports_rights', 'other'] as const;
export type TelecomAgreementKind = (typeof TELECOM_AGREEMENT_KINDS)[number];
export const TELECOM_AGREEMENT_KIND_LABELS = {
  affiliate: 'Affiliate agreement',
  carriage: 'Carriage agreement',
  content_licence: 'Content licence',
  sports_rights: 'Sports rights',
  other: 'Other licence',
} as const satisfies Record<TelecomAgreementKind, string>;

/** Whether the company is paid under an agreement or pays under it. */
export const TELECOM_AGREEMENT_FLOWS = ['receivable', 'payable'] as const;
export type TelecomAgreementFlow = (typeof TELECOM_AGREEMENT_FLOWS)[number];
export const TELECOM_AGREEMENT_FLOW_LABELS = {
  receivable: 'The company is paid',
  payable: 'The company pays',
} as const satisfies Record<TelecomAgreementFlow, string>;

/** Where an agreement stands against the window after the expected closing. */
export const TELECOM_AGREEMENT_STATES = ['ENDS_BEFORE_CLOSING', 'ENDS_IN_WINDOW', 'RENEWS', 'ENDS_LATER', 'NO_END'] as const;
export type TelecomAgreementState = (typeof TELECOM_AGREEMENT_STATES)[number];
export const TELECOM_AGREEMENT_STATE_LABELS = {
  ENDS_BEFORE_CLOSING: 'Ends before the closing',
  ENDS_IN_WINDOW: 'Ends within 12 months of the closing',
  RENEWS: 'Renews automatically',
  ENDS_LATER: 'Ends later',
  NO_END: 'No end date stated',
} as const satisfies Record<TelecomAgreementState, string>;

/** The non-subscription revenue streams read by counterparty. */
export const TELECOM_REVENUE_STREAMS_CODES = ['advertising', 'affiliate'] as const;
export type TelecomRevenueStream = (typeof TELECOM_REVENUE_STREAMS_CODES)[number];
export const TELECOM_REVENUE_STREAM_LABELS = {
  advertising: 'Advertising',
  affiliate: 'Affiliate fees',
} as const satisfies Record<TelecomRevenueStream, string>;

/** Capital expenditure categories. */
export const TELECOM_CAPEX_CATEGORIES = ['network', 'customer_premises', 'it', 'content', 'other'] as const;
export type TelecomCapexCategory = (typeof TELECOM_CAPEX_CATEGORIES)[number];
export const TELECOM_CAPEX_CATEGORY_LABELS = {
  network: 'Network',
  customer_premises: 'Customer premises equipment',
  it: 'IT and systems',
  content: 'Content',
  other: 'Other',
} as const satisfies Record<TelecomCapexCategory, string>;

/** The subscriber claims a deck may state, checked against the subscriber movements export. */
export const TELECOM_CLAIM_KEYS = ['SUBSCRIBERS', 'CHURN', 'ARPU'] as const;
export type TelecomClaimKey = (typeof TELECOM_CLAIM_KEYS)[number];
export const TELECOM_CLAIM_LABELS = {
  SUBSCRIBERS: 'Subscribers',
  CHURN: 'Monthly churn',
  ARPU: 'ARPU',
} as const satisfies Record<TelecomClaimKey, string>;

export const TELECOM_GUARDRAIL =
  'Diligence support, not a content or market judgment: Pactlab reports what the exports, the register and the agreements state, the dates they give and the arithmetic. It never judges a programme, a market, a counterparty or whether an agreement will be renewed.';
export const TELECOM_NO_INVENTED_FIGURES =
  'Every figure comes from an import (subscriber movements, subscribers by month, the rights register, advertising and affiliate revenue, capital expenditure, the P&L, billing) or a sentence quoted from a document; what none of them states is shown as missing, never filled in.';
