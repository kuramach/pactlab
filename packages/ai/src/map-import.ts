import { columnLetter, type TargetDefinition } from '@pactlab/domain';
import type { ModelProviderErrorKind } from './bedrock';
import type { AiRunRecord, ClaudeGateway } from './gateway';
import { importMappingPrompt, type ImportMappingProposal } from './prompts';

/** What the mapping assistant reads: the sheet's first rows, each cell cut short, under a budget. */
export const MAP_MAX_ROWS = 30;
export const MAP_MAX_CELL_CHARS = 80;
export const MAP_MAX_CHARS = 12_000;

export interface MapImportRequest {
  readonly organizationId: string;
  readonly dealId: string;
  /** The upload: the grid's citation document. */
  readonly uploadId: string;
  readonly fileName: string;
  readonly sheet: string | null;
  readonly definition: TargetDefinition;
  /** The sheet's first non-empty rows as cell text (`ReadTable.preview`). */
  readonly preview: readonly (readonly string[])[];
  /** What the person said about the file (`renderGuidance`); sent to this job only (T-152). */
  readonly guidance?: string;
}

/** The grid as the prompt shows it: "Row n: A=text | B=text", empty cells left out. */
export function renderGrid(preview: readonly (readonly string[])[]): string {
  const lines: string[] = [];
  let budget = MAP_MAX_CHARS;
  for (const [index, row] of preview.slice(0, MAP_MAX_ROWS).entries()) {
    const cells = row
      .map((cell, at) => ({ cell: cell.trim().slice(0, MAP_MAX_CELL_CHARS), at }))
      .filter((entry) => entry.cell !== '')
      .map((entry) => `${columnLetter(entry.at)}=${entry.cell}`);
    const line = `Row ${index + 1}: ${cells.join(' | ')}`;
    if (line.length > budget) break;
    lines.push(line);
    budget -= line.length + 1;
  }
  return lines.join('\n');
}

/**
 * Ask the assistant how a sheet maps onto a target. Returns its proposal as given (schema-checked);
 * the caller checks it against the file with `checkProposal` before anyone sees it.
 */
export async function mapImport(
  gateway: ClaudeGateway,
  request: MapImportRequest,
): Promise<{ run: AiRunRecord; proposal: ImportMappingProposal | null; providerError: ModelProviderErrorKind | null }> {
  const { definition } = request;
  const response = await gateway.invoke(importMappingPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    inputs: [
      { name: 'target', classification: 'PUBLIC', text: `${definition.label}${definition.lineItems ? ' (a line-by-line statement: one record per account per month)' : ''}` },
      {
        name: 'fields',
        classification: 'PUBLIC',
        text: definition.fields.map((field) => `${field.name} | ${field.label} | ${field.kind} | ${field.required ? 'required' : 'optional'} | ${field.hint}`).join('\n'),
      },
      { name: 'fileName', classification: 'BUSINESS', text: request.fileName },
      { name: 'sheet', classification: 'BUSINESS', text: request.sheet ?? '' },
      { name: 'guidance', classification: 'BUSINESS', text: request.guidance ?? '' },
    ],
    sources: [{ citationId: 'sheet', documentId: request.uploadId, documentName: request.fileName, pageNumber: 1, text: renderGrid(request.preview), classification: 'FINANCIAL' }],
  });
  return { run: response.run, proposal: response.output ?? null, providerError: response.output ? null : response.providerError };
}
