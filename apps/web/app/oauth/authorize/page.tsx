import type { AuthorizeCheckView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AuthFrame } from '../../_components/auth-frame';
import { authApi, nativeSessionToken } from '../../../lib/native-session';
import { getSessionContext } from '../../../lib/session';
import { decide } from './actions';

export const dynamic = 'force-dynamic';

const OAUTH_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state'] as const;

/**
 * Connect an AI app to Pactlab (T-084): the OAuth consent page for MCP clients such as
 * Claude. Shows who is asking, for which organization, and what it may read; nothing is
 * granted until the person approves.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = Object.fromEntries(OAUTH_PARAMS.flatMap((key) => (typeof query[key] === 'string' ? [[key, query[key] as string]] : []))) as Record<string, string>;
  const here = `/oauth/authorize?${new URLSearchParams(params)}`;
  const token = await nativeSessionToken();
  const session = await getSessionContext();
  if (session.kind !== 'signed-in') redirect(`/login?${new URLSearchParams({ returnTo: here })}`);

  let view: AuthorizeCheckView;
  if (!token) {
    view = { kind: 'error', message: 'Connecting apps is available for organizations that sign in with Pactlab (email code or passkey).' };
  } else {
    const checked = await authApi('/v1/oauth/authorize/check', { params }, token);
    view = checked.status === 200 ? (checked.data as AuthorizeCheckView) : { kind: 'error', message: 'This request could not be checked. Try connecting again from your app.' };
  }
  if (view.kind === 'redirect') redirect(view.redirectTo);
  if (view.kind === 'choose-organization') redirect(`/select-organization?${new URLSearchParams({ returnTo: here })}`);

  return (
    <AuthFrame>
      <Card className="w-full shadow-xl shadow-navy/10">
        {view.kind === 'error' ? (
          <>
            <CardHeader>
              <CardTitle>Can’t connect this app</CardTitle>
              <CardDescription>{view.message}</CardDescription>
            </CardHeader>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-indigo-ink" aria-hidden /> Connect {view.client.name} to Pactlab?
              </CardTitle>
              <CardDescription>
                {view.client.name} ({view.client.host}){view.client.verified ? null : ', a self-registered app,'} wants to use Pactlab for{' '}
                <strong>{session.organization?.name ?? 'your organization'}</strong> as {session.displayName}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 text-sm">
              {query['failed'] ? (
                <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2">
                  That didn’t go through. Start again from your app.
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
                  It sees only the pacts you can see, with your role’s limits. It can’t change anything; every request is in your organization’s audit log. Disconnect it any
                  time in Settings → Connected apps.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">After you approve, you go back to {view.redirectHost}.</p>
              <div className="flex flex-wrap gap-2">
                <form action={decide.bind(null, params, true)}>
                  <Button type="submit">Approve</Button>
                </form>
                <form action={decide.bind(null, params, false)}>
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
