import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Glossed } from '@pactlab/ui';
import Link from 'next/link';
import { BarChart, CHART_COLORS } from '../../../../../_lib/charts';
import { apiGet } from '../../../../_lib/api';
import { ApiState } from '../../../../_lib/states';
import { displayName, percentLabel, TAG_LABELS, type PeopleAccessView, type ProfileView } from '../../view';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

interface ContributorResponse {
  profile: ProfileView;
  people: PeopleAccessView;
  series: { month: string; commits: number; issuesResolved: number; issuesCreated: number }[];
  areas: { area: string; commits: number; contributors: number; busFactor: number }[];
}

const month = (value: string) => new Date(`${value}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** One contributor: code and delivery side by side, with the tags explained. Activity, not performance. */
export default async function ContributorPage({ params }: { params: Promise<{ dealId: string; contributorKey: string }> }) {
  const { dealId, contributorKey } = await params;
  const result = await apiGet<ContributorResponse>(`/v1/deals/${dealId}/engineering/contributors/${encodeURIComponent(contributorKey)}`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const { profile, series, areas } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/deals/${dealId}/engineering`} className="text-sm text-muted-foreground hover:underline">
        ← Engineering
      </Link>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{displayName(profile)}</h2>
        <div className="flex flex-wrap gap-1">
          {profile.tags.map((tag) => (
            <Badge key={tag} variant={TAG_LABELS[tag].variant}>
              {TAG_LABELS[tag].label}
            </Badge>
          ))}
          {profile.status === 'DEPARTED' ? <Badge variant="neutral">departed</Badge> : null}
        </div>
        <p className="max-w-3xl text-sm text-slate-text">{profile.summary}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Code and delivery, by month</CardTitle>
          <CardDescription>Commits beside Jira issues resolved and created — senior people often show more of the second.</CardDescription>
        </CardHeader>
        <CardContent>
          <BarChart
            label="Commits, issues resolved and issues created per month"
            categories={series.map((entry) => month(entry.month))}
            series={[
              { name: 'Commits', values: series.map((entry) => entry.commits), color: CHART_COLORS.indigo },
              { name: 'Issues resolved', values: series.map((entry) => entry.issuesResolved), color: CHART_COLORS.navy },
              { name: 'Issues created', values: series.map((entry) => entry.issuesCreated), color: CHART_COLORS.amber },
            ]}
            format="count"
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Last 12 months</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm" data-numeric>
              {(
                [
                  ['Commits', profile.commits],
                  ['Lines changed', profile.linesChanged],
                  ['Issues resolved', profile.issuesResolved],
                  ['Story points resolved', profile.pointsResolved],
                  ['Issues created', profile.issuesCreated],
                  ['Comments', profile.comments],
                  ['Resolved later reopened', percentLabel(profile.reopenRatio)],
                  ['Active since', profile.firstActiveMonth],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-mist p-3">
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{label}</dt>
                  <dd className="font-mono font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Areas</CardTitle>
            <CardDescription>Where they commit; “sole” means they make at least 80% of that area’s commits.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {areas.length === 0 ? (
              <p className="text-muted-foreground">No commits in the last 12 months.</p>
            ) : (
              areas.map((area) => (
                <div key={area.area} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{area.area}/</span>
                  <span className="text-xs text-muted-foreground">
                    {profile.areasSolelyOwned.includes(area.area) ? 'sole owner · ' : profile.areasOwned.includes(area.area) ? 'main owner · ' : ''}
                    {area.contributors} contributors · bus factor {area.busFactor}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        <Glossed text="Activity in GitHub and Jira only. Reviews, design, mentoring and work in other tools are not counted. Never sent to AI." />
      </p>
    </div>
  );
}
