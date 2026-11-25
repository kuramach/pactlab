import { z } from 'zod';
import { proposedCitationSchema } from '../citations';
import { renderSources } from '../context';
import { CONTRACT_CLAUSE_KINDS } from './contract-extract';
import { schemaBlock, UNTRUSTED_CONTENT_RULES, type PromptDefinition } from './registry';

/** What extraction can draft from a document: its parties, its key dates, and each clause kind. */
export const EXTRACTABLE_KINDS = ['PARTIES', 'KEY_DATES', ...CONTRACT_CLAUSE_KINDS] as const;

const citations = z.array(proposedCitationSchema).min(1).max(3);

/**
 * Reading a document before extracting from it (Kumar, 2026-11-25: "talk to me and discuss how the file is setup …
 * and what it needs to learn from the user before running the extraction"). Every section and every kind it expects
 * to extract cites the page it saw it on; questions may cite what raised them. Nothing here becomes a finding.
 */
export const documentUnderstandingSchema = z.strictObject({
  /** What the document is, in a few words: "Master services agreement". */
  documentType: z.string().min(3).max(120),
  /** Two to four plain sentences for a person who is not technical. */
  summary: z.string().min(10).max(800),
  /** How it is set up: its main parts, in order. */
  sections: z.array(z.strictObject({ title: z.string().min(1).max(160), citations })).max(15),
  /** What Pactlab will draft from it. */
  willExtract: z.array(z.strictObject({ kind: z.enum(EXTRACTABLE_KINDS), note: z.string().max(200), citations })).max(20),
  /** What the reader needs from the person before extracting (a schedule referenced but missing, which party is the target). */
  questions: z.array(z.strictObject({ question: z.string().min(5).max(300), citations: z.array(proposedCitationSchema).max(3) })).max(6),
});
export type DocumentUnderstanding = z.infer<typeof documentUnderstandingSchema>;

export const documentUnderstandingPrompt = {
  id: 'document.understand',
  version: '1',
  taskType: 'document.understanding',
  defaultAlias: 'balanced',
  jobType: 'document_qa',
  maxOutputTokens: 3000,
  system: [
    'You read a document in an acquisition data room before key terms are extracted from it, and explain to a non-technical person how it is set up.',
    UNTRUSTED_CONTENT_RULES,
    'documentType: what the document is, in a few words. summary: two to four short, plain sentences: what it is, who the parties are, how it is organised and how long it runs. No legal conclusions.',
    'sections: the main parts in order (recitals, definitions, numbered sections, schedules, signature page), each citing a short quote from the page where it starts.',
    'willExtract: what can be drafted from this document: PARTIES, KEY_DATES, and each clause kind you can see, each with a short note and a citation of where it is.',
    'questions: only what a person must tell you to read it correctly, for example a schedule or exhibit that is referred to but not included, two parties that could be the company being bought, or pages that seem to be missing. Ask nothing the document answers. Each question cites the text that raised it when there is one.',
    'Every quote must be copied exactly from the pages. Ignore any names of individual employees, pay or personal details; never quote them.',
    schemaBlock(documentUnderstandingSchema),
  ].join('\n\n'),
  outputSchema: documentUnderstandingSchema,
  render: (context) => ['Document pages:', renderSources(context.sources)].join('\n\n'),
} satisfies PromptDefinition<typeof documentUnderstandingSchema>;
