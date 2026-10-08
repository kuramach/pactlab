import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dealsApi } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { ApiState } from '../../../_lib/states';
import { uploadBillingExport } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  'no-file': 'Choose a CSV file to upload.',
  'no-system': 'Choose the system the export came from.',
  'too-large': 'The file is larger than 10 MB. Split it by period and upload each part.',
  'not-text': 'The file is not UTF-8 text. Export it as CSV (UTF-8) and try again.',
  unreadable: 'The file could not be read as CSV, or it was blocked by the virus scan.',
  scanner: 'Uploads are paused because the virus scanner is unavailable. Try again shortly.',
  forbidden: 'Your role cannot upload data to this deal.',
  'signed-out': 'Your session ended. Log in again.',
  error: 'The upload failed. Try again.',
};

/** Step 1 of a billing import: which system, which file. */
export default async function BillingUploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { dealId } = await params;
  const { error } = await searchParams;
  if (!isUuidParam(dealId)) notFound();
  const systems = await dealsApi.billingSystems();
  const upload = uploadBillingExport.bind(null, dealId);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/deals/${dealId}/sources`} className="text-sm text-muted-foreground hover:underline">
          ← Sources
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Upload a billing export</h1>
        <p className="text-sm text-muted-foreground">
          One row per invoice line, from any billing or ERP system. Next you’ll confirm how its columns map to Pactlab’s standard
          invoice line before anything is imported.
        </p>
      </header>
      {systems.kind !== 'ok' ? (
        <ApiState result={systems} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>1. Where is the export from?</CardTitle>
            <CardDescription>
              Verified systems come with a known column layout. For the others Pactlab suggests a mapping from the column names and
              you check it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={upload} className="flex flex-col gap-5">
              {error && ERRORS[error] ? (
                <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {ERRORS[error]}
                </p>
              ) : null}
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Billing system</legend>
                {systems.data.items.map((system) => (
                  <label key={system.system} className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border p-3 text-sm has-[:checked]:border-indigo-ink has-[:checked]:bg-muted">
                    <span className="flex items-center justify-between gap-2 font-medium">
                      <span className="flex items-center gap-2">
                        <input type="radio" name="system" value={system.system} required />
                        {system.label}
                      </span>
                      {system.verified ? <Badge variant="calculation">Verified layout</Badge> : <Badge>Suggested mapping</Badge>}
                    </span>
                    <span className="text-muted-foreground">{system.exportHint}</span>
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1 text-sm font-medium">
                2. Choose the CSV file (UTF-8, up to 10 MB)
                <input name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
              </label>
              <p className="text-xs text-muted-foreground">
                The file is virus-scanned and stored with this deal. Only the mapped invoice-line fields become evidence.{' '}
                <a href="/billing-template.csv" className="text-indigo-ink underline">
                  Download the Pactlab standard template
                </a>
                .
              </p>
              <div>
                <Button type="submit">Upload and map columns</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
