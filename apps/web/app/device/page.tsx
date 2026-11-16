import type { DeviceCheckView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { CheckCircle2, TerminalSquare } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AuthFrame } from '../_components/auth-frame';
import { authApi, nativeSessionToken } from '../../lib/native-session';
import { getSessionContext } from '../../lib/session';
import { decideDevice } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Sign in a script (T-128, RFC 8628 device authorization): the script shows a code and this
 * address; the person, signed in here, checks the code and approves. The script then gets an
 * API token of its own, for this person and organization, revocable in Settings.
 */
export default async function DevicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const code = typeof query['code'] === 'string' ? query['code'].slice(0, 32) : '';
  const done = query['done'];
  const here = code ? `/device?${new URLSearchParams({ code })}` : '/device';
  const session = await getSessionContext();
  if (session.kind !== 'signed-in') redirect(`/login?${new URLSearchParams({ returnTo: here })}`);

  if (done === 'approved' || done === 'declined') {
    return (
      <AuthFrame>
        <Card className="w-full shadow-xl shadow-navy/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-indigo-ink" aria-hidden /> {done === 'approved' ? 'Script signed in' : 'Sign-in declined'}
            </CardTitle>
            <CardDescription>
              {done === 'approved'
                ? 'You can close this page and go back to your script: it picks up its access in a few seconds. Remove it any time in Settings → Connected apps.'
                : 'The script gets no access. You can close this page.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </AuthFrame>
    );
  }

  if (!code) {
    return (
      <AuthFrame>
        <Card className="w-full shadow-xl shadow-navy/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TerminalSquare className="h-5 w-5 text-indigo-ink" aria-hidden /> Sign in a script
            </CardTitle>
            <CardDescription>Enter the code your script or terminal is showing. Only do this for a script you started yourself.</CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
              <label className="flex flex-col gap-1 font-medium">
                Code
                <input name="code" required maxLength={16} autoComplete="off" autoCapitalize="characters" placeholder="BCDF-GHJK" className="rounded-md border border-border bg-background px-3 py-2 font-mono uppercase tracking-widest" />
              </label>
              <Button type="submit">Continue</Button>
            </form>
          </CardContent>
        </Card>
      </AuthFrame>
    );
  }

  const token = await nativeSessionToken();
  let view: DeviceCheckView;
  if (!token) {
    view = { kind: 'error', message: 'Signing in scripts is available for organizations that sign in with Pactlab (email code or passkey).' };
  } else {
    const checked = await authApi('/v1/oauth/device/check', { userCode: code }, token);
    view = checked.status === 200 ? (checked.data as DeviceCheckView) : { kind: 'error', message: 'This code could not be checked. Start the sign-in again from your script.' };
  }
  if (view.kind === 'choose-organization') redirect(`/select-organization?${new URLSearchParams({ returnTo: here })}`);

  return (
    <AuthFrame>
      <Card className="w-full shadow-xl shadow-navy/10">
        {view.kind === 'error' ? (
          <CardHeader>
            <CardTitle>Can’t sign in this script</CardTitle>
            <CardDescription>{view.message}</CardDescription>
            <a href="/device" className="text-sm font-medium text-indigo-ink underline">
              Enter another code
            </a>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TerminalSquare className="h-5 w-5 text-indigo-ink" aria-hidden /> Let {view.client.name} use the Pactlab API?
              </CardTitle>
              <CardDescription>
                {view.client.verified ? view.client.name : `A script calling itself “${view.client.name}”`} wants to use Pactlab for{' '}
                <strong>{session.organization?.name ?? 'your organization'}</strong> as {session.displayName}. Check the code matches what your script shows:{' '}
                <code className="font-mono text-base font-semibold tracking-widest text-foreground">{view.userCode}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 text-sm">
              {query['failed'] ? (
                <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2">
                  That didn’t go through. Start the sign-in again from your script.
                </p>
              ) : null}
              <div className="flex flex-col gap-2">
                <p className="font-semibold">It will be able to:</p>
                <ul className="flex flex-col gap-2">
                  {view.scopes.map((entry) => (
                    <li key={entry.scope} className="flex gap-2">
                      <Badge variant="neutral" className="shrink-0 font-mono">
                        {entry.scope}
                      </Badge>
                      <span>{entry.description}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  It sees only the pacts you can see, with your role’s limits, and acts as you: every change is in your organization’s audit log under your name. Remove it any
                  time in Settings → Connected apps.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={decideDevice.bind(null, view.userCode, true)}>
                  <Button type="submit">Approve</Button>
                </form>
                <form action={decideDevice.bind(null, view.userCode, false)}>
                  <Button type="submit" variant="outline">
                    Deny
                  </Button>
                </form>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </AuthFrame>
  );
}
