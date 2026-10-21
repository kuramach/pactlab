import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Glossed, IconTile, Stat } from '@pactlab/ui';
import { EyeOff, GitBranch, HeartHandshake, ListChecks, Users } from 'lucide-react';
import Link from 'next/link';
import { BarChart, CHART_COLORS, LineChart } from '../../../_lib/charts';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { setPeopleAccess } from './actions';
import { displayName, percentLabel, TAG_LABELS, type EngineeringView } from './view';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-names-on': 'Names are now shown on this deal. Every view is recorded in the audit log.',
  'ok-names-off': 'Names are hidden again.',
  basis: 'Give the basis in a sentence, e.g. “Seller agreed in the data-room terms; employees notified”.',
  forbidden: 'Only the deal lead can show or hide names.',
};

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const month = (value: string) => new Date(`${value}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/**
 * Engineering: how the team works and who the business depends on, from
 * code and delivery activity. Profiles describe activity, not performance;
 * names appear only after the deal lead records a basis. Never sent to AI.
 */
export default async function EngineeringPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<EngineeringView>(`/v1/deals/${dealId}/engineering`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const hasData = view.months.some((entry) => entry.commits + entry.issuesResolved > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Engineering</h2>
        <p className="text-sm text-muted-foreground">
          <Glossed text="How the team builds and delivers, and who the business depends on — from repository and Jira activity, last 12 months. Numbers describe activity, not performance." />
        </p>
      </div>
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      {view.sources.length === 0 || !hasData ? (
        <EmptyState
          title="No code or delivery data yet"
          description="Connect a repository and Jira on the Sources tab (synthetic test data is available locally), then sync."
          action={
            <Link href={`/deals/${dealId}/sources`} className="text-sm font-bold text-indigo-ink hover:underline">
              Open Sources →
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Contributors" value={String(view.contributors)} hint="Code or Jira, last 12 months" icon={<Users />} accent="indigo" />
            <Stat label="Bus factor" value={String(view.busFactor)} hint="Fewest people behind half of all commits" icon={<GitBranch />} accent={view.busFactor <= 1 ? 'rose' : 'teal'} />
            <Stat
              label="Unmatched or departed"
              value={percentLabel(view.unmatchedOrDepartedShare)}
              hint="Share of commits by identities not on the current team"
              icon={<EyeOff />}
              accent="amber"
            />
            <Stat
              label="Issues resolved"
              value={String(view.months.reduce((total, entry) => total + entry.issuesResolved, 0))}
              hint="Jira, last 12 months"
              icon={<ListChecks />}
              accent="navy"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Code activity</CardTitle>
                <CardDescription>Commits and active committers per month.</CardDescription>
              </CardHeader>
              <CardContent>
                <LineChart
                  label="Commits and active committers per month"
                  categories={view.months.map((entry) => month(entry.month))}
                  series={[
                    { name: 'Commits', values: view.months.map((entry) => entry.commits), color: CHART_COLORS.indigo },
                    { name: 'Active committers', values: view.months.map((entry) => entry.codeContributors), color: CHART_COLORS.teal },
                  ]}
                  format="count"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Delivery</CardTitle>
                <CardDescription>
                  Jira issues and story points resolved per month. Latest reopen rate: {percentLabel([...view.months].reverse().find((entry) => entry.reopenRate)?.reopenRate ?? null)}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BarChart
                  label="Issues and story points resolved per month"
                  categories={view.months.map((entry) => month(entry.month))}
                  series={[
                    { name: 'Issues resolved', values: view.months.map((entry) => entry.issuesResolved), color: CHART_COLORS.navy },
                    { name: 'Points resolved', values: view.months.map((entry) => entry.pointsResolved), color: CHART_COLORS.amber },
                  ]}
                  format="count"
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Areas of the code</CardTitle>
              <CardDescription>Commits per top-level area and how many people each depends on (bus factor).</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                label="Commits and bus factor per area"
                categories={view.areas.map((area) => area.area)}
                series={[
                  { name: 'Commits', values: view.areas.map((area) => area.commits), color: CHART_COLORS.indigo },
                  {
                    name: 'Bus factor',
                    values: view.areas.map((area) => area.busFactor),
                    colors: view.areas.map((area) => (area.busFactor <= 1 ? CHART_COLORS.rose : CHART_COLORS.teal)),
                  },
                ]}
                format="count"
                height={240}
              />
            </CardContent>
          </Card>

          {view.suppressed ? (
            <Card>
              <CardContent className="p-5 text-sm text-slate-text">
                Fewer than 5 people contribute, so individual profiles are not shown — they would identify people. Team figures above still apply.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start gap-3">
                  <IconTile accent="teal">
                    <HeartHandshake />
                  </IconTile>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <CardTitle>Key people to keep</CardTitle>
                    <CardDescription>
                      People the business depends on — candidates for retention and reward after the merger.
                      {view.keyPersonFindings.length > 0 ? ' Retention escrows are priced on the key-person findings.' : ''}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {view.keepList.length === 0 ? (
                    <p className="text-muted-foreground">No single point of dependency stands out.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {view.keepList.map((entry) => (
                        <li key={entry.contributorKey} className="flex flex-wrap items-baseline gap-2">
                          <Link href={`/deals/${dealId}/engineering/contributors/${entry.contributorKey}`} className="font-bold text-indigo-ink hover:underline">
                            {displayName(entry)}
                          </Link>
                          <span className="text-slate-text">{entry.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {view.keyPersonFindings.length > 0 ? (
                    <div className="flex flex-wrap gap-2 border-t border-navy/5 pt-3">
                      {view.keyPersonFindings.map((finding) => (
                        <Link key={finding.id} href={`/deals/${dealId}/findings/${finding.id}`}>
                          <Badge variant="evidence">{finding.title}</Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center gap-3">
                  <CardTitle className="mr-auto">People</CardTitle>
                  <Badge variant={view.people.enabled ? 'reviewed' : 'neutral'}>{view.people.enabled ? 'Names shown' : 'Names hidden'}</Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[56rem] text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-slate-text">
                        <tr>
                          <th className="py-2 font-bold">Contributor</th>
                          <th className="py-2 font-bold">Profile</th>
                          <th className="py-2 text-right font-bold">Commits</th>
                          <th className="py-2 font-bold">Areas</th>
                          <th className="py-2 text-right font-bold">Resolved</th>
                          <th className="py-2 text-right font-bold">Created</th>
                          <th className="py-2 text-right font-bold">Comments</th>
                          <th className="py-2 font-bold">Last active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.profiles.map((profile) => (
                          <tr key={profile.contributorKey} className="border-t border-navy/5 align-top">
                            <td className="py-2">
                              <Link href={`/deals/${dealId}/engineering/contributors/${profile.contributorKey}`} className="font-semibold text-indigo-ink hover:underline">
                                {displayName(profile)}
                              </Link>
                              {profile.status === 'DEPARTED' ? <div className="text-xs text-muted-foreground">departed</div> : null}
                            </td>
                            <td className="max-w-md py-2">
                              <div className="flex flex-wrap gap-1">
                                {profile.tags.map((tag) => (
                                  <Badge key={tag} variant={TAG_LABELS[tag].variant} title={TAG_LABELS[tag].help}>
                                    {TAG_LABELS[tag].label}
                                  </Badge>
                                ))}
                              </div>
                              <div className="mt-1 text-xs text-slate-text">{profile.summary}</div>
                            </td>
                            <td className="py-2 text-right font-mono">{profile.commits}</td>
                            <td className="py-2 text-xs">{profile.areasActive.join(', ') || '—'}</td>
                            <td className="py-2 text-right font-mono">{profile.issuesResolved}</td>
                            <td className="py-2 text-right font-mono">{profile.issuesCreated}</td>
                            <td className="py-2 text-right font-mono">{profile.comments}</td>
                            <td className="py-2 font-mono text-xs">{profile.lastActiveMonth}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-2 rounded-2xl border border-navy/10 p-4 text-sm">
                    <span className="font-bold">Contributor names</span>
                    {view.people.decidedAt ? (
                      <p className="text-slate-text">
                        {view.people.enabled ? 'Shown' : 'Hidden'} by {view.people.decidedByName ?? 'the deal lead'} on {view.people.decidedAt.slice(0, 10)}: “{view.people.basis}”
                      </p>
                    ) : (
                      <p className="text-slate-text">Hidden. Profiles use pseudonyms until the deal lead records why names may be shown.</p>
                    )}
                    {view.canManageNames ? (
                      <form action={setPeopleAccess.bind(null, dealId)} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="enabled" value={view.people.enabled ? 'false' : 'true'} />
                        <input
                          name="basis"
                          required
                          minLength={10}
                          maxLength={1000}
                          placeholder={view.people.enabled ? 'Why names are no longer needed' : 'Basis, e.g. seller agreed in the data-room terms; employees notified'}
                          className={`${inputClass} max-w-xl`}
                        />
                        <Button type="submit" size="sm" variant={view.people.enabled ? 'outline' : 'default'}>
                          {view.people.enabled ? 'Hide names' : 'Show names'}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            Profiles describe activity in these tools only — reviews, design, mentoring and work elsewhere don’t appear. They are never sent to AI and are
            visible only to the buyer’s deal team. Sources: {view.sources.map((source) => `${source.displayName}${source.mode === 'FIXTURE' ? ' (synthetic)' : ''}`).join(', ')}.
          </p>
        </>
      )}
    </div>
  );
}
