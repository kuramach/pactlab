/**
 * Pact activity notifications (T-145, ADR 0045): the small, explicit catalogue of events a person
 * is told about, each with an urgency. An event is recorded where its change happens, in the same
 * transaction; recipients follow access (server-side, under the definer function `app_notify`).
 *
 * What a notification says is fixed here, per type: plain words and the pact's name, never an
 * amount, a valuation, compensation, document text or a named person's HR data (rule 7).
 */

export const NOTIFICATION_URGENCIES = ['ACT_NOW', 'FYI'] as const;
export type NotificationUrgency = (typeof NOTIFICATION_URGENCIES)[number];

export const NOTIFICATION_EVENT_TYPES = [
  // Act now (immediate)
  'SIGNATURE_REQUESTED',
  'TERMS_PROPOSED',
  'TERMS_COUNTERED',
  'DEADLINE_NEAR',
  'IC_DECIDED',
  'QUESTION_ASKED',
  // For your information (digest)
  'DOCUMENT_ADDED',
  'FINDING_DRAFTED',
  'FINDING_DECIDED',
  'MEMBER_ADDED',
  'VALUATION_SUBMITTED',
  'SYNC_FINISHED',
  'SYNC_FAILED',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** Where in the pact an event's item links to: a tab under `/deals/<id>/`. */
export type NotificationSection = 'closing' | 'terms' | 'loi' | 'ic' | 'bid' | 'documents' | 'findings' | 'team' | 'valuation' | 'sources';

export interface NotificationEventDefinition {
  readonly urgency: NotificationUrgency;
  /** The item's headline, in plain words. The pact's name is shown beside it, never inside. */
  readonly title: string;
  readonly section: NotificationSection;
}

export const NOTIFICATION_EVENTS = {
  SIGNATURE_REQUESTED: { urgency: 'ACT_NOW', title: 'Your signature is requested', section: 'closing' },
  TERMS_PROPOSED: { urgency: 'ACT_NOW', title: 'New terms are waiting for your answer', section: 'terms' },
  TERMS_COUNTERED: { urgency: 'ACT_NOW', title: 'The other side answered your terms', section: 'terms' },
  DEADLINE_NEAR: { urgency: 'ACT_NOW', title: 'A deadline is less than two days away', section: 'loi' },
  IC_DECIDED: { urgency: 'ACT_NOW', title: 'The investment committee has decided', section: 'ic' },
  QUESTION_ASKED: { urgency: 'ACT_NOW', title: 'A question is waiting for you', section: 'bid' },
  DOCUMENT_ADDED: { urgency: 'FYI', title: 'The other side added a document', section: 'documents' },
  FINDING_DRAFTED: { urgency: 'FYI', title: 'A finding was drafted', section: 'findings' },
  FINDING_DECIDED: { urgency: 'FYI', title: 'A finding was reviewed', section: 'findings' },
  MEMBER_ADDED: { urgency: 'FYI', title: 'Someone joined the pact', section: 'team' },
  VALUATION_SUBMITTED: { urgency: 'FYI', title: 'A valuation scenario was submitted', section: 'valuation' },
  SYNC_FINISHED: { urgency: 'FYI', title: 'A data sync finished', section: 'sources' },
  SYNC_FAILED: { urgency: 'FYI', title: 'A data sync failed', section: 'sources' },
} as const satisfies Record<NotificationEventType, NotificationEventDefinition>;

/**
 * Who on the pact an event is for, before access filters it (computed server-side, never from
 * client input):
 * - ALL: everyone on the pact the visibility admits;
 * - OWN_SIDE: the pact's own side (never a target contributor, bidder or investor);
 * - COUNTERPARTY: the other party (the seller's contributors; the bid's bidders);
 * - OWN_LEADS: the own side's deal leads;
 * - USERS: named people (a signatory, the person who asked), still filtered by access.
 */
export const NOTIFICATION_AUDIENCES = ['ALL', 'OWN_SIDE', 'COUNTERPARTY', 'OWN_LEADS', 'USERS'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/** SHARED: both sides may see what the event is about. BUYER_ONLY: the pact's own side only. */
export type NotificationVisibility = 'SHARED' | 'BUYER_ONLY';

/** The exact place in the pact an item links to: its tab, or a record under it (a finding). */
export function notificationLink(type: NotificationEventType, dealId: string, recordId?: string | null): string {
  const section = NOTIFICATION_EVENTS[type].section;
  const base = `/deals/${dealId}/${section}`;
  return section === 'findings' && recordId ? `${base}/${recordId}` : base;
}

/** A link stored on an event must stay inside the pact it belongs to. */
export function isPactLink(link: string, dealId: string): boolean {
  return new RegExp(`^/deals/${dealId}/[a-z-]+(/[0-9a-f-]{36})?$`).test(link);
}
