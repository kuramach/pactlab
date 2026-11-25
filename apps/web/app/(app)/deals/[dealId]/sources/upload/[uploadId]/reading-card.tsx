'use client';

import type { UploadDetailView } from '@pactlab/contracts';
import { isPnlLine, type ImportLayout, type PnlKind, type TargetDefinition } from '@pactlab/domain';
import { Button } from '@pactlab/ui';
import { useState } from 'react';

type Reading = NonNullable<NonNullable<UploadDetailView['assist']>['reading']>;

const count = new Intl.NumberFormat('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${count.format(n)} ${n === 1 ? one : many}`;
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const GROUP_LABELS: Record<Reading['rowGroups'][number]['kind'], string> = {
  TITLE: 'Titles',
  HEADER: 'Column names',
  DATA: 'Data',
  SUBTOTAL: 'Totals',
  NOTES: 'Notes',
  BLANK: 'Blank',
};
const GROUP_STYLES: Record<Reading['rowGroups'][number]['kind'], string> = {
  TITLE: 'bg-muted text-muted-foreground',
  HEADER: 'bg-sky-100 text-sky-900',
  DATA: 'bg-emerald-100 text-emerald-900',
  SUBTOTAL: 'bg-amber-100 text-amber-900',
  NOTES: 'bg-muted text-muted-foreground',
  BLANK: 'bg-muted text-muted-foreground',
};

/**
 * How Pactlab read the file, in plain sentences worked out by code from the read itself (Kumar, 2026-11-25:
 * "discuss how the file is setup, how the rows are setup and what it needs to learn from the user"). Facts only:
 * every sentence follows from the header, the layout and the mapping, with or without the assistant.
 */
export function readingFacts(input: {
  definition: Pick<TargetDefinition, 'label' | 'fields' | 'lineItems'>;
  headerRow: number | null;
  header: readonly string[];
  rowCount: number | null;
  layout: ImportLayout | undefined;
  lineKinds: Readonly<Record<string, PnlKind>> | undefined;
  matched: number;
  questions: number;
}): string[] {
  const { definition, header } = input;
  const facts: string[] = [];
  const shown = header.slice(0, 4).map((name) => `“${name}”`).join(', ');
  facts.push(`The column names are on row ${input.headerRow ?? 1}${shown ? `: ${shown}${header.length > 4 ? ` and ${count.format(header.length - 4)} more` : ''}` : ''}.`);
  if (input.headerRow !== null && input.headerRow > 1) facts.push(`${input.headerRow === 2 ? 'Row 1 is a title' : `Rows 1–${input.headerRow - 1} are titles`}, so ${input.headerRow === 2 ? 'it is' : 'they are'} skipped.`);
  const layout = input.layout;
  if (layout && layout.kind !== 'ROWS' && layout.periods.length > 0) {
    const first = layout.periods[0]?.period ?? '';
    const last = layout.periods.at(-1)?.period ?? first;
    facts.push(`Months run across the columns, ${monthName(first)} to ${monthName(last)} (${plural(layout.periods.length, 'month')}).`);
  } else if (input.rowCount !== null) {
    facts.push(`Below them ${input.rowCount === 1 ? 'is 1 row' : `are ${count.format(input.rowCount)} rows`}; each row becomes one record of ${definition.label.toLowerCase()}.`);
  }
  if (definition.lineItems) {
    const kinds = Object.values(input.lineKinds ?? {});
    const lines = kinds.filter((kind) => isPnlLine(kind)).length;
    const totals = kinds.length - lines;
    if (kinds.length > 0) facts.push(`${plural(lines, 'line is', 'lines are')} income or costs and ${plural(totals, 'is a total', 'are totals')}. Totals are checked against the lines, not imported.`);
  }
  const required = definition.fields.length;
  facts.push(`${count.format(input.matched)} of ${count.format(required)} fields are matched to a column.${input.questions > 0 ? ` Pactlab has ${plural(input.questions, 'question')} for you below.` : ''}`);
  return facts;
}

/**
 * Before the mapping: "Here's how I read your file", with a yes or a "not quite" that opens the guidance. The
 * assistant's own words and row groups come after the facts, marked as its reading; the fields below stay the
 * person's to confirm.
 */
export function ReadingCard({ facts, reading, onExplain }: { facts: readonly string[]; reading: Reading | null; onExplain: () => void }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  if (answer === 'yes') {
    return (
      <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Thanks. Pactlab will read the file this way. Check the columns below, then import.{' '}
        <button type="button" className="underline" onClick={() => setAnswer(null)}>
          Change your answer
        </button>
      </p>
    );
  }
  return (
    <section aria-labelledby="reading" className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm">
      <h3 id="reading" className="text-base font-semibold">
        Here’s how Pactlab read your file
      </h3>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {reading?.summary ? (
        <figure className="flex flex-col gap-1 rounded-md bg-background px-3 py-2">
          <figcaption className="text-xs text-muted-foreground">In the AI’s words</figcaption>
          <blockquote>{reading.summary}</blockquote>
        </figure>
      ) : null}
      {reading && reading.rowGroups.length > 0 ? (
        <ol aria-label="How the rows are set up" className="flex flex-wrap gap-1.5">
          {reading.rowGroups.map((group) => (
            <li key={`${group.from}-${group.to}`} className={`rounded-full px-2.5 py-0.5 text-xs ${GROUP_STYLES[group.kind]}`} title={group.note || undefined}>
              {group.from === group.to ? `Row ${group.from}` : `Rows ${group.from}–${group.to}`}: {GROUP_LABELS[group.kind]}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Is that right?</span>
        <Button size="sm" onClick={() => setAnswer('yes')}>
          Yes, that’s right
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAnswer('no');
            onExplain();
          }}
        >
          Not quite, let me explain
        </Button>
      </div>
      {answer === 'no' ? <p className="text-muted-foreground">Tell Pactlab what it got wrong below, in your own words, then read the file again.</p> : null}
    </section>
  );
}
