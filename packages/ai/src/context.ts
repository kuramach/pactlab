import type { DataClassification } from './gateway';
import { injectionRegions } from './injection';

/** One citable unit of untrusted content, e.g. one document page. */
export interface CitableSource {
  /** Server-assigned; the model may only cite IDs it was given. */
  readonly citationId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly pageNumber: number;
  readonly text: string;
  readonly classification: DataClassification;
}

/**
 * Untrusted text is rendered with angle brackets replaced so it cannot close
 * the source delimiter or open a fake instruction block. The mapping is
 * one-to-one, so character offsets are preserved for citations.
 */
export function neutralizeMarkup(text: string): string {
  return text.replaceAll('<', '‹').replaceAll('>', '›');
}

function attribute(value: string): string {
  return neutralizeMarkup(value).replaceAll('"', "'").replaceAll(/\s+/g, ' ').slice(0, 200);
}

/** Citation-safe context: each page is a delimited, ID-tagged data block. */
export function renderSources(sources: readonly CitableSource[]): string {
  return sources
    .map((source) => {
      const flagged =
        injectionRegions(source.text).length > 0 ? ' flagged="embedded-instructions"' : '';
      return [
        `<untrusted_source citation_id="${source.citationId}" document="${attribute(source.documentName)}" page="${source.pageNumber}"${flagged}>`,
        neutralizeMarkup(source.text),
        '</untrusted_source>',
      ].join('\n');
    })
    .join('\n\n');
}
