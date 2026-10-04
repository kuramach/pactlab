import { z } from 'zod';
import { proposedCitationSchema } from '../citations';
import { renderSources } from '../context';
import { schemaBlock, UNTRUSTED_CONTENT_RULES, type PromptDefinition } from './registry';

export const CONTRACT_DATE_KINDS = [
  'EFFECTIVE',
  'EXPIRATION',
  'RENEWAL',
  'NOTICE_DEADLINE',
  'OTHER',
] as const;

export const CONTRACT_CLAUSE_KINDS = [
  'CHANGE_OF_CONTROL',
  'ASSIGNMENT',
  'TERMINATION_FOR_CONVENIENCE',
  'AUTO_RENEWAL',
  'EXCLUSIVITY',
  'MOST_FAVORED_NATION',
  'LIMITATION_OF_LIABILITY',
  'INDEMNITY',
  'IP_OWNERSHIP',
  'NON_COMPETE',
  'OTHER',
] as const;

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const citations = z.array(proposedCitationSchema).min(1).max(5);

/**
 * Typed contract extraction. Dates are ISO strings copied from the text;
 * no money or legal conclusion is parsed from prose.
 */
export const contractExtractionSchema = z.strictObject({
  parties: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        role: z.string().min(1).max(100),
        citations,
      }),
    )
    .max(10),
  dates: z
    .array(
      z.strictObject({
        kind: z.enum(CONTRACT_DATE_KINDS),
        date: z.iso.date(),
        citations,
      }),
    )
    .max(20),
  clauses: z
    .array(
      z.strictObject({
        kind: z.enum(CONTRACT_CLAUSE_KINDS),
        summary: z.string().min(3).max(1000),
        severity: z.enum(SEVERITIES),
        citations,
      }),
    )
    .max(30),
});
export type ContractExtraction = z.infer<typeof contractExtractionSchema>;

export const contractExtractionPrompt = {
  id: 'contract.extract',
  version: '1',
  taskType: 'contract.extraction',
  defaultAlias: 'balanced',
  maxOutputTokens: 6000,
  system: [
    'You extract parties, key dates and key clauses from a commercial contract for an acquirer’s diligence team.',
    UNTRUSTED_CONTENT_RULES,
    'Severity reflects diligence attention for an acquirer (for example a change-of-control termination right is HIGH). It is a draft for a human reviewer, not a legal conclusion.',
    'Omit anything the contract does not state. Use ISO dates (YYYY-MM-DD) only when the date appears in the text.',
    schemaBlock(contractExtractionSchema),
  ].join('\n\n'),
  outputSchema: contractExtractionSchema,
  render: (context) => ['Contract pages:', renderSources(context.sources)].join('\n\n'),
} satisfies PromptDefinition<typeof contractExtractionSchema>;
