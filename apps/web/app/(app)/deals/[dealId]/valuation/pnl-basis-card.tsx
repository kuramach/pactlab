import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, IconTile } from '@pactlab/ui';
import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '../../../metrics/_lib/format';

/** `GET /v1/deals/:dealId/valuation/pnl-basis` (T-149). */
export interface PnlBasisView {
  currency: string;
  imported: boolean;
  readerVersion: string;
  unavailable: string | null;
  trailing: {
    basis: 'TTM' | 'FISCAL_YEAR';
    from: string;
    to: string;
    periods: string[];
    revenue: string;
    ebitda: string;
    ebitdaBasis: string;
    lineCount: number;
    files: { uploadId: string; fileName: string; importedAt: string | null }[];
  } | null;
}

/** "Twelve months to 2025-12" or "Fiscal year 2025": the window a trailing figure covers. */
export function describeTrailing(trailing: NonNullable<PnlBasisView['trailing']>): string {
  return trailing.basis === 'TTM' ? `Trailing twelve months, ${trailing.from} to ${trailing.to}` : `Fiscal year ${trailing.from}`;
}

/**
 * Trailing revenue and EBITDA read from the imported P&L (T-149), with the files and the count
 * of rows they rest on. Shown for context and offered as a starting figure on a new scenario;
 * a scenario changes only when a person saves it.
 */
export function PnlBasisCard({ dealId, view }: { dealId: string; view: PnlBasisView }) {
  const money = (amount: string) => formatMoney({ amount, currency: view.currency });
  return (
    <Card id="pnl-basis">
      <CardHeader className="flex flex-row flex-wrap items-start gap-3">
        <IconTile accent="navy">
          <FileSpreadsheet />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle>Trailing revenue and EBITDA, from the imported P&L</CardTitle>
          <CardDescription>Read line by line from the import, never typed. New scenarios start from these figures; you can change them before saving.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {view.trailing ? (
          <>
            <dl className="grid gap-1 sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted-foreground">Revenue</dt>
              <dd className="tabular-nums">
                <strong>{money(view.trailing.revenue)}</strong> <Badge variant="calculation">calculated</Badge>
              </dd>
              <dt className="text-muted-foreground">EBITDA</dt>
              <dd className="tabular-nums">
                <strong>{money(view.trailing.ebitda)}</strong> <Badge variant="calculation">calculated</Badge>
              </dd>
              <dt className="text-muted-foreground">Period</dt>
              <dd>{describeTrailing(view.trailing)}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                <Badge variant="evidence">Imported P&L</Badge>{' '}
                {view.trailing.files.map((file, index) => (
                  <span key={file.uploadId}>
                    {index ? ', ' : ''}
                    <Link className="underline" href={`/deals/${dealId}/sources/upload/${file.uploadId}`}>
                      {file.fileName}
                    </Link>
                  </span>
                ))}
                {` · ${view.trailing.lineCount} rows · ${view.readerVersion}`}
              </dd>
            </dl>
            <p className="text-muted-foreground">{view.trailing.ebitdaBasis}</p>
          </>
        ) : view.imported ? (
          <p className="text-muted-foreground">{view.unavailable}</p>
        ) : (
          <p className="text-muted-foreground">
            No P&L imported yet. <Link className="underline" href={`/deals/${dealId}/sources/upload`}>Import one</Link> and trailing revenue and EBITDA are read from it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
