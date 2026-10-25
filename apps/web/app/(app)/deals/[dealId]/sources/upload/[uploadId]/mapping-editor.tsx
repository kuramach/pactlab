'use client';

import type { ImportMappingBody, ImportPreviewView, ImportProgressView, UploadDetailView } from '@pactlab/contracts';
import { AMOUNT_UNITS, DATE_FORMATS, NUMBER_FORMATS, type ImportMapping } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { choiceOf, cleanMapping, definitionFor, importedUrl, sourceFromChoice, unmappedRequired } from '../_lib/mapping-form';
import { cancelUpload, chooseSheet, importProgressOf, importWithMapping, previewMapping } from '../actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const NUMBER_LABELS: Record<(typeof NUMBER_FORMATS)[number], string> = {
  DOT_DECIMAL: '1,234.56',
  COMMA_DECIMAL: '1.234,56',
};
const UNIT_LABELS: Record<(typeof AMOUNT_UNITS)[number], string> = {
  MAJOR: 'Whole units (12.50)',
  MINOR: 'Smallest unit, e.g. cents (1250)',
};
const DELIMITER_LABELS: Record<string, string> = { ',': 'comma-separated', ';': 'semicolon-separated', '\t': 'tab-separated' };
const PHASE_LABELS: Record<ImportProgressView['phase'], string> = {
  QUEUED: 'Waiting for the import worker…',
  READING: 'Reading the file…',
  VALIDATING: 'Checking every row…',
  WRITING: 'Writing evidence…',
  DONE: 'Finishing…',
};
const POLL_MS = 2_000;

/** How the file was read, in words: “Excel workbook, sheet Loans” or “semicolon-separated text, Windows-1252”. */
export function describeRead(read: ReadInfo): string {
  if (read.format === 'XLSX') return `Excel workbook, sheet “${read.sheet ?? ''}”`;
  const separated = DELIMITER_LABELS[read.delimiter ?? ','] ?? 'comma-separated';
  return `${separated} text${read.encoding === 'WINDOWS-1252' ? ', Windows-1252 (Western European) characters' : ''}`;
}

type ReadInfo = Pick<UploadDetailView, 'format' | 'encoding' | 'delimiter' | 'sheet' | 'sheets'>;

const ISSUE_TEXT: Record<string, string> = {
  MISSING_RECORD_ID: 'Rows without a record id',
  MISSING_FIELD: 'Rows missing a required value',
  INVALID_DATE: 'Dates that don’t match the chosen format',
  INVALID_VALUE: 'Amounts or values that couldn’t be read',
  DUPLICATE_RECORD_ID: 'Repeated record ids',
  MISSING_COLUMN: 'Mapping problems',
};

/**
 * Step 2 and 3: confirm how each column maps to the import target's fields —
 * the standard invoice line for billing, or a pack extract such as a loan tape
 * or rent roll (ADR 0010) — check the result on every row, then import. The
 * server decides every step.
 */
