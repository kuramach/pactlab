import { Card, CardContent, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { dealsApi } from '../deals/_lib/api';
import { ApiState } from '../deals/_lib/states';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

export default async function MetricsIndexPage() {
  const result = await dealsApi.list();
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">SaaS metrics</h1>
        <p className="text-sm text-muted-foreground">
          ARR, retention, cohorts and concentration computed from billing evidence, and
          reconciliation against management-reported figures.
        </p>
      </header>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          title="No deals yet"
          description="Create a deal or ask a deal lead to add you."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {result.data.items.map((deal) => (
                <li key={deal.id} className="flex flex-col px-4 py-3">
                  <Link href={`/metrics/${deal.id}`} className="font-medium hover:underline">
                    {deal.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">{deal.targetName}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
