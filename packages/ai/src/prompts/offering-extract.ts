import { OFFERING_ITEM_KINDS } from '@pactlab/domain';
import { z } from 'zod';
import { proposedCitationSchema } from '../citations';
import { renderSources } from '../context';
import { schemaBlock, UNTRUSTED_CONTENT_RULES, type PromptDefinition } from './registry';

/** A plain decimal as the document writes it, without % or ×: "8", "2.5", "1.85". */
const figure = z.string().regex(/^\d{1,6}(\.\d{1,4})?$/);

/**
 * Offering extraction (T-106): the fees, distribution terms and claims a syndication's PPM,
 * operating agreement or investor deck states. Every item is a draft the sponsor confirms; code
 * keeps an item only when its quote is on the cited page and every figure appears in that quote.
 */
export const offeringExtractionSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        kind: z.enum(OFFERING_ITEM_KINDS),
        /** The fee's own name (OTHER_FEE) or the prior deal a track-record claim names; otherwise null. */
        label: z.string().min(1).max(160).nullable(),
        /** Percent as a number (8 for 8%), a multiple as a number (1.85), the sponsor's share for a promote tier. */
        value: figure.nullable(),
        /** Promote tiers only: the investors' IRR hurdle in percent; null for the last tier. */
        hurdle: figure.nullable(),
        citations: z.array(proposedCitationSchema).min(1).max(2),
      }),
    )
    .max(60),
});
export type OfferingExtraction = z.infer<typeof offeringExtractionSchema>;

export const offeringExtractionPrompt = {
  id: 'offering.extract',
  version: '1',
  taskType: 'offering.extraction',
  defaultAlias: 'balanced',
  jobType: 'extraction',
  maxOutputTokens: 6000,
  system: [
    'You read the offering documents of a multifamily real-estate syndication — a private placement memorandum (PPM), an operating agreement or an investor deck — and list the fees, distribution terms and claims they state, for the sponsor to confirm.',
    UNTRUSTED_CONTENT_RULES,
    'Kinds: ACQUISITION_FEE (percent of purchase price), ASSET_MANAGEMENT_FEE (percent of equity per year), DISPOSITION_FEE (percent of sale price), OTHER_FEE (any other fee; put its name in label), PREFERRED_RETURN (percent per year), PROMOTE_TIER (value = the sponsor or manager share of cash in that tier; hurdle = the investors\' IRR that ends the tier, null for the last tier), CATCH_UP, PROJECTED_IRR, EQUITY_MULTIPLE, CASH_ON_CASH, OCCUPANCY, NOI_GROWTH, EXIT_CAP_RATE, TRACK_RECORD (a prior deal\'s delivered investor IRR; put the deal\'s name in label).',
    'Write figures as plain numbers exactly as the quote shows them, without % or x (8% → "8", 1.85x → "1.85"). Every figure you give must appear in the quote you cite. Omit anything the document does not state; never estimate, compute or infer a figure.',
    'You assist the sponsor; you do not judge whether a term is fair, whether the offering complies with securities law, or whether any investor is accredited.',
    schemaBlock(offeringExtractionSchema),
  ].join('\n\n'),
  outputSchema: offeringExtractionSchema,
  render: (context) => ['Offering document pages:', renderSources(context.sources)].join('\n\n'),
} satisfies PromptDefinition<typeof offeringExtractionSchema>;
