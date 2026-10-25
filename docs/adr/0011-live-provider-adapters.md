# ADR 0011 — Live GitHub and Jira adapters, cross-links and the Jira host allowlist

Status: accepted (T-082, 2026-10-25; decisions by Kumar)

## Context

T-074 chose live integration-test targets (apache/kafka on GitHub, project
KAFKA on issues.apache.org). The adapters could not use them: the live Jira
adapter was configuration-only and accepted only `*.atlassian.net`; the live
GitHub adapter read commits only and dropped messages, so the `KAFKA-####`
links between code and delivery had nothing to attach to. Diligence targets
also run Jira Data Center, not only Cloud.

## Decision

1. **Normalized GitHub contract.** `GitHubAdapter` adds
   `listPullRequests`, `pullRequestReviews` and `checkRuns`
   (`PullRequestMetadata`, `ReviewSummary`, `CheckSummary`). `CommitMetadata`
   adds an optional sanitized `message`. Fixture and live adapters implement
   the same contract; versions `github-fixture-3`, `github-live-2`.
2. **New evidence.** `code.pull_request` (state, timing, pseudonymous author
   and reviewer keys, review and check counts, sanitized title) and
   `code.issue_link` (one per commit or pull request and Jira key). Both are
   in `VALUATION_DIRECTION_MAP`; the contract test fails the build on any
   unmapped type. Reads are bounded (24 months, 2,000 pull requests, details
   for the newest 200) and every bound that bites is a source issue.
3. **Cross-links are a connector output.** Keys (`[A-Z][A-Z0-9]{1,9}-n`,
   standards such as `UTF-8` excluded) are read from sanitized messages and
   titles; `cross-links.ts` resolves links to issues and issues to links.
4. **Live Jira client** (`jira-live-1`) behind the unchanged `JiraAdapter`
   contract. Cloud: `/rest/api/3`, enhanced search `search/jql` paged by
   `nextPageToken` (the old search was removed, Atlassian CHANGE-2046), the
   account email and API token as Basic auth. Data Center: `/rest/api/2`,
   `search` paged by `startAt`, a personal access token as Bearer, or
   anonymous. Only delivery fields are requested — never summary,
   description or comment text. Story-point and sprint fields are found by
   their documented custom types; sprints come from the Agile API and their
   points are totalled from their issues. `JiraIssue.providerType` keeps the
   site's own type name beside the normalized one.
5. **Host allowlist, operator-only.** `site` is any DNS host name (no IP
   literals, ports, user info or `localhost`) plus an optional `basePath`.
   Atlassian Cloud is always allowed; a self-hosted host only when listed in
   `JIRA_SELF_HOSTED_HOSTS` (platform configuration). Enforced when a
   connection is created or switched live (422 `JIRA_SITE_NOT_ALLOWED`) and
   on every live request and validation.
6. **SSRF discipline.** HTTPS only; `redirect: 'manual'` on every provider
   request, with any 3xx reported as unavailable; payloads never logged.
7. **Anonymous reads.** Public GitHub repositories and public Jira projects
   may be read with no credential. The database requires every LIVE
   connection to name its credential, so these carry the sentinel
   `secretref:pactlab/anonymous`; nothing is stored under it.

## Consequences

- T-074 can run its live smoke tests against the Kafka pair behind its env
  flag; the PR gate stays hermetic (recorded and hand-built cassettes).
- The allowlist does not defend against a listed host whose DNS later points
  inside the network (DNS rebinding); listing a host is a trust decision the
  operator makes.
- Cloud issue history (`expand=changelog`) on enhanced search is requested
  but not confirmed by Atlassian's documentation; when a site does not return
  it, reopen counts read as zero and a source issue says so.
- There is no web form for live Jira yet: the API (`POST
  /v1/deals/:id/connections/jira`, `PUBLIC` or `TOKEN`) is ready for it.
