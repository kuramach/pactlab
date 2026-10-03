import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';

const LOOP = [
  'Source evidence',
  'Normalized evidence',
  'Reviewable finding',
  'Explicit assumption',
  'Valuation scenario',
  'Proposed deal term',
  'Approved integration action',
];

export default function OverviewPage() {
  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Every result stays traceable to source evidence and a reviewer decision.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>The decision loop</CardTitle>
          <CardDescription>From evidence to an approved action, with provenance at each step.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {LOOP.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <span className="rounded-md border border-border px-2 py-1">{step}</span>
                {index < LOOP.length - 1 ? <span aria-hidden="true">→</span> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <EmptyState title="No deals yet" description="Sign in to see the deals you are a member of." />
    </div>
  );
}
