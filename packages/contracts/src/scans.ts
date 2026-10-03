import { z } from 'zod';
import { uuidSchema } from './common';

export const scanRequestSchema = z.strictObject({
  scanId: uuidSchema,
  organizationId: uuidSchema,
  dealId: uuidSchema,
  repository: z.strictObject({
    connectionId: uuidSchema,
    ref: z.string().min(1).max(255),
  }),
  requestedBy: uuidSchema,
  correlationId: z.string().min(1).max(100),
});
export type ScanRequest = z.infer<typeof scanRequestSchema>;

export const scanResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('NOT_IMPLEMENTED'),
    scanId: uuidSchema,
    reason: z.string(),
  }),
  z.strictObject({
    status: z.literal('REJECTED'),
    reason: z.string(),
  }),
]);
export type ScanResult = z.infer<typeof scanResultSchema>;
