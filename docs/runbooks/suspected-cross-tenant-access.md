# Suspected cross-tenant access

Severity 1 until disproven.

1. **Contain.** If a specific user, token or integration is implicated, revoke
   it (Auth0 session/organization membership, connection credential
   reference). Do not delete data or audit rows.
2. **Preserve.** Note request ids and audit event ids. Run `verifyAuditChain`
   for affected organizations and keep the result.
3. **Scope.** Query audit events for the actor across organizations and for
   denials (`outcome = DENIED`) around the time. RLS denials appear as empty
   results or 404s at the API — compare with application logs by request id.
4. **Verify controls.** Re-run the RLS allow/deny integration tests
   (`pnpm test:integration`) against the deployed schema version. Confirm the
   runtime role is `NOBYPASSRLS` and RLS is enabled on every tenant table.
5. **Decide.** If exposure is confirmed, follow the incident policy for
   customer notification with the affected partners; record what data class
   was exposed (identifiers vs. content).
6. **Fix and prove.** Ship the fix with a regression test covering the
   allow and deny path that failed.
