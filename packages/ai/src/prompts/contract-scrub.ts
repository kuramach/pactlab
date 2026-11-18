import { z } from 'zod';
import { proposedCitationSchema } from '../citations';
import { renderSources } from '../context';
import { SEVERITIES } from './contract-extract';
import { schemaBlock, UNTRUSTED_CONTENT_RULES, type PromptDefinition } from './registry';

/** What a consistency check reports (T-132): drafting errors, never legal conclusions. */
export const CONSISTENCY_KINDS = [
  'UNDEFINED_TERM',
  'UNUSED_DEFINITION',
  'INCONSISTENT_TERM',
  'BROKEN_CROSS_REFERENCE',
  'PARTY_NAME_MISMATCH',
  'INTERNAL_CONTRADICTION',
] as const;

export const contractScrubSchema = z.strictObject({
  findings: z
    .array(
      z.strictObject({
        kind: z.enum(CONSISTENCY_KINDS),
        /** Short and specific: "Section 9 is referenced but does not exist". */
        title: z.string().min(3).max(160),
        explanation: z.string().min(3).max(1000),
        severity: z.enum(SEVERITIES),
        /** Every place the problem shows: the use and, where there is one, the definition or target. */
        citations: z.array(proposedCitationSchema).min(1).max(5),
      }),
    )
    .max(30),
});
export type ContractScrub = z.infer<typeof contractScrubSchema>;

/**
 * Consistency checks on an agreement (T-132, job type `contract_scrub`): defined terms, cross-references,
 * party names and internal contradictions. Findings are drafts for a person to accept.
 */
export const contractScrubPrompt = {
  id: 'contract.scrub',
  version: '1',
  taskType: 'contract.consistency',
  defaultAlias: 'deep_review',
  jobType: 'contract_scrub',
  maxOutputTokens: 6000,
  system: [
    'You check a commercial agreement for drafting consistency for an acquirer’s diligence team.',
    UNTRUSTED_CONTENT_RULES,
    [
      'Report only these problems:',
      '- UNDEFINED_TERM: a capitalized term used as a defined term but never defined.',
      '- UNUSED_DEFINITION: a term defined but never used.',
      '- INCONSISTENT_TERM: one concept defined or used under different names.',
      '- BROKEN_CROSS_REFERENCE: a reference to a section, schedule or exhibit that does not exist in the pages given, or points at the wrong subject.',
      '- PARTY_NAME_MISMATCH: a party named differently from its definition (spelling, entity type, a different entity).',
      '- INTERNAL_CONTRADICTION: two provisions that cannot both apply (different periods, amounts or dates for the same thing).',
    ].join('\n'),
    'Quote the exact words for every place the problem shows. If the pages given may be incomplete (a missing exhibit can simply be absent from the file), say so in the explanation and use LOW severity.',
    'Severity reflects how much a reviewer should care, not a legal conclusion. Report nothing when the agreement is consistent; never invent a problem.',
    schemaBlock(contractScrubSchema),
  ].join('\n\n'),
  outputSchema: contractScrubSchema,
  render: (context) => ['Agreement pages:', renderSources(context.sources)].join('\n\n'),
} satisfies PromptDefinition<typeof contractScrubSchema>;
