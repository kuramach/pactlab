'use client';

import type { ImportMappingBody, ImportPreviewView } from '@pactlab/contracts';
import {
  AMOUNT_UNITS,
  BILLING_INVOICE_LINE,
  DATE_FORMATS,
  NUMBER_FORMATS,
  type ImportMapping,
} from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { useState, useTransition } from 'react';
import { choiceOf, cleanMapping, sourceFromChoice, unmappedRequired } from '../_lib/mapping-form';
import { importWithMapping, previewMapping } from '../actions';

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
const ISSUE_TEXT: Record<string, string> = {
  MISSING_RECORD_ID: 'Rows without a line id',
  MISSING_FIELD: 'Rows missing a required value',
  INVALID_DATE: 'Dates that don’t match the chosen format',
  INVALID_VALUE: 'Amounts or values that couldn’t be read',
  DUPLICATE_RECORD_ID: 'Repeated line ids',
  MISSING_COLUMN: 'Mapping problems',
};

/**
 * Step 2 and 3: confirm how each column maps to the standard invoice line,
 * check the result on every row, then import. The server decides every step.
 */
export function MappingEditor({
  dealId,
  uploadId,
  header,
  sample,
  suggested,
}: {
  dealId: string;
  uploadId: string;
  header: string[];
  sample: string[][];
  suggested: ImportMappingBody;
}) {
  const [mapping, setMapping] = useState<ImportMapping>(suggested as ImportMapping);
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const missing = unmappedRequired(mapping);

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
      setMessage(result.message);
    });
  const ready = preview !== null && preview.problems.length === 0 && preview.validRows > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>2. Map columns to the standard invoice line</CardTitle>
          <CardDescription>
            Pick the column for each field, or a fixed value when every line shares one (for example a billing interval of
            “month”). Required fields are marked.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
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
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mapping.negateAmounts}
              onChange={(event) => update({ ...mapping, negateAmounts: event.target.checked })}
            />
            This export holds credit notes — flip every amount’s sign
          </label>

          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Pactlab field</th>
                <th className="py-2 pr-3 font-medium">From your file</th>
                <th className="py-2 font-medium">Sample values</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {BILLING_INVOICE_LINE.fields.map((field) => {
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
                        {field.name === BILLING_INVOICE_LINE.recordIdField ? null : <option value="constant">Fixed value…</option>}
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
              {preview.validRows} of {preview.rowCount} lines are ready to import. Nothing has been imported yet.
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
                  .map((entry) => `${BILLING_INVOICE_LINE.fields.find((field) => field.name === entry.field)?.label ?? entry.field} (${entry.rows})`)
                  .join(', ')}
                . Lines without a customer, interval or service period are imported but left out of ARR, with the reason shown in
                Finances.
              </p>
            ) : null}
            {preview.sample.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      {BILLING_INVOICE_LINE.fields.map((field) => (
                        <th key={field.name} className="whitespace-nowrap py-1 pr-3 font-medium">
                          {field.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row, index) => (
                      <tr key={index} className="border-t border-border">
                        {BILLING_INVOICE_LINE.fields.map((field) => (
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
            <div className="flex items-center gap-3">
              <Button onClick={runImport} disabled={!ready || pending}>
                {pending ? 'Importing…' : `Import ${preview.validRows} lines`}
              </Button>
              <span className="text-xs text-muted-foreground">Importing the same file and mapping twice changes nothing.</span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {message ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
