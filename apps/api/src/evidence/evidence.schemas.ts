import { EVIDENCE_VISIBILITIES } from '@pactlab/domain';
import { z } from 'zod';

export const listEvidenceQuerySchema = z.strictObject({
  type: z.string().trim().min(1).max(100).optional(),
  connectionId: z.uuid().optional(),
  visibility: z.enum(EVIDENCE_VISIBILITIES).optional(),
  recordId: z.string().trim().min(1).max(200).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListEvidenceQuery = z.infer<typeof listEvidenceQuerySchema>;

export const evidenceParamsSchema = z.strictObject({ dealId: z.uuid(), evidenceId: z.uuid() });
