import { Badge, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Button } from '@pactlab/ui';
import type { MyBugReportView } from '@pactlab/contracts';
import { ArrowRight, Bug, LogOut } from 'lucide-react';
import Link from 'next/link';
import { getSessionContext } from '../../../lib/session';
import { signOut } from '../../_actions/sign-out';
import { apiGet } from '../deals/_lib/api';
import { currentRelease, releaseLabel } from '../../../lib/release';
import { isOpen, STATUS_LABELS, statusBadge } from './bug-reports/_lib/status';
import { setDefaultPersona } from './persona-actions';
import { connectDocuSign, disconnectDocuSign } from './docusign-actions';
import { DevicesCard } from './devices-card';
import { IcCard } from './ic-card';
import { PasskeysCard } from './passkeys-card';
import { guideHidden, hideGuide, showGuide } from '../_lib/guide-actions';
import { BillingCard } from './billing-card';
import { ConnectedAppsCard } from './connected-apps-card';
import { oauthOrigins } from '../../../lib/oauth-metadata';
import type { PersonaOption } from '../valuation/_lib/pricing';
import { PersonaCard } from '../valuation/_lib/persona-card';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = { ORG_OWNER: 'Owner', ORG_ADMIN: 'Administrator', MEMBER: 'Member' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * The organization's deal-making style (T-105): the buyer persona new pacts
 * price under. Owners and admins change it; everyone sees it. Buyer-confidential.
 */
async function DealStyleCard() {
  const result = await apiGet<{ defaultPersona: string | null; effective: string; canEdit: boolean; options: PersonaOption[] }>('/v1/organization/persona');
  if (result.kind !== 'ok') return null;
  const { effective, canEdit, options, defaultPersona } = result.data;
  return (
    <Card id="deal-style">
      <CardHeader>
        <CardTitle>Deal-making style</CardTitle>
        <CardDescription>
          How your organization prices what diligence finds. New pacts start with this persona; each pact can change it, and any pact can be re-evaluated through another. Never shown to sellers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={setDefaultPersona} className="flex flex-col gap-3">
          <fieldset className="grid gap-3 md:grid-cols-3" disabled={!canEdit}>
            <legend className="sr-only">Deal-making style</legend>
            {options.map((option) => (
              <label key={option.persona} className="cursor-pointer">
                <PersonaCard
                  option={option}
                  selected={option.persona === effective}
                  control={<input type="radio" name="persona" value={option.persona} defaultChecked={option.persona === (defaultPersona ?? effective)} className="mt-1 h-4 w-4 accent-navy" aria-label={option.label} />}
                />
              </label>
            ))}
          </fieldset>
          {canEdit ? (
            <div>
              <Button type="submit" size="sm">
                Save style
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Organization owners and administrators can change this.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * E-signature (T-107): the organization connects its own DocuSign account, and
 * agreed terms are sent for signature from it. Hidden where this deployment has
 * no DocuSign app registration; the pacts then sign off in Pactlab.
 */
async function DocuSignCard() {
  const result = await apiGet<{ available: boolean; connected: { accountName: string; connectedAt: string } | null; canEdit: boolean }>('/v1/organization/docusign');
  if (result.kind !== 'ok' || !result.data.available) return null;
  const { connected, canEdit } = result.data;
  return (
    <Card id="docusign">
      <CardHeader>
        <CardTitle>E-signature (DocuSign)</CardTitle>
        <CardDescription>Agreed terms are sent for signature from your organization’s own DocuSign account. Pactlab never sends from an account of its own.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3 text-sm">
        {connected ? (
          <>
            <Badge variant="reviewed">Connected · {connected.accountName}</Badge>
            <span className="text-muted-foreground">since {connected.connectedAt.slice(0, 10)}</span>
            {canEdit ? (
              <form action={disconnectDocuSign}>
                <Button type="submit" size="sm" variant="outline">
                  Disconnect
                </Button>
              </form>
            ) : null}
          </>
        ) : canEdit ? (
          <form action={connectDocuSign}>
            <Button type="submit" size="sm">
              Connect DocuSign
            </Button>
          </form>
        ) : (
          <span className="text-muted-foreground">Not connected. An organization owner or administrator connects it.</span>
        )}
      </CardContent>
    </Card>
  );
}

/** Bugs submitted, near the top: open and closed counts and the latest three. */
async function BugsSubmittedCard() {
  const result = await apiGet<{ items: MyBugReportView[] }>('/v1/bug-reports/mine');
  const items = result.kind === 'ok' ? result.data.items : [];
  const open = items.filter((bug) => isOpen(bug.status)).length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Bug aria-hidden className="h-4 w-4" /> Bugs submitted
          </CardTitle>
          <CardDescription>
            {items.length === 0 ? 'Nothing reported yet. Use the bug button at the bottom right of any page.' : `${open} open · ${items.length - open} closed. Open one to see where it stands and our reply.`}
          </CardDescription>
        </div>
        <Link href="/settings/bug-reports" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          See all <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </CardHeader>
      {items.length > 0 ? (
        <CardContent>
          <ul className="divide-y divide-border text-sm" aria-label="Latest bugs submitted">
            {items.slice(0, 3).map((bug) => (
              <li key={bug.id}>
                <Link href={`/settings/bug-reports/${bug.id}`} className="flex flex-wrap items-center gap-2 py-2 hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{bug.reference}</span>
                  <span className="font-medium">{bug.title}</span>
                  <Badge variant={statusBadge(bug.status)}>{STATUS_LABELS[bug.status] ?? bug.status}</Badge>
                  {bug.hasReply ? <span className="text-xs font-semibold text-indigo-ink">Replied</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}

/** Which release of Pactlab this is (T-100): the version tag and the build. */
async function AboutCard() {
  const release = await currentRelease();
  return (
    <Card>
      <CardHeader>
        <CardTitle>About Pactlab</CardTitle>
        <CardDescription>
          Version: <span className="font-mono">{releaseLabel(release)}</span>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Your profile, the active organization and the administration pages you can open. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const billingOutcome = (await searchParams)['billing'];
  const session = await getSessionContext();
  const crumbs = [{ href: '/', label: 'Home' }, { label: 'Settings' }];
  if (session.kind !== 'signed-in') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader breadcrumbs={crumbs} title="Settings" />
        <EmptyState title="Sign in required" description="Sign in to manage your settings." />
      </div>
    );
  }
  const organization = session.organization;
  const admin = session.permissions.has('ORG_ADMIN');
  const audit = session.permissions.has('AUDIT_READ');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader breadcrumbs={crumbs} title="Settings" description="Your profile, your organization and its controls." />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear on reviews, approvals and the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Row label="Name">{session.displayName}</Row>
            <Row label="Role">{organization ? (ROLE_LABELS[organization.role] ?? organization.role) : '—'}</Row>
          </dl>
        </CardContent>
      </Card>

      <GuideCard hidden={await guideHidden()} />

      {organization?.authMethod === 'EMAIL_CODE' ? <PasskeysCard /> : null}

      {organization?.authMethod === 'EMAIL_CODE' ? <DevicesCard /> : null}

      {organization?.authMethod === 'EMAIL_CODE' ? <ConnectedAppsCard mcpAddress={oauthOrigins().resource} /> : null}

      {organization ? <BillingCard outcome={typeof billingOutcome === 'string' ? billingOutcome : undefined} /> : null}

      <BugsSubmittedCard />

      {organization ? <DealStyleCard /> : null}

      {organization && !session.guest ? <IcCard /> : null}

      {organization ? <DocuSignCard /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>Deals, evidence and audit trails are kept separate for every organization.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {organization ? (
            <dl className="divide-y divide-border">
              <Row label="Name">{organization.name}</Row>
              <Row label="Workspace ID">
                <span className="font-mono text-xs">{organization.slug}</span>
              </Row>
              <Row label="Sign-in method">
                {organization.authMethod === 'AUTH0' ? (
                  <Badge variant="calculation">Company SSO</Badge>
                ) : (
                  <Badge>Emailed one-time code</Badge>
                )}
              </Row>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No active organization.</p>
          )}
          <div>
            <Link href="/select-organization" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Switch organization
            </Link>
          </div>
        </CardContent>
      </Card>

      {admin || audit ? (
        <Card>
          <CardHeader>
            <CardTitle>Administration</CardTitle>
            <CardDescription>Available to organization owners and administrators.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {[
              ...(audit ? [{ href: '/audit', title: 'Audit log', body: 'Every sensitive read, change, approval and denial.' }] : []),
              ...(admin
                ? [{ href: '/settings/controls', title: 'Pilot controls', body: 'Controls, audit export and rollback paths for the pilot.' }]
                : []),
            ].map((item) => (
              <Link key={item.href} href={item.href} className="group flex items-center justify-between gap-3 px-6 py-4 hover:bg-muted">
                <span className="flex flex-col">
                  <span className="text-sm font-medium group-hover:text-indigo-ink">{item.title}</span>
                  <span className="text-sm text-muted-foreground">{item.body}</span>
                </span>
                <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <AboutCard />

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Signing out ends this session. Design reference: <Link href="/design-system" className="text-indigo-ink underline">design system</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              <LogOut aria-hidden className="h-4 w-4" /> Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** The guided tour and "Why this matters" callouts on each pact (2026-11-13): on unless hidden here. */
function GuideCard({ hidden }: { hidden: boolean }) {
  return (
    <Card id="guide">
      <CardHeader>
        <CardTitle>Guided tour</CardTitle>
        <CardDescription>
          A short note at the top of each pact tab on what it shows and why it matters, and a step-by-step tour through a pact. Handy for demos and for new team members.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3 text-sm">
        <span>{hidden ? 'Hidden on this browser.' : 'Shown.'}</span>
        <form action={hidden ? showGuide : hideGuide}>
          <Button type="submit" size="sm" variant="outline">
            {hidden ? 'Show the guide' : 'Hide the guide'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
