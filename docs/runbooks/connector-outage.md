# Connector outage

Applies to Stripe, GitHub, CSV and VDR adapters.

1. Identify the connection and deal from the failing sync run; note the
   request id. Do not copy provider payloads into the ticket.
2. Run `validateConnection` for the connection (API:
   `POST /v1/deals/:dealId/connections/:connectionId/validate`). It reports
   reachability, credentials, scopes and mappings with safe detail strings.
3. Classify:
   - **reachability FAIL:** provider outage or network — pause syncs, check the
     provider status page, retry later. Jobs are idempotent; replay creates no
     duplicates.
   - **credentials FAIL:** credential revoked or expired — ask the target to
     re-grant; never request the secret over email or chat.
   - **scopes FAIL:** permissions narrowed (for a VDR, a folder may have been
     hidden from the grant) — tell the deal lead which scope or folder is
     missing; findings depending on it should be treated as stale.
   - **mappings FAIL:** provider changed shape — open an adapter bug; switch
     the connection back to `FIXTURE` only for demos, never to fake a live
     result.
4. Record outcome and time-to-recover.

The VDR adapter is fixture-only in this release; a `LIVE` VDR connection
always reports reachability FAIL by design.
