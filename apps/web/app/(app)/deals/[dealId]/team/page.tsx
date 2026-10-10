import { DEAL_ROLES } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import { dealsApi } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { can, dealViewer } from '../../_lib/viewer';
import { addMember } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const ROLE_TEXT: Record<(typeof DEAL_ROLES)[number], { label: string; detail: string }> = {
  DEAL_LEAD: { label: 'Deal lead', detail: 'Runs the deal: connects sources, decides findings, approves valuations, manages the team.' },
  ANALYST: { label: 'Analyst', detail: 'Connects sources, drafts and prices findings, builds and runs scenarios.' },
  REVIEWER: { label: 'Reviewer', detail: 'Decides findings and approves valuation submissions made by others.' },
  ADVISER: { label: 'Adviser', detail: 'Reads the deal and its evidence. Cannot change anything.' },
  VIEWER: { label: 'Viewer', detail: 'Reads the deal and its analysis. Cannot change anything.' },
  TARGET_CONTRIBUTOR: { label: 'Target contributor', detail: 'From the seller: supplies data and sees only what is shared with them.' },
};

/** Who works on this deal, with which role — and adding colleagues. */
export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { dealId } = await params;
  const { outcome } = await searchParams;
  const [viewer, organization] = await Promise.all([dealViewer(dealId), dealsApi.organizationMembers()]);
  const manager = can.manageMembers(viewer.role);
  const candidates = organization.kind === 'ok' ? organization.data.items : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Team</h2>
        <p className="text-sm text-muted-foreground">Everyone on this deal and what their role lets them do.</p>
      </div>
      <OutcomeBanner outcome={outcome} messages={{ 'ok-added': 'Team updated.' }} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {viewer.members.map((member) => {
              const role = ROLE_TEXT[member.role as keyof typeof ROLE_TEXT];
              return (
                <div key={member.id} className="flex items-start justify-between gap-3 px-5 py-4 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {member.displayName}
                      {member.userId === viewer.userId ? <span className="text-muted-foreground"> (you)</span> : null}
                    </span>
                    <span className="text-muted-foreground">{role?.detail}</span>
                  </div>
                  <span className="flex flex-col items-end gap-1">
                    <Badge variant={member.role === 'DEAL_LEAD' ? 'reviewed' : 'neutral'}>{role?.label ?? member.role}</Badge>
                    {member.status !== 'ACTIVE' ? <Badge variant="danger">{member.status.toLowerCase()}</Badge> : null}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a colleague</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {manager ? (
              <form action={addMember.bind(null, dealId)} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 font-medium">
                  Person
                  <select name="userId" required className="rounded-md border border-border bg-background px-3 py-2">
                    {candidates.map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-medium">
                  Role
                  <select name="role" defaultValue="ANALYST" className="rounded-md border border-border bg-background px-3 py-2">
                    {DEAL_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_TEXT[role].label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">Choosing someone already on the deal changes their role.</p>
                <div>
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-muted-foreground">Only the deal lead can change the team.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
