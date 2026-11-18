import { Badge, Button, Card, CardContent } from '@pactlab/ui';
import { checkSourcesNow } from './actions';

const cell = 'px-3 py-2 align-top';

export interface SourceStatus {
  source: string;
  label: string;
  status: 'OK' | 'FAILING' | null;
  checkedAt: string | null;
  lastOkAt: string | null;
  failingSince: string | null;
  detail: string | null;
}

const when = (value: string | null) => (value ? `${value.slice(0, 16).replace('T', ' ')} UTC` : '—');

/** Whether this environment can reach the public data it uses (T-137 follow-up): checked from here, every few hours. */
export function SourceStatusTable({ items }: { items: readonly SourceStatus[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Public data sources</h2>
          <form action={checkSourcesNow}>
            <Button type="submit" size="sm" variant="outline">Check now</Button>
          </form>
        </div>
        <p className="text-xs text-muted-foreground">Checked from this environment every few hours. The operator email is sent when a source starts failing or recovers.</p>
        {items.length === 0 ? (
          <p className="text-sm">Not checked yet.</p>
        ) : (
          <table className="w-full text-left text-sm" aria-label="Public data sources">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className={cell}>Source</th><th className={cell}>Status</th><th className={cell}>Last checked</th><th className={cell}>Since</th><th className={cell}>What came back</th></tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.source}>
                  <td className={cell}>{item.label}</td>
                  <td className={cell}>{item.status === 'OK' ? <Badge variant="calculation">Reachable</Badge> : item.status === 'FAILING' ? <Badge variant="danger">Failing</Badge> : 'Not checked yet'}</td>
                  <td className={cell}>{when(item.checkedAt)}</td>
                  <td className={cell}>{item.status === 'FAILING' ? `failing since ${when(item.failingSince)}` : item.lastOkAt ? `OK since ${when(item.lastOkAt)}` : '—'}</td>
                  <td className={cell}>{item.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

