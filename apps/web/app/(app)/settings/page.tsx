import { Badge, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from '@pactlab/ui';
import { ArrowRight, LogOut } from 'lucide-react';
import Link from 'next/link';
import { getSessionContext } from '../../../lib/session';
import { signOut } from '../../_actions/sign-out';

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

/** Your profile, the active organization and the administration pages you can open. */
export default async function SettingsPage() {
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

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Signing out ends this session. Design reference: <Link href="/design-system" className="text-indigo-ink underline">design system</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <button type="submit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <LogOut aria-hidden className="h-4 w-4" /> Sign out
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
