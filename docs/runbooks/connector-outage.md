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

## integration-live red on the IMF DataMapper test (T-137)

Symptom: nightly `integration-live` fails only in `src/live/imf.live.test.ts` with `PROVIDER_ERROR`; the Kafka GitHub/Jira tests pass. The test message now appends a probe (`[probe <status> <content-type>]`, never the body).

Diagnosis (2026-11-18, runs 44340554942 and 44412175970): `www.imf.org/external/datamapper/api/v2/...` answers `403 text/html` to GitHub-hosted runner IPs while the same call succeeds from a workstation (`pnpm test:live`, 12/12). This is IMF edge access policy against datacenter addresses, not an adapter bug, rate limit, or credential problem (the IMF API takes no credential). Retries and longer timeouts do not help. The IMF test has been red since it was added (first red run 2026-10-29).

Resolved (Kumar, 2026-11-18): the IMF check runs nightly from Kumar's Mac, not from GitHub.
- **Setup:** `scripts/imf-nightly-install.sh` installs a launchd job that runs at 02:30, or when the Mac next wakes.
- **What it runs:** `scripts/imf-nightly.sh` takes the latest main in its own worktree (`../pactlab-nightly`) and runs only the IMF live test.
- **Results:** the log is `~/Library/Logs/pactlab/imf-nightly.log`, and a failure posts a macOS notification.
- **On GitHub:** the IMF test is skipped (`GITHUB_ACTIONS`), so `integration-live` there covers only the Kafka pair.
- **Reading a failure on the Mac:** a `403 text/html` probe is the known block; any other probe result is new drift.