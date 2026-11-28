import { z } from 'zod';

/**
 * Product-help chat (T-175): the same request on the public site and in the app. The conversation lives
 * with the visitor (the panel sends its last turns back); the server keeps none of it.
 */
export const SUPPORT_CHAT_LOCALES = ['en', 'de', 'fr', 'ja'] as const;
export type SupportChatLocale = (typeof SUPPORT_CHAT_LOCALES)[number];

const turnSchema = z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) });
export type SupportChatTurn = z.infer<typeof turnSchema>;

/** The path of the page the person is on: the only context the assistant is given about where they are. */
const pagePath = z.string().max(300).regex(/^\/[^\s<>"]*$/);

export const supportChatMessageSchema = z.strictObject({
  locale: z.enum(SUPPORT_CHAT_LOCALES).default('en'),
  page: pagePath.default('/'),
  question: z.string().trim().min(1).max(1000),
  history: z.array(turnSchema).max(10).default([]),
  /** Random, made by the panel when it opens: the rate-limit key for one conversation. */
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});
export type SupportChatMessage = z.infer<typeof supportChatMessageSchema>;

export type SupportChatReplyKind = 'ANSWER' | 'STEPS' | 'DONT_KNOW' | 'BOUNDARY' | 'FEATURE_REQUEST' | 'UNAVAILABLE' | 'LIMITED';

export interface SupportChatReplyView {
  kind: SupportChatReplyKind;
  text: string;
  steps: string[];
  /** The pages and guides the answer came from. */
  citations: { title: string; href: string }[];
  /** The app screen the steps describe (in-app: a path; on the site: null, as site visitors are signed out). */
  deepLink: { label: string; href: string } | null;
  /** The language the answer is in, and the note saying so when it differs from the page's. */
  answeredIn: SupportChatLocale;
  localeNote: string | null;
  /** Offer to pass the question to the team by email (don't-know and boundary). */
  offerEmail: boolean;
  /** A feature request, for the visitor to confirm before anything is logged. */
  featureRequest: { summary: string } | null;
}

/**
 * Hand a conversation to the Pactlab team: a question the assistant could not answer, or a feature
 * request the visitor confirmed. Sent only on the visitor's confirmation; on the site, with their address.
 */
export const supportChatHandoffSchema = z.strictObject({
  kind: z.enum(['QUESTION', 'FEATURE_REQUEST']),
  confirmed: z.literal(true),
  email: z.email().max(254).optional(),
  summary: z.string().trim().min(3).max(500),
  locale: z.enum(SUPPORT_CHAT_LOCALES).default('en'),
  page: pagePath.default('/'),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  transcript: z.array(turnSchema).max(20).default([]),
});
export type SupportChatHandoff = z.infer<typeof supportChatHandoffSchema>;

export interface SupportChatHandoffView {
  status: 'SENT';
  /** A feature request that was already decided: what the team said, so the visitor is not left guessing (T-176). */
  earlierDecision?: { status: 'DECLINED'; reason: string | null };
  /** True when the request was grouped under one already filed rather than starting a new proposal. */
  groupedWithExisting?: boolean;
}

/**
 * What a confirmed feature request hands to the intake (T-176 builds the store and triage on this). The
 * requester's wording as confirmed in chat, where they were, and how to reach them; never pact data.
 */
export interface FeatureRequestIntakeItem {
  summary: string;
  surface: 'SITE' | 'APP';
  locale: SupportChatLocale;
  page: string;
  transcript: SupportChatTurn[];
  requester: { kind: 'VISITOR'; email: string } | { kind: 'USER'; userId: string; organizationId: string; email: string | null };
}
