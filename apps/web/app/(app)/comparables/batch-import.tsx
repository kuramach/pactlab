'use client';

import { COMPARABLE_BATCH_MAX_ROWS, csvCell, type ComparableBatchPreviewView, type ComparableBatchRowView } from '@pactlab/contracts';
import { Badge, Button, buttonVariants } from '@pactlab/ui';
import { useActionState, useState, type ChangeEvent } from 'react';
import { formatMoney } from '../metrics/_lib/format';
import { batchComparables, type BatchState } from './actions';
import { formatMultiple } from './_lib/view';

const STATUS = {
  OK: { variant: 'calculation', text: 'OK' },
  PROBLEM: { variant: 'danger', text: 'Problem' },
  DUPLICATE: { variant: 'draft', text: 'Duplicate?' },
} as const;

/** The rows with problems, as a CSV with the file's own headers plus the reasons, to fix and upload again. */
function problemsCsv(preview: ComparableBatchPreviewView): string {
  const headers = preview.headers.length > 0 ? preview.headers : Object.keys(preview.rows[0]?.cells ?? {});
  const lines = [[...headers, 'Problems'], ...preview.rows.filter((row) => row.status === 'PROBLEM').map((row) => [...headers.map((header) => row.cells[header] ?? ''), problemText(row)])];
  return `${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const problemText = (row: ComparableBatchRowView) => row.problems.map((problem) => `${problem.column}: ${problem.message}`).join('; ');

function downloadCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * "Add many" (T-111): a CSV file or rows pasted from a spreadsheet, checked
 * row by row before anything is saved, then imported in one go.
 */
export function BatchImport() {
  const [state, action, pending] = useActionState<BatchState, FormData>(batchComparables, { kind: 'idle' });
  const [text, setText] = useState('');
  const preview = state.kind === 'checked' ? state.preview : state.kind === 'imported' ? state.result : null;
  // The import uses exactly the text that was checked; editing it means checking again.
  // (Forms submit a textarea's line breaks as CRLF, so compare without them.)
  const lines = (value: string) => value.replace(/\r\n?/g, '\n');
  const checkedCurrent = state.kind === 'checked' && lines(state.text) === lines(text);
  const ready = preview ? preview.counts.ok : 0;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (chosen) setText(await chosen.text());
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href="/comparables/template.csv" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Download template
        </a>
        <label className="flex items-center gap-2 font-medium">
          CSV file
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" onChange={onFile} className="text-sm" />
        </label>
        <span className="text-muted-foreground">or paste rows, header first, straight from Excel or Google Sheets. Up to {COMPARABLE_BATCH_MAX_ROWS} rows.</span>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Rows
        <textarea
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={'Kind\tName\tTarget\tAcquirer\tDate\tCompany type\t…'}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      {state.kind === 'error' ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'imported' ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Imported {state.result.imported} comparable{state.result.imported === 1 ? '' : 's'}. Benchmarks on every deal now include them.
          {state.result.counts.problems > 0 ? ` ${state.result.counts.problems} row${state.result.counts.problems === 1 ? ' was' : 's were'} left out; download them below to fix.` : ''}
        </p>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm" aria-live="polite">
            <span className="font-semibold">{preview.counts.total} rows:</span> {preview.counts.ok} ready, {preview.counts.problems} with problems, {preview.counts.duplicates} possible
            duplicate{preview.counts.duplicates === 1 ? '' : 's'}.
            {preview.unknownColumns.length > 0 ? ` Ignored columns: ${preview.unknownColumns.join(', ')}.` : ''}
            {preview.missingColumns.length > 0 ? ` Missing columns: ${preview.missingColumns.join(', ')}.` : ''}
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="sticky top-0 bg-background text-xs uppercase tracking-wide text-slate-text">
                <tr>
                  <th className="px-3 py-2 font-bold">Row</th>
                  <th className="px-3 py-2 font-bold">Status</th>
                  <th className="px-3 py-2 font-bold">Comparable</th>
                  <th className="px-3 py-2 text-right font-bold">EV</th>
                  <th className="px-3 py-2 text-right font-bold">ARR</th>
                  <th className="px-3 py-2 text-right font-bold">Multiple</th>
                  <th className="px-3 py-2 font-bold">Problems</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className="border-t border-navy/5 align-top">
                    <td className="px-3 py-2 font-mono text-xs">{row.line}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].text}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {row.summary ? (
                        <>
                          <div className="font-semibold">{row.summary.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.summary.targetName}
                            {row.summary.announcedOn ? ` · ${row.summary.announcedOn}` : ''}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{Object.values(row.cells).slice(0, 3).filter(Boolean).join(' · ') || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{row.summary ? formatMoney({ amount: row.summary.enterpriseValue, currency: row.summary.currency }) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.summary ? formatMoney({ amount: row.summary.arr, currency: row.summary.currency }) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.summary ? formatMultiple(row.summary.multiple) : '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.status === 'PROBLEM' ? (
                        <ul className="flex flex-col gap-0.5">
                          {row.problems.map((problem) => (
                            <li key={`${problem.column}:${problem.message}`}>
                              <span className="font-semibold">{problem.column}:</span> {problem.message}
                            </li>
                          ))}
                        </ul>
                      ) : row.status === 'DUPLICATE' ? (
                        state.kind === 'checked' ? (
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="keep" value={row.line} />
                            {row.duplicateOf === 'EXISTING' ? 'Same name, target and date as a comparable on record.' : 'Same as an earlier row.'} Keep it anyway
                          </label>
                        ) : (
                          'Left out as a duplicate.'
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="intent" value="check" variant={checkedCurrent ? 'outline' : 'default'} disabled={pending || text.trim() === ''}>
          {pending ? 'Working…' : 'Check rows'}
        </Button>
        {checkedCurrent ? (
          <Button type="submit" name="intent" value="import" disabled={pending}>
            Import {ready > 0 ? `${ready} ready row${ready === 1 ? '' : 's'}` : 'kept rows'}
          </Button>
        ) : null}
        {preview && preview.counts.problems > 0 ? (
          <Button type="button" variant="outline" onClick={() => downloadCsv(problemsCsv(preview), 'comparables-with-problems.csv')}>
            Download rows with problems
          </Button>
        ) : null}
      </div>
    </form>
  );
}
