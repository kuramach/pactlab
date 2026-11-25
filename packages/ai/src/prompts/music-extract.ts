import { MUSIC_GRANT_TYPES, MUSIC_INCOME_SOURCES, MUSIC_ITEM_KINDS } from '@pactlab/domain';
import { z } from 'zod';
import { proposedCitationSchema } from '../citations';
import { renderSources } from '../context';
import { schemaBlock, UNTRUSTED_CONTENT_RULES, type PromptDefinition } from './registry';

/** A plain decimal as the document writes it, without %, currency or separators: "50", "412500", "1234.56". */
const figure = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Music rights extraction (T-140): the register entries a royalty statement, split sheet,
 * publishing agreement, Copyright Office record or lien search states — writer splits, grants in
 * the chain of title, statement income, unrecouped advance balances and liens. Every entry is a
 * draft a person confirms; code keeps an entry only when its quote is on the cited page and every
 * figure (and the year of every date) it gives appears in that quote.
 */
export const musicExtractionSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        kind: z.enum(MUSIC_ITEM_KINDS),
        /** The work id or title exactly as the document writes it (SPLIT, GRANT, INCOME); otherwise null. */
        work: z.string().min(1).max(200).nullable(),
        /** SPLIT: the writer reference; GRANT: one of the grant types; INCOME: one of the income sources; ENCUMBRANCE: the secured party. */
        detail: z.string().min(1).max(200).nullable(),
        /** SPLIT: the share in percent; INCOME, ADVANCE_BALANCE, ENCUMBRANCE: the amount; GRANT: null. */
        value: figure.nullable(),
        /** GRANT: the date the grant was executed; INCOME: the statement period end; otherwise null. */
        date: isoDate.nullable(),
        citations: z.array(proposedCitationSchema).min(1).max(2),
      }),
    )
    .max(80),
});
export type MusicExtraction = z.infer<typeof musicExtractionSchema>;

export const musicExtractionPrompt = {
  id: 'music.extract',
  version: '1',
  taskType: 'music.extraction',
  defaultAlias: 'balanced',
  jobType: 'extraction',
  maxOutputTokens: 6000,
  system: [
    'You read the rights documents of a music catalog being acquired — royalty statements, split sheets, publishing or administration agreements, Copyright Office records and lien searches — and list the register entries they state, for the buyer to confirm.',
    UNTRUSTED_CONTENT_RULES,
    `Kinds: SPLIT (a writer's share of a work: detail = the writer reference as written, value = the share in percent), GRANT (a registration or agreement behind a work: detail = one of ${MUSIC_GRANT_TYPES.join(', ')}, date = when it was executed), INCOME (a statement line: detail = one of ${MUSIC_INCOME_SOURCES.join(', ')}, value = the net amount, date = the period end), ADVANCE_BALANCE (an unrecouped advance balance: value = the amount), ENCUMBRANCE (a lien, security interest or claim on the catalog: detail = the secured party or claimant, value = the amount secured, if stated).`,
    'Write work ids, titles and writer references exactly as the document does. Write figures as plain numbers exactly as the quote shows them, without %, currency or thousands separators (50% → "50", USD 412,500 → "412500"). Write dates as YYYY-MM-DD. Every figure you give must appear in the quote you cite. Omit anything the document does not state; never estimate, compute or infer a figure, a share or a date.',
    'Never name a writer or any other person: use the writer references the documents use. You assist the buyer; you do not judge whether title is good, whether a grant is valid, or whether a termination right exists or has been exercised.',
    schemaBlock(musicExtractionSchema),
  ].join('\n\n'),
  outputSchema: musicExtractionSchema,
  render: (context) => ['Rights document pages:', renderSources(context.sources)].join('\n\n'),
} satisfies PromptDefinition<typeof musicExtractionSchema>;
