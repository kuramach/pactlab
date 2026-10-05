import type { SessionContext } from '../../../lib/session';

/**
 * Signed-in user and active organization, or a sign-in link. Auth routes are
 * plain anchors: they are served by the proxy, not client-side navigation.
 */
export function AccountBar({ session }: { session: SessionContext }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-end gap-3 text-sm">
      {session.kind === 'signed-out' ? (
        <a href="/auth/login" className="rounded-md border border-border px-3 py-1 hover:bg-muted">
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
          <a
            href="/auth/logout"
            className="rounded-md border border-border px-3 py-1 hover:bg-muted"
          >
            Sign out
          </a>
        </>
      )}
    </div>
  );
}
