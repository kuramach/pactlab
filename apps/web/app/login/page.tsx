import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { redirect } from 'next/navigation';
import { loginPath, safeReturnTo } from '../../lib/auth-flow';
import { auth0 } from '../../lib/auth0';
import { getSessionContext } from '../../lib/session';
import { requestCode, submitCode } from './actions';

// Per-request: reads cookies and query state.
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  code: 'That code did not work. Check it, or request a new one.',
  expired: 'Your sign-in attempt expired. Request a new code.',
  unavailable: 'Sign-in by email is unavailable right now. Try again shortly.',
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Sign-in chooser. Organizations on Auth0 (including company SSO) continue
 * to Auth0; organizations that chose email sign-in get a one-time code.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; step?: string; error?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if ((await getSessionContext()).kind === 'signed-in') redirect(returnTo);
  const error = params.error ? ERRORS[params.error] : undefined;
  const codeStep = params.step === 'code';
  const auth0Enabled = auth0() !== null;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Pactlab</CardTitle>
          <CardDescription>Use the sign-in method your organization chose.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error ? (
            <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          {codeStep ? (
            <form action={submitCode} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                If that address can sign in with a code, we have emailed one. It expires in 10 minutes.
              </p>
              <label className="flex flex-col gap-1 text-sm font-medium">
                6-digit code
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  className={`${inputClass} tracking-[0.4em]`}
                />
              </label>
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit">Sign in</Button>
              <a href={`/login?${new URLSearchParams({ returnTo })}`} className="text-center text-sm underline">
                Use a different address or request a new code
              </a>
            </form>
          ) : (
            <>
              {auth0Enabled ? (
                <>
                  <a
                    href={loginPath(returnTo)}
                    className="rounded-md border border-border px-4 py-2 text-center text-sm font-medium hover:bg-muted"
                  >
                    Continue with Auth0 or company SSO
                  </a>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    or
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              ) : null}
              <form action={requestCode} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Work email
                  <input name="email" type="email" autoComplete="email" required className={inputClass} />
                </label>
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button type="submit">Email me a sign-in code</Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
