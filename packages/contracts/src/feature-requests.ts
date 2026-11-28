import { FEATURE_REQUEST_STATUSES, TASK_CONTEXTS, TASK_MODELS, isTouchPath } from '@pactlab/domain';
import { z } from 'zod';
import { pageQuerySchema } from './pagination';

/** Feature requests (T-176): the operator queue, the actions on it, and the requester's own list. */
const status = z.enum(FEATURE_REQUEST_STATUSES);

export const featureRequestsQuerySchema = pageQuerySchema.extend({ status: status.optional(), q: z.string().trim().min(1).max(120).optional() }).strict();
export const featureRequestParamsSchema = z.strictObject({ requestId: z.uuid() });
export const featureSupporterParamsSchema = z.strictObject({ requestId: z.uuid(), supporterId: z.uuid() });
export const featureSupportersQuerySchema = pageQuerySchema.strict();
export const myFeatureRequestsQuerySchema = pageQuerySchema.strict();

const note = (max: number) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.string().trim().max(max).nullable().default(null));

/** DECLINE takes an optional short reason; REQUEST_INFO needs the question; REOPEN may carry the requester's reply. */
export const decideFeatureRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('TRIAGE') }),
  z.strictObject({ action: z.literal('DECLINE'), reason: note(500) }),
  z.strictObject({ action: z.literal('REQUEST_INFO'), question: z.string().trim().min(3).max(1000) }),
  z.strictObject({ action: z.literal('REOPEN'), reply: note(2000) }),
]);
export type DecideFeatureRequestInput = z.infer<typeof decideFeatureRequestSchema>;

/** What Kumar confirms before the task file is written: tier and touches are the proposal's first guess, editable. */
export const approveFeatureRequestSchema = z.strictObject({
  model: z.enum(TASK_MODELS),
  lane: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  context: z.enum(TASK_CONTEXTS),
  touches: z.array(z.string().refine(isTouchPath, 'A repo path')).min(1).max(20),
  needs: z.string().regex(/^(none|T-\d{3,5}[a-z]?(( |, ?)T-\d{3,5}[a-z]?)*)$/),
  title: z.string().trim().min(3).max(100).regex(/^[^\r\n`<>]+$/),
});
export type ApproveFeatureRequestInput = z.infer<typeof approveFeatureRequestSchema>;

export const linkFeatureRequestSchema = z.strictObject({
  taskId: z.string().regex(/^T-\d{3,5}[a-z]?$/).nullable().default(null),
  pullRequestUrl: z.url().regex(/^https:\/\/github\.com\//).max(300).nullable().default(null),
  whatsNewUrl: z.string().regex(/^(\/[^\s<>"]*|https:\/\/[^\s<>"]+)$/).max(300).nullable().default(null),
});
export type LinkFeatureRequestInput = z.infer<typeof linkFeatureRequestSchema>;

export const replyFeatureRequestSchema = z.strictObject({ reply: z.string().trim().min(1).max(2000) });
export const myFeatureRequestParamsSchema = z.strictObject({ requestId: z.uuid() });

export type FeatureRequestStatusValue = z.infer<typeof status>;

export interface FeatureRequestSummaryView {
  id: string;
  reference: string;
  title: string;
  surface: 'SITE' | 'APP';
  locale: string;
  page: string;
  status: FeatureRequestStatusValue;
  declineReason: string | null;
  /** Requesters counted: the first and those the triager confirmed. */
  supporters: number;
  /** Requesters the similarity screen suggested, waiting for the triager to confirm or split. */
  suggested: number;
  taskId: string | null;
  hasEarlierDecision: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureRequestSupporterView {
  id: string;
  grouping: 'ORIGINAL' | 'SUGGESTED' | 'CONFIRMED';
  surface: 'SITE' | 'APP';
  locale: string;
  page: string;
  title: string;
  description: string;
  /** Site requesters: the address they gave. App requesters: their organization (no address shown). */
  email: string | null;
  organizationName: string | null;
  transcript: { role: 'user' | 'assistant'; text: string }[];
  createdAt: string;
}

export interface FeatureRequestDetailView extends FeatureRequestSummaryView {
  description: string;
  infoQuestion: string | null;
  infoReply: string | null;
  earlier: { id: string; title: string; status: FeatureRequestStatusValue; reason: string | null } | null;
  taskSpec: ApproveFeatureRequestInput | null;
  proposedTask: ApproveFeatureRequestInput;
  pullRequestUrl: string | null;
  whatsNewUrl: string | null;
  /** A GitHub new-issue link carrying the approved task for the triage-to-task workflow (no token held by the API). */
  taskIssueUrl: string | null;
}

/** One of the caller's own requests: what they asked, where it stands in plain words, never operator notes. */
export interface MyFeatureRequestView {
  id: string;
  proposalId: string;
  reference: string;
  title: string;
  description: string;
  status: FeatureRequestStatusValue;
  statusLabel: string;
  statusText: string;
  /** Why it was declined, when it was. */
  declineReason: string | null;
  /** The question the team asked, while it waits for an answer. */
  question: string | null;
  /** The What's-new card, once it shipped. */
  whatsNewUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
