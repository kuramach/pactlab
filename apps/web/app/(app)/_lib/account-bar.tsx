import type { SessionContext } from '../../../lib/session';
import { signOut } from '../../_actions/sign-out';

/**
 * Signed-in user and active organization, or a sign-in link. Sign-in is a
 * plain anchor (the chooser page); sign-out is a server action so email-code
 * sessions are revoked at the API.
 */
export function AccountBar({ session }: { session: SessionContext }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-end gap-3 text-sm">
      {session.kind === 'signed-out' ? (
        <a href="/login" className="rounded-md border border-border px-3 py-1 hover:bg-muted">
          Sign in
        </a>
      ) : (
        <>
          <span className="font-medium">{session.displayName}</span>
          {session.organization ? (
            <a href="/select-organization" className="text-muted-foreground hover:underline">
              {session.organization.name}
            </a>
          ) : (
            <span className="text-muted-foreground">No active organization</span>
          )}
          <form action={signOut}>
            <button type="submit" className="rounded-md border border-border px-3 py-1 hover:bg-muted">
              Sign out
            </button>
          </form>
        </>
      )}
    </div>
  );
}
