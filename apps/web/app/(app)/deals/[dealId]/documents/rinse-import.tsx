'use client';

import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { importRinsedArchive, type RinseArchiveResult } from './actions';
import { OUTCOME, RINSE_REASONS, rinseLines } from './sources-panel';

/**
 * Injection path (b), T-178d: a folder finished in Pactlab Rinse, zipped with its manifest and imported
 * once. Every file is checked against the manifest as a connected folder's would be; each outcome is shown.
 */
export function RinseImport({ dealId, seller }: { dealId: string; seller: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RinseArchiveResult | null>(null);
  // Closed until asked for: the page's one file input stays the uploader's.
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="link" size="sm" className="self-start" type="button" onClick={() => setOpen(true)}>
        Import a set finished in Pactlab Rinse (zip)
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        void importRinsedArchive(dealId, form).then((next) => {
          setResult(next);
          setBusy(false);
          if (next.kind === 'ok') router.refresh();
        });
      }}
    >
      <p className="text-muted-foreground">
        A set finished in Pactlab Rinse, as one zip with its <code>pactlab-manifest.json</code>. Every file must match the manifest; anything added or changed after the rinse is refused.
      </p>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Zip of the finished set</span>
        <input type="file" name="file" accept=".zip,application/zip" required />
      </label>
      {seller ? null : (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="shared" /> Share the set with the seller
        </label>
      )}
      <Button type="submit" className="self-start" disabled={busy}>
        {busy ? 'Importing…' : 'Import the set'}
      </Button>
      {result?.kind === 'error' ? (
        <p role="alert" className="text-destructive">
          {result.message}
        </p>
      ) : null}
      {result?.kind === 'ok' ? (
        <div className="flex flex-col gap-2" role="status">
          <ul className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-xs">
            {rinseLines(result.rinse).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="What the import found">
            {result.files.map((file) => (
              <li key={file.path} className="flex flex-col gap-1 px-3 py-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{file.path}</span>
                  <Badge variant={file.outcome === 'REJECTED' ? 'danger' : 'reviewed'}>{file.outcome === 'SKIPPED' && file.reason && RINSE_REASONS[file.reason] ? 'Handled by the manifest' : OUTCOME[file.outcome]}</Badge>
                </span>
                {file.reason && RINSE_REASONS[file.reason] ? <span className="text-xs text-muted-foreground">{RINSE_REASONS[file.reason]}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
