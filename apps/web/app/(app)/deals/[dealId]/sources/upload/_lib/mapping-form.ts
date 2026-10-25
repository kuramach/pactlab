import type { FieldSource, ImportMapping, TargetDefinition } from '@pactlab/domain';
import { IMPORT_TARGET_DEFINITIONS } from '@pactlab/domain';

/** Select value for a field's source: `none`, `constant`, or `column:<name>`. */
export function choiceOf(source: FieldSource | undefined): string {
  if (!source || source.kind === 'none') return 'none';
  return source.kind === 'constant' ? 'constant' : `column:${source.column}`;
}

/** The field source a select value stands for, keeping a typed constant when switching to it. */
export function sourceFromChoice(choice: string, previous: FieldSource | undefined): FieldSource {
  if (choice.startsWith('column:')) return { kind: 'column', column: choice.slice('column:'.length) };
  if (choice === 'constant') return { kind: 'constant', value: previous?.kind === 'constant' ? previous.value : '' };
  return { kind: 'none' };
}

/** The import target a mapping is for: billing or a pack extract (ADR 0010). */
export function definitionFor(mapping: Pick<ImportMapping, 'target'>): TargetDefinition {
  return IMPORT_TARGET_DEFINITIONS[mapping.target];
}

/** Required fields still unmapped, by label — shown before the user can check the mapping. */
export function unmappedRequired(mapping: ImportMapping, definition: TargetDefinition = definitionFor(mapping)): string[] {
  return definition.fields
    .filter((field) => field.required)
    .filter((field) => {
      const source = mapping.fields[field.name];
      return !source || source.kind === 'none' || (source.kind === 'constant' && source.value.trim() === '');
    })
    .map((field) => field.label);
}

/** Drop constants left blank so the API sees an explicit `none`. */
export function cleanMapping(mapping: ImportMapping): ImportMapping {
  return {
    ...mapping,
    fields: Object.fromEntries(
      Object.entries(mapping.fields).map(([name, source]) => [
        name,
        source.kind === 'constant' && source.value.trim() === '' ? { kind: 'none' as const } : source,
      ]),
    ),
  };
}

/** Sources with the import's outcome banner (also used when a background import finishes). */
export function importedUrl(dealId: string, target: string, run: { recordsCreated: number; recordsUnchanged: number }, replayed = false): string {
  return `/deals/${dealId}/sources?imported=${encodeURIComponent(target)}&created=${run.recordsCreated}&unchanged=${run.recordsUnchanged}${replayed ? '&replayed=1' : ''}`;
}
