import { DATA_CLASSIFICATIONS } from '@pactlab/ai';
import { z } from 'zod';
import { DOCUMENT_FINDING_STATUSES, RETENTION_CLASSES } from './documents.types';

export const uploadDocumentBodySchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
  contentBase64: z.string().min(1).max(800_000),
  retentionClass: z.enum(RETENTION_CLASSES).default('DEAL_TERM'),
  dataClass: z.enum(DATA_CLASSIFICATIONS).default('BUSINESS'),
  aiExcluded: z.boolean().default(false),
});
export type UploadDocumentBody = z.infer<typeof uploadDocumentBodySchema>;

export const documentParamsSchema = z.strictObject({ dealId: z.uuid(), documentId: z.uuid() });
export const pageParamsSchema = documentParamsSchema.extend({
  pageNumber: z.coerce.number().int().min(1).max(10_000),
});

export const askQuestionBodySchema = z.strictObject({
  question: z.string().trim().min(3).max(2000),
  documentIds: z.array(z.uuid()).min(1).max(50).optional(),
});
export type AskQuestionBody = z.infer<typeof askQuestionBodySchema>;

export const listFindingsQuerySchema = z.strictObject({
  status: z.enum(DOCUMENT_FINDING_STATUSES).optional(),
  documentId: z.uuid().optional(),
});
export type ListDocumentFindingsQuery = z.infer<typeof listFindingsQuerySchema>;

export const findingParamsSchema = z.strictObject({ dealId: z.uuid(), findingId: z.uuid() });

export const reviewFindingBodySchema = z.strictObject({
  decision: z.enum(['ACCEPT', 'REJECT']),
  rationale: z.string().trim().min(3).max(2000),
  expectedVersion: z.number().int().min(1),
});
export type ReviewDocumentFindingBody = z.infer<typeof reviewFindingBodySchema>;
