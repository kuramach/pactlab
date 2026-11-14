import type { BugReportSummaryView } from '@pactlab/contracts';
import { Badge, Card, CardContent, Button } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../(app)/deals/_lib/api';
import { ApiState } from '../(app)/deals/_lib/states';
import { DemoShareForm } from './demo-share';
import { endDemoShare, resetDemoSlot } from './demo-actions';
import { compPact, createPromoCode, deactivatePromoCode, decideOrganization, resyncBilling, setMemberStatus, setOrganizationFlags, setOrganizationStatus, setOrganizationMcp } from './actions';
import type { AdminBillingAccountView, PromoCodeView } from '@pactlab/contracts';
import { COMPANY_TYPES, COMPANY_TYPE_LABELS } from '@pactlab/domain';

export const dynamic = 'force-dynamic';

const TABS = [
  ['approvals', 'Approvals'],
  ['organizations', 'Organizations'],
  ['users', 'Users'],
  ['health', 'Usage & health'],
  ['audit', 'Audit log'],
  ['bugs', 'Bug inbox'],
  ['promo', 'Promo codes'],
  ['demos', 'Demos'],
] as const;
type Tab = (typeof TABS)[number][0];

const OUTCOMES: Record<string, string> = {
  'ok-approve': 'Organization approved; its owners were emailed where a sender is configured.',
  'ok-reject': 'Organization rejected.',
  'ok-status': 'Organization status changed.',
  'ok-flags': 'Flags saved — they apply on the next request, no deploy needed.',
  'ok-mcp': 'MCP switched. Apps already connected stop or start working on their next request.',
  'ok-member': 'Membership changed.',
  'ok-promo': 'Promo code created.',
  'ok-promo-off': 'Promo code deactivated; it can no longer be redeemed.',
  'promo-taken': 'That code text is already used. Pick another.',
  'ok-comp': 'One free pact added to that organization (audited).',
  'ok-resync': 'Billing re-read from Stripe.',
  'ok-demo-ended': 'Share ended: its links and sessions stopped working. The demo is rebuilt within 15 minutes, then free again.',
  'ok-demo-reset': 'Queued: the demo is rebuilt within 15 minutes.',
  conflict: 'That demo is shared right now; end the share first.',
  forbidden: 'That action is refused (operators cannot deactivate themselves).',
  invalid: 'That request was not valid.',
};

interface Pending { slug: string; name: string; ssoRequested: boolean; createdAt: string; owners: string }
interface Org { id: string; slug: string; name: string; status: string; owners: string; members: number; deals: { pre: number; diligence: number; post: number }; aiTokens: { input: number; output: number }; flags: { pilotMode: boolean; liveConnectors: boolean } }
interface User { userId: string; displayName: string; email: string | null; organizationId: string; organizationName: string; role: string; status: string; platformOperator: boolean }
interface Connection { organizationName: string; provider: string; displayName: string; connectionStatus: string; lastRunStatus: string | null; lastRunAt: string | null; lastError: string | null }
interface AuditRow { occurredAt: string; organizationName: string; actorName: string | null; action: string; targetType: string; targetId: string | null }

const cell = 'px-3 py-2 align-top';
const number = new Intl.NumberFormat('en-US');

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const tab = (TABS.find(([key]) => key === search['tab'])?.[0] ?? 'approvals') as Tab;
  const outcome = typeof search['outcome'] === 'string' ? OUTCOMES[search['outcome']] : undefined;
  const q = typeof search['q'] === 'string' ? search['q'].trim() : '';

  return (
    <>
      <nav aria-label="Console sections" className="flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/admin?tab=${key}`} aria-current={key === tab ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-sm ${key === tab ? 'border-indigo-ink bg-muted font-semibold' : 'border-border text-muted-foreground'}`}>
            {label}
          </Link>
        ))}
      </nav>
      {outcome ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{outcome}</p> : null}
      <p className="text-xs text-muted-foreground">Metadata only: counts, statuses and ids. Customer deal content is never shown here.</p>
      {tab === 'approvals' ? <Approvals /> : null}
      {tab === 'organizations' ? <Organizations /> : null}
      {tab === 'users' ? <Users q={q} /> : null}
      {tab === 'health' ? <Health /> : null}
      {tab === 'audit' ? <Audit action={typeof search['action'] === 'string' ? search['action'] : ''} /> : null}
      {tab === 'promo' ? <PromoCodes /> : null}
      {tab === 'demos' ? <Demos /> : null}
      {tab === 'bugs' ? <Bugs status={typeof search['status'] === 'string' ? search['status'] : ''} severity={typeof search['severity'] === 'string' ? search['severity'] : ''} /> : null}
    </>
  );
}

