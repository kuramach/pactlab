import type { ClaimView } from '@pactlab/contracts';
import type { Finding } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../_lib/api';
import { isUuidParam } from '../../_lib/filters';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { createClaim, updateClaim } from './actions';

export const dynamic = 'force-dynamic';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const OUTCOMES: Record<string, string> = {
  'ok-go': 'Screening said go: the pact is in Diligence, and each red flag is now a claim to verify below.',
  'ok-created': 'Claim added.',
  'ok-updated': 'Claim updated.',
  'invalid-statement': 'Write the claim in a few words (3 to 1,000 characters).',
  'invalid-RATIONALE_REQUIRED': 'Say what the evidence showed before marking a claim verified or contradicted.',
  'invalid-LINK_NOT_FOUND': 'A linked finding is not in this deal any more — reload and try again.',
  conflict: 'Someone else changed this claim in the meantime — reload and try again.',
  forbidden: 'Your role cannot change claims on this deal.',
};

const STATUS_LOOK = {
  UNVERIFIED: { label: 'Unverified', variant: 'draft' },
  VERIFIED: { label: 'Verified', variant: 'calculation' },
  CONTRADICTED: { label: 'Contradicted', variant: 'danger' },
} as const;

/** Diligence: what the seller says, tested against what the evidence shows. */
export default async function ClaimsPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const outcome = (await searchParams)['outcome'];
  const [claims, findings] = await Promise.all([
    apiGet<{ items: ClaimView[]; canEdit: boolean }>(`/v1/deals/${dealId}/claims`),
    apiGet<{ items: Finding[] }>(`/v1/deals/${dealId}/findings`),
  ]);
  if (claims.kind !== 'ok') return <ApiState result={claims} />;
  const linkable = findings.kind === 'ok' ? findings.data.items.filter((finding) => finding.status !== 'REJECTED') : [];
  const counts = Object.fromEntries((['UNVERIFIED', 'VERIFIED', 'CONTRADICTED'] as const).map((status) => [status, claims.data.items.filter((claim) => claim.status === status).length]));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Said vs observed</h2>
        <p className="text-sm text-muted-foreground">
          What the seller asserts — in the CIM, on management calls, in the data room — tested against the evidence. {counts['UNVERIFIED']} unverified · {counts['VERIFIED']} verified ·{' '}
          {counts['CONTRADICTED']} contradicted.
        </p>
      </div>
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      {claims.data.canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a claim</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createClaim.bind(null, dealId)} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <label className="flex flex-col gap-1 text-sm font-medium">
                What the seller says
                <input name="statement" required minLength={3} maxLength={1000} placeholder="e.g. Net revenue retention is above 120%" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Where it was said
                <input name="source" maxLength={300} placeholder="e.g. CIM p.12, management call 3 Oct" className={inputClass} />
              </label>
              <Button type="submit" size="sm">
                Add claim
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {claims.data.items.length === 0 ? (
        <EmptyState title="No claims yet" description="Add what the seller asserts; red flags from screening arrive here when the pact goes into diligence." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Claims">
          {claims.data.items.map((claim) => (
            <li key={claim.id}>
              <Card>
                <CardHeader className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_LOOK[claim.status].variant}>{STATUS_LOOK[claim.status].label}</Badge>
                    {claim.origin === 'SCREENING_RED_FLAG' ? <Badge>From screening</Badge> : null}
                    <CardTitle className="text-base">{claim.statement}</CardTitle>
                  </div>
                  <CardDescription>
                    {claim.source ?? 'Source not recorded'} · v{claim.version} by {claim.updatedByName ?? 'a team member'}
                    {claim.rationale ? ` · “${claim.rationale}”` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {claim.findings.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Findings:</span>
                      {claim.findings.map((finding) => (
                        <Link key={finding.id} href={`/deals/${dealId}/findings/${finding.id}`}>
                          <Badge variant="evidence">{finding.title}</Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {claims.data.canEdit ? (
                    <details>
                      <summary className="cursor-pointer font-semibold text-indigo-ink">Test against evidence</summary>
                      <form action={updateClaim.bind(null, dealId, claim.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input type="hidden" name="expectedVersion" value={claim.version} />
                        <label className="flex flex-col gap-1 font-medium">
                          Status
                          <select name="status" defaultValue={claim.status} className={inputClass}>
                            <option value="UNVERIFIED">Unverified</option>
                            <option value="VERIFIED">Verified by the evidence</option>
                            <option value="CONTRADICTED">Contradicted by the evidence</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 font-medium">
                          What the evidence shows
                          <input name="rationale" defaultValue={claim.rationale ?? ''} maxLength={2000} className={inputClass} />
                        </label>
                        {linkable.length > 0 ? (
                          <fieldset className="flex flex-col gap-1 sm:col-span-2">
                            <legend className="mb-1 font-medium">Findings it produced</legend>
                            {linkable.map((finding) => (
                              <label key={finding.id} className="flex items-center gap-2">
                                <input type="checkbox" name="findingIds" value={finding.id} defaultChecked={claim.findings.some((linked) => linked.id === finding.id)} />
                                {finding.title}
                              </label>
                            ))}
                          </fieldset>
                        ) : null}
                        <div>
                          <Button type="submit" size="sm">
                            Save
                          </Button>
                        </div>
                      </form>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
