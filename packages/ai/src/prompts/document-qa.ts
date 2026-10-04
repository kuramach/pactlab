import { z } from 'zod';
import { proposedCitationSchema } from '../citations';
import { neutralizeMarkup, renderSources } from '../context';
import {
  namedInput,
  schemaBlock,
  UNTRUSTED_CONTENT_RULES,
  type PromptDefinition,
} from './registry';

export const documentAnswerSchema = z.strictObject({
  /** True when the sources do not answer the question; claims may then be empty. */
  unanswerable: z.boolean(),
  answer: z.string().min(1).max(4000),
  claims: z
    .array(
      z.strictObject({
        statement: z.string().min(3).max(1000),
        citations: z.array(proposedCitationSchema).min(1).max(5),
      }),
    )
    .max(20),
});
export type DocumentAnswer = z.infer<typeof documentAnswerSchema>;

export const documentQaPrompt = {
  id: 'document.qa',
  version: '1',
  taskType: 'document.question',
  defaultAlias: 'balanced',
  maxOutputTokens: 4000,
  system: [
    'You answer diligence questions about documents in a software M&A data room.',
    UNTRUSTED_CONTENT_RULES,
    'Break the answer into atomic claims; every claim needs at least one citation.',
    schemaBlock(documentAnswerSchema),
  ].join('\n\n'),
  outputSchema: documentAnswerSchema,
  render: (context) =>
    [
      'Sources:',
      renderSources(context.sources),
      `Question (from the reviewer): ${neutralizeMarkup(namedInput(context, 'question'))}`,
    ].join('\n\n'),
} satisfies PromptDefinition<typeof documentAnswerSchema>;
