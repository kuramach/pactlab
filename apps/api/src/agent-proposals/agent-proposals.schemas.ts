import { z } from 'zod';
import { FINDING_TERM_LEVERS } from '../pricing/pricing.service';
import { createDocumentRequestBodySchema } from '../documents/documents.schemas';

/** What a connected app may suggest (T-084b). Strict: an amount or anything else extra is refused. */
export const termProposalPayloadSchema = z.strictObject({
  findingId: z.uuid(),
  lever: z.enum(FINDING_TERM_LEVERS),
});
export const documentRequestPayloadSchema = createDocumentRequestBodySchema;

export const AGENT_PROPOSAL_KINDS = ['TERM', 'DOCUMENT_REQUEST'] as const;
export type AgentProposalKind = (typeof AGENT_PROPOSAL_KINDS)[number];
export type TermProposalPayload = z.infer<typeof termProposalPayloadSchema>;
export type DocumentRequestPayload = z.infer<typeof documentRequestPayloadSchema>;
export type AgentProposalInput =
  | { kind: 'TERM'; payload: TermProposalPayload }
  | { kind: 'DOCUMENT_REQUEST'; payload: DocumentRequestPayload };

export const AGENT_PROPOSAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'FAILED', 'WITHDRAWN'] as const;
export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number];

export const proposalParamsSchema = z.strictObject({ dealId: z.uuid(), proposalId: z.uuid() });
export const listProposalsQuerySchema = z.strictObject({ status: z.enum(AGENT_PROPOSAL_STATUSES).optional() });
export const decideProposalBodySchema = z.strictObject({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().min(1).max(2000).optional(),
});
export type DecideProposalBody = z.infer<typeof decideProposalBodySchema>;
