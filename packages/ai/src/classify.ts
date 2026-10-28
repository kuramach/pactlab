import type { ModelProviderErrorKind } from './bedrock';
import type { CitableSource } from './context';
import type { AiRunRecord, ClaudeGateway } from './gateway';
import type { ModelAlias } from './models';
import { documentClassificationPrompt, type DocumentClassification } from './prompts';

/** How much of a file the classifier reads: its first pages, capped. */
export const CLASSIFY_MAX_PAGES = 3;
export const CLASSIFY_MAX_CHARS = 12_000;

export interface ClassifyRequest {
  readonly organizationId: string;
  readonly dealId: string;
  readonly modelAlias?: ModelAlias;
  readonly fileName: string;
  /** Folder inside the zip or data room, a hint only. */
  readonly folder: string | null;
  readonly categories: readonly { readonly id: string; readonly description: string }[];
  /** The file's pages in order; only the first few are sent. */
  readonly pages: readonly CitableSource[];
}

const squash = (text: string) => text.replaceAll(/\s+/g, ' ').trim().toLowerCase();

/** The first pages, cut to the character budget. */
export function classificationExcerpt(pages: readonly CitableSource[]): CitableSource[] {
  const excerpt: CitableSource[] = [];
  let budget = CLASSIFY_MAX_CHARS;
  for (const page of pages.slice(0, CLASSIFY_MAX_PAGES)) {
    if (budget <= 0) break;
    excerpt.push(page.text.length > budget ? { ...page, text: page.text.slice(0, budget) } : page);
    budget -= page.text.length;
  }
  return excerpt;
}

/**
 * Ask the model what a file is. The counterparty is kept only when its quote
 * really appears in the pages it read — a name the file does not contain is
 * never tagged.
 */
export async function classifyDocument(
  gateway: ClaudeGateway,
  request: ClassifyRequest,
): Promise<{ run: AiRunRecord; classification: DocumentClassification | null; providerError: ModelProviderErrorKind | null }> {
  const sources = classificationExcerpt(request.pages);
  const response = await gateway.invoke(documentClassificationPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [
      { name: 'categories', classification: 'PUBLIC', text: request.categories.map((c) => `${c.id}: ${c.description}`).join('\n') },
      { name: 'fileName', classification: 'BUSINESS', text: request.fileName },
      { name: 'folder', classification: 'BUSINESS', text: request.folder ?? '' },
    ],
    sources,
  });
  if (!response.output) return { run: response.run, classification: null, providerError: response.providerError };
  const output = response.output;
  const read = squash(sources.map((source) => source.text).join(' '));
  const grounded = output.counterparty && read.includes(squash(output.counterparty.quote)) && squash(output.counterparty.quote).includes(squash(output.counterparty.name))
    ? output.counterparty
    : null;
  return { run: response.run, classification: { ...output, counterparty: grounded }, providerError: null };
}
