import { DEAL_ROLES } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet, dealsApi } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { can, dealViewer } from '../../_lib/viewer';
import { addMember, inviteByEmail, revokeInvitation } from './actions';

interface InvitationView {
  id: string;
  email: string;
  side: 'BUYER' | 'SELLER' | 'ADVISOR';
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  invitedByName: string | null;
  expiresAt: string;
}

const SIDE_OF_ROLE: Partial<Record<string, string>> = { TARGET_CONTRIBUTOR: 'Seller side', ADVISER: 'Advisor' };

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
  const [viewer, organization, invitations] = await Promise.all([
    dealViewer(dealId),
    dealsApi.organizationMembers(),
    apiGet<{ items: InvitationView[] }>(`/v1/deals/${dealId}/invitations`),
  ]);
  const manager = can.manageMembers(viewer.role);
  const candidates = organization.kind === 'ok' ? organization.data.items : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Team</h2>
        <p className="text-sm text-muted-foreground">Everyone on this deal and what their role lets them do.</p>
      </div>
      <OutcomeBanner
        outcome={outcome}
        messages={{
          'ok-added': 'Team updated.',
          'ok-invited': 'Invitation sent. They join this pact only — never your organization — once they accept.',
          'ok-revoked': 'Invitation withdrawn; its link no longer works.',
          'already-invited': 'That address already has a pending invitation to this pact.',
          'invalid-invite': 'Enter an email address and choose a side and role.',
          'error-COLLEAGUE_IS_BUYER_SIDE': 'That person is in your organization: add them on the buying side.',
        }}
      />
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
                    {SIDE_OF_ROLE[member.role] ? <Badge variant="evidence">{SIDE_OF_ROLE[member.role]}</Badge> : null}
                    {member.status !== 'ACTIVE' ? <Badge variant="danger">{member.status.toLowerCase()}</Badge> : null}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
        {manager ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite by email</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <form action={inviteByEmail.bind(null, dealId)} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 font-medium">
                  Email
                  <input name="email" type="email" required className="rounded-md border border-border bg-background px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 font-medium">
                  Side and role
                  <select name="sideRole" defaultValue="SELLER:TARGET_CONTRIBUTOR" className="rounded-md border border-border bg-background px-3 py-2">
                    <optgroup label="Seller side">
                      <option value="SELLER:TARGET_CONTRIBUTOR">Seller contributor — shares data, sees only what is shared</option>
                    </optgroup>
                    <optgroup label="Advisor">
                      <option value="ADVISOR:ADVISER">Advisor — reads the evidence</option>
                      <option value="ADVISOR:VIEWER">Advisor — reads the analysis</option>
                    </optgroup>
                    <optgroup label="Buying side">
                      <option value="BUYER:ANALYST">Analyst</option>
                      <option value="BUYER:REVIEWER">Reviewer</option>
                      <option value="BUYER:VIEWER">Viewer</option>
                    </optgroup>
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">
                  Colleagues in your organization join at once. Anyone else gets an email link, valid 14 days; they sign in with their own company and join this pact only. Seller-side people never see buyer-only findings, valuation or terms.
                </p>
                <div>
                  <Button type="submit" size="sm">
                    Send invitation
                  </Button>
                </div>
              </form>
              {invitations.kind === 'ok' && invitations.data.items.length > 0 ? (
                <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border" aria-label="Invitations">
                  {invitations.data.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {item.email} <span className="text-muted-foreground">· {item.side === 'SELLER' ? 'Seller side' : item.side === 'ADVISOR' ? 'Advisor' : 'Buying side'}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant={item.status === 'ACCEPTED' ? 'reviewed' : item.status === 'PENDING' ? 'draft' : 'neutral'}>{item.status.toLowerCase()}</Badge>
                        {item.status === 'PENDING' ? (
                          <form action={revokeInvitation.bind(null, dealId, item.id)}>
                            <button type="submit" className="text-xs underline">
                              Withdraw
                            </button>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
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
    </div>
  );
}
