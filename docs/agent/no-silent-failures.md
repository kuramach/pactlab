# No silent failures (T-125)

Work a person starts that finishes after their request returns (background jobs, emails, fetches) must end where they can see it:

- **Done:** with what changed.
- **Failed:** in plain words: what went wrong, that nothing was lost (when true), and the next step (try again, an alternative, or who to ask). Never a raw error, a code alone, or nothing.
- **Still running:** the shared `Pending` component (`apps/web/app/_components/pending.tsx`) refreshes the page while the work runs, and after a bound stops and says it is taking longer than usual, with what to do.

## In the code
- Every `.catch(` in `apps/api` and `apps/worker` carries a note just above it, enforced by `apps/api/src/no-silent-failures.test.ts`:
  - `// handled: <where the person sees the failure>` (stored status, page message, rethrown error);
  - `// silent-ok: <why nobody needs to know>` (cleanup nobody waits for; a reply that must not differ by account).
- Prefer recording the outcome on the record the person looks at (an invitation's `email_status`, a report version's `FAILED`), over a log line.
- The server log keeps the technical detail; the page gets the sentence.