async function Approvals() {
  const result = await apiGet<{ items: Pending[] }>('/v1/admin/approvals');
  if (result.kind !== 'ok') return <ApiState result={result} />;
  if (result.data.items.length === 0) return <p className="text-sm">No organizations are waiting for approval.</p>;
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-left text-sm" aria-label="Pending sign-ups">
          <thead className="text-xs uppercase text-muted-foreground"><tr><th className={cell}>Organization</th><th className={cell}>Owner</th><th className={cell}>Signed up</th><th className={cell}>Decision</th></tr></thead>
          <tbody className="divide-y divide-border">
            {result.data.items.map((org) => (
              <tr key={org.slug}>
                <td className={cell}>
                  <span className="font-semibold">{org.name}</span> <span className="text-xs text-muted-foreground">{org.slug}</span>
                  {org.ssoRequested ? <Badge className="ml-2">SSO requested</Badge> : null}
                </td>
                <td className={cell}>{org.owners || '—'}</td>
                <td className={cell}>{org.createdAt.slice(0, 10)}</td>
                <td className={cell}>
                  <form action={decideOrganization.bind(null, org.slug)} className="flex gap-2">
                    <Button size="sm" type="submit" name="decision" value="approve">Approve</Button>
                    <Button variant="outline" size="sm" type="submit" name="decision" value="reject">Reject</Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

async function Organizations() {
  const result = await apiGet<{ items: Org[] }>('/v1/admin/organizations');
  if (result.kind !== 'ok') return <ApiState result={result} />;
  // MCP per organization (T-084), off until switched on here.
  const mcp = await apiGet<{ items: { organizationId: string; mcpEnabled: boolean }[] }>('/v1/admin/mcp');
  const mcpOn = new Set(mcp.kind === 'ok' ? mcp.data.items.filter((item) => item.mcpEnabled).map((item) => item.organizationId) : []);
  // Billing per organization (T-087), from the Stripe mirror.
  const billingRows = await apiGet<{ items: AdminBillingAccountView[] }>('/v1/admin/billing');
  const billingOf = new Map(billingRows.kind === 'ok' ? billingRows.data.items.map((row) => [row.organizationId, row]) : []);
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm" aria-label="Organizations">
          <thead className="text-xs uppercase text-muted-foreground"><tr><th className={cell}>Organization</th><th className={cell}>Status</th><th className={cell}>Members</th><th className={cell}>Deals (pre · diligence · post)</th><th className={cell}>AI tokens</th><th className={cell}>Flags</th><th className={cell}></th></tr></thead>
          <tbody className="divide-y divide-border">
            {result.data.items.map((org) => (
              <tr key={org.id}>
                <td className={cell}><span className="font-semibold">{org.name}</span><span className="block text-xs text-muted-foreground">{org.owners || 'no owner'}</span></td>
                <td className={cell}><Badge variant={org.status === 'ACTIVE' ? 'calculation' : org.status === 'SUSPENDED' ? 'danger' : 'draft'}>{org.status.toLowerCase()}</Badge></td>
                <td className={cell}>{org.members}</td>
                <td className={cell}>{org.deals.pre} · {org.deals.diligence} · {org.deals.post}</td>
                <td className={cell} data-numeric>{number.format(org.aiTokens.input + org.aiTokens.output)}</td>
                <td className={cell}>
                  <form action={setOrganizationFlags.bind(null, org.id)} className="flex flex-col gap-1" aria-label={`Flags for ${org.name}`}>
                    <label className="flex items-center gap-1"><input type="checkbox" name="pilotMode" defaultChecked={org.flags.pilotMode} /> Pilot mode</label>
                    <label className="flex items-center gap-1"><input type="checkbox" name="liveConnectors" defaultChecked={org.flags.liveConnectors} /> Live connectors</label>
                    <Button variant="outline" size="sm" className="self-start" type="submit">Save flags</Button>
                  </form>
                  <form action={setOrganizationMcp.bind(null, org.id, !mcpOn.has(org.id))} className="mt-2 flex items-center gap-2" aria-label={`MCP for ${org.name}`}>
                    <Badge variant={mcpOn.has(org.id) ? 'calculation' : 'draft'}>MCP {mcpOn.has(org.id) ? 'on' : 'off'}</Badge>
                    <Button variant="ghost" size="sm" type="submit">{mcpOn.has(org.id) ? 'Turn off' : 'Turn on'}</Button>
                  </form>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" aria-label={`Billing for ${org.name}`}>
                    <Badge variant={billingOf.get(org.id)?.status === 'ACTIVE' ? 'calculation' : billingOf.get(org.id)?.status === 'PAST_DUE' ? 'danger' : 'draft'}>
                      {billingOf.get(org.id)?.planKey ?? 'Per pact'} · {(billingOf.get(org.id)?.status ?? 'NONE').toLowerCase()}
                    </Badge>
                    <span className="text-muted-foreground">{billingOf.get(org.id)?.openCredits ?? 0} prepaid</span>
                    <form action={compPact.bind(null, org.id)}><Button variant="ghost" size="sm" type="submit">Comp a pact</Button></form>
                    {billingOf.get(org.id)?.status !== 'NONE' && billingOf.get(org.id) ? <form action={resyncBilling.bind(null, org.id)}><Button variant="ghost" size="sm" type="submit">Resync</Button></form> : null}
                  </div>
                </td>
                <td className={cell}>
                  {org.status !== 'PENDING_APPROVAL' ? (
                    <form action={setOrganizationStatus.bind(null, org.id)}>
                      <Button variant="outline" size="sm" type="submit" name="status" value={org.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}>
                        {org.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

async function Users({ q }: { q: string }) {
  const result = await apiGet<{ items: User[] }>(`/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex gap-2 text-sm">
        <input type="hidden" name="tab" value="users" />
        <input name="q" defaultValue={q} placeholder="Search by email or name" className="w-72 rounded-md border border-border px-3 py-1.5" />
        <Button variant="outline" size="sm" type="submit">Search</Button>
      </form>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-left text-sm" aria-label="Users">
              <thead className="text-xs uppercase text-muted-foreground"><tr><th className={cell}>Person</th><th className={cell}>Organization</th><th className={cell}>Role</th><th className={cell}>Status</th><th className={cell}></th></tr></thead>
              <tbody className="divide-y divide-border">
                {result.data.items.map((user) => (
                  <tr key={`${user.organizationId}-${user.userId}`}>
                    <td className={cell}>{user.displayName}{user.platformOperator ? <Badge className="ml-2">operator</Badge> : null}<span className="block text-xs text-muted-foreground">{user.email ?? 'SSO user'}</span></td>
                    <td className={cell}>{user.organizationName}</td>
                    <td className={cell}>{user.role.toLowerCase().replaceAll('_', ' ')}</td>
                    <td className={cell}>{user.status.toLowerCase()}</td>
                    <td className={cell}>
                      <form action={setMemberStatus.bind(null, user.organizationId, user.userId)}>
                        <Button variant="outline" size="sm" type="submit" name="status" value={user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}>
                          {user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Health() {
  const [orgs, connections, mail] = await Promise.all([
    apiGet<{ items: Org[] }>('/v1/admin/organizations'),
    apiGet<{ items: Connection[] }>('/v1/admin/connections'),
    apiGet<{ days: number; counts: Record<'DELIVERY' | 'BOUNCE' | 'COMPLAINT' | 'REJECT' | 'RENDERING_FAILURE', number>; suppressed: number }>('/v1/admin/email-health'),
  ]);
  if (orgs.kind !== 'ok') return <ApiState result={orgs} />;
  const tokens = orgs.data.items.reduce((sum, org) => ({ input: sum.input + org.aiTokens.input, output: sum.output + org.aiTokens.output }), { input: 0, output: 0 });
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-3" data-numeric>
        <div className="rounded-xl bg-mist p-3"><dt className="text-xs uppercase text-slate-text">Organizations</dt><dd className="text-xl font-bold">{orgs.data.items.length}</dd></div>
        <div className="rounded-xl bg-mist p-3"><dt className="text-xs uppercase text-slate-text">AI input tokens</dt><dd className="text-xl font-bold">{number.format(tokens.input)}</dd></div>
        <div className="rounded-xl bg-mist p-3"><dt className="text-xs uppercase text-slate-text">AI output tokens</dt><dd className="text-xl font-bold">{number.format(tokens.output)}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">Cost: tokens × the model’s Bedrock price for the region; the per-model rate card arrives with metering (T-007).</p>
      {/* Email health (T-109): SES events from this environment's configuration set; counts only, no addresses. */}
      {mail.kind === 'ok' ? (
        <p className="text-sm" aria-label="Email health" data-numeric>
          <span className="font-semibold">Email, last {mail.data.days} days:</span> {number.format(mail.data.counts.DELIVERY)} delivered · {number.format(mail.data.counts.BOUNCE)} bounced · {number.format(mail.data.counts.COMPLAINT)} complaints ·{' '}
          {number.format(mail.data.counts.REJECT + mail.data.counts.RENDERING_FAILURE)} rejected or failed · {number.format(mail.data.suppressed)} addresses on the do-not-send list
        </p>
      ) : null}
      {connections.kind !== 'ok' ? (
        <ApiState result={connections} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm" aria-label="Connector health">
              <thead className="text-xs uppercase text-muted-foreground"><tr><th className={cell}>Organization</th><th className={cell}>Connection</th><th className={cell}>Last sync</th><th className={cell}>Last error</th></tr></thead>
              <tbody className="divide-y divide-border">
                {connections.data.items.map((connection, index) => (
                  <tr key={index}>
                    <td className={cell}>{connection.organizationName}</td>
                    <td className={cell}>{connection.displayName} <span className="text-xs text-muted-foreground">{connection.provider} · {connection.connectionStatus.toLowerCase()}</span></td>
                    <td className={cell}>{connection.lastRunStatus ? `${connection.lastRunStatus.toLowerCase()} · ${connection.lastRunAt?.slice(0, 16).replace('T', ' ') ?? ''}` : 'never'}</td>
                    <td className={cell}>{connection.lastError ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Audit({ action }: { action: string }) {
  const result = await apiGet<{ items: AuditRow[] }>(`/v1/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex gap-2 text-sm">
        <input type="hidden" name="tab" value="audit" />
        <select name="action" defaultValue={action} className="rounded-md border border-border px-2 py-1.5">
          <option value="">All platform events</option>
          <option value="org.">Organizations</option>
          <option value="member.">Members</option>
          <option value="bug.">Bugs</option>
          <option value="operator.">Operators</option>
        </select>
        <Button variant="outline" size="sm" type="submit">Filter</Button>
      </form>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm" aria-label="Platform audit events">
          {result.data.items.map((event, index) => (
            <li key={index} className="flex flex-wrap gap-3 px-3 py-2">
              <span className="font-mono text-xs text-muted-foreground">{event.occurredAt.slice(0, 19).replace('T', ' ')}</span>
              <span className="font-semibold">{event.action}</span>
              <span>{event.organizationName}</span>
              <span className="text-muted-foreground">by {event.actorName ?? 'ops CLI / system'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Bugs({ status, severity }: { status: string; severity: string }) {
  const result = await apiGet<{ items: BugReportSummaryView[] }>('/v1/admin/bugs');
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const items = result.data.items.filter((bug) => (!status || bug.status === status) && (!severity || bug.severity === severity));
  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex gap-2 text-sm">
        <input type="hidden" name="tab" value="bugs" />
        <select name="status" defaultValue={status} className="rounded-md border border-border px-2 py-1.5">
          <option value="">Any status</option>
          {['NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'].map((value) => <option key={value} value={value}>{value.toLowerCase().replace('_', ' ')}</option>)}
        </select>
        <select name="severity" defaultValue={severity} className="rounded-md border border-border px-2 py-1.5">
          <option value="">Any severity</option>
          {['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}
        </select>
        <Button variant="outline" size="sm" type="submit">Filter</Button>
      </form>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-left text-sm" aria-label="Bug inbox">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className={cell}>Reference</th><th className={cell}>Title</th><th className={cell}>Severity</th><th className={cell}>Status</th><th className={cell}>Seen</th><th className={cell}>Organization</th></tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((bug) => (
                <tr key={bug.id}>
                  <td className={`${cell} font-mono text-xs`}><Link href={`/admin/bugs/${bug.id}`} className="text-indigo-ink underline">{bug.reference}</Link></td>
                  <td className={cell}>{bug.title}<span className="block text-xs text-muted-foreground">{bug.trigger.toLowerCase().replaceAll('_', ' ')}{bug.hasScreenshot ? ' · screenshot' : ''}</span></td>
                  <td className={cell}><Badge variant={bug.severity === 'BLOCKER' || bug.severity === 'HIGH' ? 'danger' : 'neutral'}>{bug.severity.toLowerCase()}</Badge></td>
                  <td className={cell}>{bug.status.toLowerCase().replace('_', ' ')}</td>
                  <td className={cell}>{bug.occurrences}× · {bug.lastSeenAt.slice(0, 10)}</td>
                  <td className={cell}>{bug.organizationName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

const field = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
const PLAN_OPTIONS = [['PACT', 'Pact'], ['TEAM_ANNUAL', 'Team (annual)'], ['TEAM_MONTHLY', 'Team (monthly)'], ['VENTURE_MONTHLY', 'Venture (monthly)'], ['VENTURE_ANNUAL', 'Venture (annual)'], ['VENTURE_ROUND', 'Venture round']] as const;

/** Promo codes (T-087): free pacts (optionally for some packs) or a discount mirrored to Stripe. */
async function PromoCodes() {
  const result = await apiGet<{ items: PromoCodeView[] }>('/v1/admin/promo-codes');
  if (result.kind !== 'ok') return <ApiState result={result} />;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-4">
          <form action={createPromoCode} className="grid gap-3 text-sm sm:grid-cols-2" aria-label="Create a promo code">
            <label className="flex flex-col gap-1 font-medium">Code<input name="code" required pattern="[A-Za-z0-9-]{4,40}" placeholder="MF-LAUNCH-2026" className={`${field} uppercase`} /></label>
            <label className="flex flex-col gap-1 font-medium">Description (internal)<input name="description" required maxLength={200} placeholder="Multifamily launch, Q4 webinar" className={field} /></label>
            <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
              <legend className="px-1 font-medium">Free pacts</legend>
              <label className="flex items-center gap-2"><input type="radio" name="kind" value="FREE_PACTS" defaultChecked /> Give free pacts</label>
              <label className="flex items-center gap-2">How many <input name="freePacts" type="number" min={1} max={100} defaultValue={1} className={`${field} w-20`} /></label>
              <span className="text-xs text-muted-foreground">Only for these packs (none ticked: any pack)</span>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {COMPANY_TYPES.filter((type) => type !== 'OTHER').map((type) => (
                  <label key={type} className="flex items-center gap-1"><input type="checkbox" name="packs" value={type} /> {COMPANY_TYPE_LABELS[type]}</label>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
              <legend className="px-1 font-medium">Discount</legend>
              <label className="flex items-center gap-2"><input type="radio" name="kind" value="DISCOUNT" /> Give a discount at checkout</label>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-1">% off <input name="percentOff" inputMode="decimal" className={`${field} w-20`} /></label>
                <label className="flex items-center gap-1">or USD off <input name="amountOff" inputMode="decimal" className={`${field} w-24`} /></label>
              </div>
              <label className="flex items-center gap-2">For
                <select name="duration" defaultValue="ONCE" className={field}><option value="ONCE">the first payment</option><option value="REPEATING">some months</option><option value="FOREVER">as long as they subscribe</option></select>
                <input name="durationMonths" type="number" min={1} max={36} placeholder="months" className={`${field} w-20`} />
              </label>
              <span className="text-xs text-muted-foreground">Only on these plans (none ticked: any plan)</span>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {PLAN_OPTIONS.map(([key, label]) => <label key={key} className="flex items-center gap-1"><input type="checkbox" name="planKeys" value={key} /> {label}</label>)}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1 font-medium">Valid from (optional)<input name="validFrom" type="date" className={field} /></label>
            <label className="flex flex-col gap-1 font-medium">Valid until (optional)<input name="validUntil" type="date" className={field} /></label>
            <label className="flex flex-col gap-1 font-medium">Most redemptions (optional)<input name="maxRedemptions" type="number" min={1} className={field} /></label>
            <label className="flex items-center gap-2 self-end"><input type="checkbox" name="skipsApproval" defaultChecked /> New sign-ups with this code skip approval</label>
            <div className="sm:col-span-2"><Button type="submit">Create promo code</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm" aria-label="Promo codes">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Gives</th><th className="px-3 py-2">Valid</th><th className="px-3 py-2">Used</th><th className="px-3 py-2">Sign-up</th><th className="px-3 py-2"></th></tr></thead>
            <tbody className="divide-y divide-border">
              {result.data.items.length === 0 ? <tr><td colSpan={6} className="px-3 py-4 text-muted-foreground">No promo codes yet.</td></tr> : null}
              {result.data.items.map((code) => (
                <tr key={code.id}>
                  <td className="px-3 py-2"><span className="font-mono font-semibold">{code.code}</span><span className="block text-xs text-muted-foreground">{code.description}</span></td>
                  <td className="px-3 py-2">{code.summary}{code.kind === 'DISCOUNT' && !code.stripeLinked ? <span className="block text-xs text-red-700">not linked to Stripe</span> : null}</td>
                  <td className="px-3 py-2 text-xs">{code.validFrom.slice(0, 10)} → {code.validUntil ? code.validUntil.slice(0, 10) : 'no end'}</td>
                  <td className="px-3 py-2">{code.redemptions}{code.maxRedemptions ? ` / ${code.maxRedemptions}` : ''}</td>
                  <td className="px-3 py-2 text-xs">{code.skipsApproval ? 'skips approval' : 'needs approval'}</td>
                  <td className="px-3 py-2">
                    {code.active ? (
                      <form action={deactivatePromoCode.bind(null, code.id)}><Button variant="ghost" size="sm" type="submit">Deactivate</Button></form>
                    ) : <Badge variant="draft">inactive</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}


interface DemoSlot {
  organizationId: string;
  slot: number;
  organizationName: string;
  status: 'AVAILABLE' | 'SHARED' | 'RESETTING';
  resetAt: string | null;
  lastError: string | null;
  share: { id: string; sharedWith: string; startsAt: string; endsAt: string; lastUsedAt: string | null } | null;
}
const STATUS_LABELS: Record<DemoSlot['status'], string> = { AVAILABLE: 'Available', SHARED: 'Shared', RESETTING: 'Resetting (within 15 min)' };
const when = (iso: string | null) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

/** Shared demos (T-113): five demo organizations lent out through magic links, rebuilt when a share ends. */
async function Demos() {
  const result = await apiGet<{ items: DemoSlot[] }>('/v1/admin/demos');
  if (result.kind !== 'ok') return <ApiState result={result} />;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="text-sm text-muted-foreground">
            Lend a full demo (synthetic pacts on every tab) for a set time. The visitor opens a link, with no sign-in. Outward actions are off: invitations, e-signature, billing and
            outside connections. When the time is up, or you end it, the demo is rebuilt from the original data and returns to the pool.
          </p>
          <DemoShareForm />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm" aria-label="Demo pool">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className={cell}>Demo</th>
                <th className={cell}>Status</th>
                <th className={cell}>Shared with</th>
                <th className={cell}>Ends</th>
                <th className={cell}>Last used</th>
                <th className={cell}>Last reset</th>
                <th className={cell} />
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((slot) => (
                <tr key={slot.organizationId} className="border-t border-border">
                  <td className={cell}>{slot.organizationName}</td>
                  <td className={cell}>
                    {STATUS_LABELS[slot.status]}
                    {slot.lastError ? <div className="text-xs text-rose">Last reset failed: {slot.lastError.slice(0, 200)}</div> : null}
                  </td>
                  <td className={cell}>{slot.share?.sharedWith ?? '—'}</td>
                  <td className={cell}>{when(slot.share?.endsAt ?? null)}</td>
                  <td className={cell}>{when(slot.share?.lastUsedAt ?? null)}</td>
                  <td className={cell}>{when(slot.resetAt)}</td>
                  <td className={cell}>
                    {slot.share ? (
                      <form action={endDemoShare.bind(null, slot.share.id)}>
                        <Button type="submit" size="sm" variant="outline">
                          End now
                        </Button>
                      </form>
                    ) : slot.status !== 'RESETTING' || slot.lastError ? (
                      <form action={resetDemoSlot.bind(null, slot.organizationId)}>
                        <Button type="submit" size="sm" variant="ghost">
                          Reset now
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
