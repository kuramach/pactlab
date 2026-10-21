import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { OutcomeBanner } from '../../../_lib/outcome';
import { connectSynthetic } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  choose: 'Choose a repository, a Jira site, or both.',
  forbidden: 'Synthetic test data is not available in this environment, or your role cannot add sources.',
  invalid: 'That combination was refused. Pick from the lists.',
};

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

interface SyntheticSources {
  allowed: boolean;
  repositories: string[];
  jiraSites: { site: string; projectKeys: string[] }[];
}

/** Attach synthetic repositories and Jira sites to a test deal (local and test environments only). */
export default async function SyntheticSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { dealId } = await params;
  const { outcome } = await searchParams;
  if (!isUuidParam(dealId)) notFound();
  const result = await apiGet<SyntheticSources>('/v1/synthetic-sources');
  const options = result.kind === 'ok' ? result.data : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/deals/${dealId}/sources`} className="text-sm text-muted-foreground hover:underline">
          ← Sources
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">Connect synthetic test data</h2>
        <p className="text-sm text-muted-foreground">
          Invented repositories and Jira sites for testing a deal end to end. They are labelled synthetic everywhere and never available in production.
        </p>
      </header>
      <OutcomeBanner outcome={outcome} messages={OUTCOMES} />
      {!options?.allowed ? (
        <EmptyState title="Not available here" description="Synthetic test data is turned off in this environment. Connect the seller’s real systems instead." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Pick a company’s systems</CardTitle>
            <CardDescription>
              HealthyCo is a balanced team; TroubledCo has a sole maintainer, ghost commits and a coordinating lead; SparseCo is too small for individual
              profiles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={connectSynthetic.bind(null, dealId)} className="flex flex-col gap-4 text-sm">
              <label className="flex flex-col gap-1 font-medium">
                Repository
                <select name="repository" defaultValue="" className={inputClass}>
                  <option value="">None</option>
                  {options.repositories.map((repository) => (
                    <option key={repository} value={repository}>
                      {repository}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Jira site
                <select name="jiraSite" defaultValue="" className={inputClass}>
                  <option value="">None</option>
                  {options.jiraSites.map((site) => (
                    <option key={site.site} value={`${site.site}|${site.projectKeys.join(',')}`}>
                      {site.site} ({site.projectKeys.join(', ')})
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">Both are synced at once; then the Engineering tab opens.</p>
              <div>
                <Button type="submit">Connect and sync</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
