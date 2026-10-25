import type { BugReportSummaryView } from '@pactlab/contracts';
import { Badge, Card, CardContent } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../(app)/deals/_lib/api';
import { ApiState } from '../(app)/deals/_lib/states';
import { decideOrganization, setMemberStatus, setOrganizationFlags, setOrganizationStatus } from './actions';

export const dynamic = 'force-dynamic';

const TABS = [
  ['approvals', 'Approvals'],
  ['organizations', 'Organizations'],
  ['users', 'Users'],
  ['health', 'Usage & health'],
  ['audit', 'Audit log'],
  ['bugs', 'Bug inbox'],
] as const;
type Tab = (typeof TABS)[number][0];

const OUTCOMES: Record<string, string> = {
  'ok-approve': 'Organization approved; its owners were emailed where a sender is configured.',
  'ok-reject': 'Organization rejected.',
  'ok-status': 'Organization status changed.',
  'ok-flags': 'Flags saved — they apply on the next request, no deploy needed.',
  'ok-member': 'Membership changed.',
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
                    <button name="decision" value="approve" className="rounded-md bg-indigo px-3 py-1 font-semibold text-navy">Approve</button>
                    <button name="decision" value="reject" className="rounded-md border border-border px-3 py-1">Reject</button>
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
                    <button className="self-start rounded border border-border px-2 py-0.5 text-xs">Save flags</button>
                  </form>
                </td>
                <td className={cell}>
                  {org.status !== 'PENDING_APPROVAL' ? (
                    <form action={setOrganizationStatus.bind(null, org.id)}>
                      <button name="status" value={org.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'} className="rounded border border-border px-2 py-1 text-xs">
                        {org.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </button>
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
        <button className="rounded-md border border-border px-3 py-1.5">Search</button>
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
                        <button name="status" value={user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'} className="rounded border border-border px-2 py-1 text-xs">
                          {user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                        </button>
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
  const [orgs, connections] = await Promise.all([apiGet<{ items: Org[] }>('/v1/admin/organizations'), apiGet<{ items: Connection[] }>('/v1/admin/connections')]);
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
        <button className="rounded-md border border-border px-3 py-1.5">Filter</button>
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
        <button className="rounded-md border border-border px-3 py-1.5">Filter</button>
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
