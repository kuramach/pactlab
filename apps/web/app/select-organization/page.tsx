import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@pactlab/ui';
import { redirect } from 'next/navigation';
import { organizationLoginPath, organizationStep, safeReturnTo } from '../../lib/auth-flow';
import { getMe } from '../../lib/session';
import { chooseOrganization } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

function SignOut() {
  return (
    <a href="/auth/logout" className="text-sm underline">
      Sign out
    </a>
  );
}

/**
 * After login the token may lack `org_id`. One membership re-authorizes
 * silently; several show a picker. Tokens used for API calls always carry it.
 */
export default async function SelectOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  const me = await getMe();
  if (me.kind !== 'ok') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-10">
        <EmptyState
          title={me.kind === 'signed-out' ? 'No Pactlab account' : 'Something went wrong'}
          description={
            me.kind === 'signed-out'
              ? 'You signed in, but no Pactlab account is linked to this identity.'
              : 'Your organizations could not be loaded. Try again shortly.'
          }
        />
        <SignOut />
      </main>
    );
  }

  const step = organizationStep(me.data.organizations);
  if (step.kind === 'single') {
    redirect(organizationLoginPath(step.organization.auth0OrganizationId, returnTo));
  }
  if (step.kind === 'none') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-10">
        <EmptyState
          title="No organization membership"
          description="Ask an organization administrator to invite you."
        />
        <SignOut />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose an organization</CardTitle>
          <CardDescription>Signed in as {me.data.user.displayName}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {step.organizations.map((organization) => (
            <form key={organization.id} action={chooseOrganization}>
              <input type="hidden" name="organizationId" value={organization.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" className="w-full justify-between">
                <span>{organization.name}</span>
                <span className="text-xs opacity-80">
                  {organization.role.replaceAll('_', ' ').toLowerCase()}
                </span>
              </Button>
            </form>
          ))}
          <SignOut />
        </CardContent>
      </Card>
    </main>
  );
}
