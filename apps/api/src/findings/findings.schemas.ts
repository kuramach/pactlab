import {
  FINDING_CONFIDENCES,
  FINDING_DOMAINS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  PRICED_RISK_TYPES,
  REVIEW_DECISIONS,
} from '@pactlab/domain';
import { z } from 'zod';

const decimal = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/);

export const pricedRiskSchema = z.strictObject({
  type: z.enum(PRICED_RISK_TYPES),
  currency: z.string().regex(/^[A-Z]{3}$/),
  low: decimal,
  high: decimal,
  basis: z.string().trim().min(1).max(1_000),
});

export const evidenceLinkSchema = z.strictObject({
  evidenceItemId: z.uuid(),
  commitSha: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/),
  toolName: z.string().trim().min(1).max(100),
  toolVersion: z.string().trim().min(1).max(100),
  rulesetVersion: z.string().trim().min(1).max(100).nullable().default(null),
  path: z.string().trim().min(1).max(500).nullable().default(null),
  lineStart: z.number().int().positive().nullable().default(null),
  lineEnd: z.number().int().positive().nullable().default(null),
});

export const createFindingSchema = z.strictObject({
  domain: z.enum(FINDING_DOMAINS),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4_000),
  severity: z.enum(FINDING_SEVERITIES),
  confidence: z.enum(FINDING_CONFIDENCES),
  evidence: z.array(evidenceLinkSchema).max(50).default([]),
  pricedRisk: pricedRiskSchema.nullable().default(null),
});
export type CreateFindingBody = z.infer<typeof createFindingSchema>;

export const updateFindingSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(4_000).optional(),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  confidence: z.enum(FINDING_CONFIDENCES).optional(),
  evidence: z.array(evidenceLinkSchema).max(50).optional(),
  pricedRisk: pricedRiskSchema.nullable().optional(),
});
export type UpdateFindingBody = z.infer<typeof updateFindingSchema>;

export const reviewFindingSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  decision: z.enum(REVIEW_DECISIONS),
  rationale: z.string().trim().min(1).max(4_000),
});
export type ReviewFindingBody = z.infer<typeof reviewFindingSchema>;

export const listFindingsQuerySchema = z.strictObject({
  status: z.enum(FINDING_STATUSES).optional(),
  domain: z.enum(FINDING_DOMAINS).optional(),
});
export type ListFindingsQuery = z.infer<typeof listFindingsQuerySchema>;

export const findingParamsSchema = z.strictObject({ dealId: z.uuid(), findingId: z.uuid() });