export function MappingEditor({
  dealId,
  uploadId,
  header,
  sample,
  suggested,
  read,
}: {
  dealId: string;
  uploadId: string;
  header: string[];
  sample: string[][];
  suggested: ImportMappingBody;
  /** How the API read the file; absent for older callers (treated as CSV). */
  read?: ReadInfo;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<ImportMapping>(suggested as ImportMapping);
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A background import (large files): the run to follow, and its last progress.
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgressView | null>(null);
  // The upload's own target decides the fields: never assume billing.
  const definition = definitionFor(mapping);
  const billing = definition.target === 'BILLING_INVOICE_LINE';
  const hasMoney = definition.fields.some((field) => field.kind === 'money');
  const missing = unmappedRequired(mapping, definition);

  const update = (next: ImportMapping) => {
    setMapping(next);
    setPreview(null);
    setMessage(null);
  };
  const columnSample = (choice: string) => {
    const index = choice.startsWith('column:') ? header.indexOf(choice.slice(7)) : -1;
    return index < 0 ? '' : sample.map((row) => row[index] ?? '').filter(Boolean).slice(0, 3).join(' · ');
  };
  const check = () =>
    startTransition(async () => {
      const result = await previewMapping(dealId, uploadId, cleanMapping(mapping));
      if (result.kind === 'ok') setPreview(result.preview);
      else setMessage(result.kind === 'error' ? result.message : null);
    });
  const runImport = () =>
    startTransition(async () => {
      const result = await importWithMapping(dealId, uploadId, cleanMapping(mapping));
      if (result.kind === 'background') setRunId(result.runId);
      else setMessage(result.message);
    });
  const pickSheet = (sheet: string) =>
    startTransition(async () => {
      const result = await chooseSheet(dealId, uploadId, sheet);
      if (result.message) setMessage(result.message);
      else router.refresh();
    });

  // Follow a background import until it finishes; leaving the page does not stop it.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const next = await importProgressOf(dealId, runId);
      if (stopped) return;
      if (next) setProgress(next);
      if (next?.status === 'SUCCEEDED') {
        router.push(importedUrl(dealId, mapping.target, next));
        return;
      }
      if (next?.status === 'FAILED') {
        setMessage('The import failed before all evidence was written. Nothing partial was kept — import again to retry.');
        setRunId(null);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, dealId, mapping.target, router]);
  const cancel = () =>
    startTransition(async () => {
      const result = await cancelUpload(dealId, uploadId);
      setMessage(result.message);
    });
  const ready = preview !== null && preview.problems.length === 0 && preview.validRows > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>2. Map columns to the {billing ? 'standard invoice line' : definition.label.toLowerCase()}</CardTitle>
          <CardDescription>
            {billing
              ? 'Pick the column for each field, or a fixed value when every line shares one (for example a billing interval of “month”). Required fields are marked.'
              : 'Pick the column for each field, or a fixed value when every row shares one. Required fields are marked.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {read ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>Read as {describeRead(read)}.</span>
              {read.format === 'XLSX' && read.sheets.length > 1 ? (
                <label className="flex items-center gap-2 font-medium text-foreground">
                  Sheet
                  <select
                    aria-label="Sheet"
                    className={`${inputClass} w-auto`}
                    value={read.sheet ?? ''}
                    disabled={pending || runId !== null}
                    onChange={(event) => pickSheet(event.target.value)}
                  >
                    {read.sheets.map((sheet) => (
                      <option key={sheet}>{sheet}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Date format
              <select
                className={inputClass}
                value={mapping.dateFormat}
                onChange={(event) => update({ ...mapping, dateFormat: event.target.value as ImportMapping['dateFormat'] })}
              >
                {DATE_FORMATS.map((format) => (
                  <option key={format}>{format}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Number format
              <select
                className={inputClass}
                value={mapping.numberFormat}
                onChange={(event) => update({ ...mapping, numberFormat: event.target.value as ImportMapping['numberFormat'] })}
              >
                {NUMBER_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {NUMBER_LABELS[format]}
                  </option>
                ))}
              </select>
            </label>
            {hasMoney ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Amounts are in
              <select
                className={inputClass}
                value={mapping.amountUnit}
                onChange={(event) => update({ ...mapping, amountUnit: event.target.value as ImportMapping['amountUnit'] })}
              >
                {AMOUNT_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>
            </label>
            ) : null}
          </div>
          {billing ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mapping.negateAmounts}
              onChange={(event) => update({ ...mapping, negateAmounts: event.target.checked })}
            />
            This export holds credit notes — flip every amount’s sign
          </label>
          ) : null}

          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Pactlab field</th>
                <th className="py-2 pr-3 font-medium">From your file</th>
                <th className="py-2 font-medium">Sample values</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {definition.fields.map((field) => {
                const source = mapping.fields[field.name];
                const choice = choiceOf(source);
                return (
                  <tr key={field.name} className="align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{field.label}</span>
                      {field.required ? <span className="ml-1 text-red-700">*</span> : null}
                      <span className="block text-xs text-muted-foreground">{field.hint}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Source for ${field.label}`}
                        className={inputClass}
                        value={choice}
                        onChange={(event) =>
                          update({ ...mapping, fields: { ...mapping.fields, [field.name]: sourceFromChoice(event.target.value, source) } })
                        }
                      >
                        <option value="none">— Not in this file —</option>
                        {header.map((column) => (
                          <option key={column} value={`column:${column}`}>
                            {column}
                          </option>
                        ))}
                        {field.name === definition.recordIdField ? null : <option value="constant">Fixed value…</option>}
                      </select>
                      {source?.kind === 'constant' ? (
                        <input
                          aria-label={`Fixed value for ${field.label}`}
                          className={`${inputClass} mt-1`}
                          value={source.value}
                          onChange={(event) =>
                            update({ ...mapping, fields: { ...mapping.fields, [field.name]: { kind: 'constant', value: event.target.value } } })
                          }
                        />
                      ) : null}
                    </td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {source?.kind === 'constant' ? source.value : columnSample(choice)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {missing.length > 0 ? (
            <p className="text-sm text-muted-foreground">Still required: {missing.join(', ')}.</p>
          ) : null}
          <div>
            <Button onClick={check} disabled={pending || missing.length > 0}>
              {pending && !preview ? 'Checking…' : 'Check every row'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Validation report</CardTitle>
            <CardDescription>
              {preview.validRows} of {preview.rowCount} {billing ? 'lines' : 'rows'} are ready to import. Nothing has been imported yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {preview.problems.length > 0 ? (
              <ul role="alert" className="list-disc pl-5 text-red-800">
                {preview.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {preview.totals.length > 0 ? (
              <dl className="flex flex-wrap gap-4" data-numeric>
                {preview.totals.map((total) => (
                  <div key={total.currency} className="rounded-lg border border-border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">
                      {total.currency} · {total.lines} lines
                    </dt>
                    <dd className="font-mono text-base">{total.amount}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {preview.issues.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="font-medium">Rows that will be skipped</span>
                <ul className="flex flex-col gap-1">
                  {preview.issues.map((issue) => (
                    <li key={issue.code}>
                      <Badge variant="draft">{issue.count}</Badge> {ISSUE_TEXT[issue.code] ?? issue.code}
                      {issue.rows.length > 0 ? <span className="text-muted-foreground"> — e.g. rows {issue.rows.join(', ')}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.emptyFields.length > 0 ? (
              <p className="text-muted-foreground">
                Empty on some lines:{' '}
                {preview.emptyFields
                  .map((entry) => `${definition.fields.find((field) => field.name === entry.field)?.label ?? entry.field} (${entry.rows})`)
                  .join(', ')}
                .{billing ? ' Lines without a customer, interval or service period are imported but left out of ARR, with the reason shown in Finances.' : ' Empty optional values are imported as missing, never filled in.'}
              </p>
            ) : null}
            {preview.sample.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      {definition.fields.map((field) => (
                        <th key={field.name} className="whitespace-nowrap py-1 pr-3 font-medium">
                          {field.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row, index) => (
                      <tr key={index} className="border-t border-border">
                        {definition.fields.map((field) => (
                          <td key={field.name} className="whitespace-nowrap py-1 pr-3">
                            {row[field.name] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {runId ? (
              <div role="status" aria-label="Import progress" className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <span className="font-medium">{PHASE_LABELS[progress?.phase ?? 'QUEUED']}</span>
                <progress className="h-2 w-full" max={progress?.total ?? preview.validRows} value={progress?.processed ?? 0} />
                <span className="text-xs text-muted-foreground" data-numeric>
                  {(progress?.processed ?? 0).toLocaleString('en-US')} of {(progress?.total ?? preview.validRows).toLocaleString('en-US')} {billing ? 'lines' : 'rows'} · large files import in the background, so you can leave this page and check Sources later.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button onClick={runImport} disabled={!ready || pending}>
                  {pending ? 'Importing…' : `Import ${preview.validRows} ${billing ? 'lines' : 'rows'}`}
                </Button>
                <span className="text-xs text-muted-foreground">Importing the same file and mapping twice changes nothing.</span>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm">
        <span className="text-muted-foreground">Wrong file? Cancel discards this upload — nothing is imported and the stored copy is deleted.</span>
        <Button variant="outline" size="sm" onClick={cancel} disabled={pending || runId !== null}>
          Cancel upload
        </Button>
      </div>

      {message ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
