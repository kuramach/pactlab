import { ENERGY_ITEM_KINDS, ENERGY_LIABILITY_KINDS, ENERGY_RESERVE_CATEGORIES } from '@pactlab/domain';
import { z } from 'zod';
import { proposedCitationSchema } from '../citations';
import { renderSources } from '../context';
import { schemaBlock, UNTRUSTED_CONTENT_RULES, type PromptDefinition } from './registry';

/** A plain decimal as the document writes it, without %, currency, units or separators: "12", "1240", "42000000". */
const figure = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/);

/**
 * Energy extraction (T-142): the entries a third-party reserve report or an environmental report or
 * permit states — reserves by category, their discounted value, the decline the report assumes, and
 * liability estimates (remediation, coal-ash closure, reclamation, decommissioning). Every entry is a
 * draft a person confirms; code keeps one only when its quote is on the cited page and its figure
 * appears in that quote. The platform never estimates reserves or liabilities.
 */
export const energyExtractionSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        kind: z.enum(ENERGY_ITEM_KINDS),
        /** The plant, well, unit or lease exactly as the document names it; null for portfolio-wide entries. */
        asset: z.string().min(1).max(200).nullable(),
        /** RESERVES, RESERVE_VALUE: the reserve category; LIABILITY_ESTIMATE: the obligation; DECLINE_ASSUMPTION: null. */
        detail: z.string().min(1).max(40).nullable(),
        /** RESERVES: net volume in MBOE; RESERVE_VALUE, LIABILITY_ESTIMATE: the amount; DECLINE_ASSUMPTION: the annual decline in percent. */
        value: figure,
        citations: z.array(proposedCitationSchema).min(1).max(2),
      }),
    )
    .max(60),
});
export type EnergyExtraction = z.infer<typeof energyExtractionSchema>;

export const energyExtractionPrompt = {
  id: 'energy.extract',
  version: '1',
  taskType: 'energy.extraction',
  defaultAlias: 'balanced',
  jobType: 'extraction',
  maxOutputTokens: 4000,
  system: [
    'You read the documents of an energy acquisition — third-party petroleum engineering reserve reports, environmental site assessments, closure and remediation plans, decommissioning studies and permits — and list the entries they state, for the buyer to confirm.',
    UNTRUSTED_CONTENT_RULES,
    `Kinds: RESERVES (net reserves in one category as the report states them: detail = one of ${ENERGY_RESERVE_CATEGORIES.join(', ')}, value = the volume in MBOE), RESERVE_VALUE (the report's discounted value of one category: detail = the category, value = the amount), DECLINE_ASSUMPTION (the annual production decline the report assumes: detail = null, value = the percent), LIABILITY_ESTIMATE (an estimated cost of an obligation: detail = one of ${ENERGY_LIABILITY_KINDS.join(', ')} — ccr for coal ash or ash ponds, aro for decommissioning, plugging or asset retirement — value = the amount).`,
    'Write the asset exactly as the document names it, or null. Write figures as plain numbers exactly as the quote shows them, without %, currency, units or thousands separators (12% → "12", 1,240 MBOE → "1240", USD 42,000,000 → "42000000"). Every figure you give must appear in the quote you cite. Omit anything the document does not state; never estimate, compute, convert or infer a figure.',
    'You assist the buyer; you do not certify reserves, judge whether title is good or whether a permit is complied with, or give engineering, legal or regulatory advice. Never name a person.',
    schemaBlock(energyExtractionSchema),
  ].join('\n\n'),
  outputSchema: energyExtractionSchema,
  render: (context) => ['Energy document pages:', renderSources(context.sources)].join('\n\n'),
} satisfies PromptDefinition<typeof energyExtractionSchema>;
