import { DATA_CLASSIFICATIONS } from '@pactlab/ai';
import { DOCUMENT_SOURCE_PROVIDERS, documentSourceConfigSchema } from '@pactlab/connectors';
import { z } from 'zod';
import { DOCUMENT_FINDING_STATUSES, RETENTION_CLASSES } from './documents.types';

export const uploadDocumentBodySchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
  /** Base64 of up to 10 MB (PDF and Word); text files are limited further by the upload policy. */
  contentBase64: z.string().min(1).max(14_000_000),
  retentionClass: z.enum(RETENTION_CLASSES).default('DEAL_TERM'),
  dataClass: z.enum(DATA_CLASSIFICATIONS).default('BUSINESS'),
  aiExcluded: z.boolean().default(false),
  /**
   * The pact's own side shares this document with the counterparty — on a
   * seller-led pact, every bidder (T-097). Chosen at upload; never changed later.
   */
  shared: z.boolean().default(false),
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

/** A zip of deal files (T-098): every file inside goes through the normal upload path. */
export const uploadArchiveBodySchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255).regex(/\.zip$/i),
  /** Base64 of up to 10 MB of archive. */
  contentBase64: z.string().min(1).max(14_000_000),
  retentionClass: z.enum(RETENTION_CLASSES).default('DEAL_TERM'),
  dataClass: z.enum(DATA_CLASSIFICATIONS).default('BUSINESS'),
  aiExcluded: z.boolean().default(false),
});
export type UploadArchiveBody = z.infer<typeof uploadArchiveBodySchema>;

/** A person files a document: answers the AI's question or corrects its category. */
export const categorizeDocumentBodySchema = z.strictObject({
  category: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/),
  /** For contracts: the customer or supplier; null clears it, absent keeps it. */
  counterpartyName: z.string().trim().min(1).max(200).nullable().optional(),
});
export type CategorizeDocumentBody = z.infer<typeof categorizeDocumentBodySchema>;

/**
 * Connect a data room or drive folder (T-098). FIXTURE reads a synthetic
 * room (local and dev only); LIVE needs a read-only access token, stored once
 * in the secret store and never returned, logged or audited.
 */
export const connectDocumentSourceBodySchema = z.strictObject({
  provider: z.enum(DOCUMENT_SOURCE_PROVIDERS),
  mode: z.enum(['FIXTURE', 'LIVE']),
  displayName: z.string().trim().min(1).max(200),
  folder: documentSourceConfigSchema.shape.folder,
  token: z.string().min(10).max(8000).optional(),
});
export type ConnectDocumentSourceBody = z.infer<typeof connectDocumentSourceBodySchema>;

export const sourceParamsSchema = z.strictObject({ dealId: z.uuid(), sourceId: z.uuid() });

/** Ask the seller for missing inputs: expected-input ids for this pact, and an optional note. */
export const createDocumentRequestBodySchema = z.strictObject({
  items: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/)).min(1).max(50),
  note: z.string().trim().min(1).max(2000).optional(),
});
export type CreateDocumentRequestBody = z.infer<typeof createDocumentRequestBodySchema>;

export const documentRequestParamsSchema = z.strictObject({ dealId: z.uuid(), documentRequestId: z.uuid() });
