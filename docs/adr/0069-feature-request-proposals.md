# ADR 0069: Feature requests from chat become proposals; only Kumar's approval makes a task (T-176)

**Status:** accepted (Kumar, 2026-11-26 brief; scope widened 2026-11-28)

## Context
- T-175's help chat recognizes a feature request, confirms the wording back, and hands it to an intake port.
- The same discipline as log triage (ADR 0048) applies: nothing becomes a build task without Kumar's explicit approval, and the person who asked can see what happened.

## Decision
1. **A proposal store with no direct access.** `feature_proposals` and `feature_proposal_supporters` (RLS enabled and forced, no policy for the runtime role) are reached only through `app_feature_*` SECURITY DEFINER functions owned by `pactlab_ops`, as bug reports are (T-072). Intake and "mine" act for the verified requester; every triage function first checks the actor is a platform operator and writes an audit event (`feature_request.*`).
2. **Product feedback only, and only with a way to reach the person.** A proposal holds the requester's confirmed wording, surface, locale, page path and the chat excerpt T-175 hands over (never pact data). A site request needs an email address and an app request needs a user and organization (a database check); anonymous requests are not stored. Limits: 5 requests per person per day, 300 per hour from the site, plus a deterministic spam screen (links, repeated text, shouting) on the public intake.
3. **Similarity suggests, a person confirms.** A new request is compared (word overlap, in code) with the 300 most recently touched proposals. A live match takes the request as a `SUGGESTED` supporter of that proposal: it is not a new proposal, and it is not counted until the triager confirms it ("same ask") or splits it into a proposal of its own. A declined match is kept as the earlier decision on a new proposal, and the requester is told it was decided before, with the reason when one was given.
4. **Approval records; the repository's own workflow writes the file.** Approving in the console stores the task Kumar confirmed (model, lane, context, touches, needs, title; defaults proposed from the surface) and shows a GitHub new-issue link carrying it. The API holds no GitHub token. Kumar's `triage-approved` label on that issue runs the existing `triage-to-task` workflow (ADR 0048), which re-validates every field and writes `tasks/ready/T-nnn.md` with an `Origin: feature-proposal <id>` line, once per proposal. The console then links the task id, the pull request and the What's-new card; the card link marks the request shipped.
5. **Honest status.** Submitted, in triage, question asked, approved (a task exists, never a date), declined (with the reason), shipped. In-app requesters see their own in Settings; site requesters are emailed the change. A requester's reply to a question reopens the request (in app); a reply by email is entered by Kumar with Reopen.

## Consequences
- The chat cannot create a task: the only path to `tasks/ready/` is Kumar's approval in the console and his label on GitHub.
- A declined request is retained and searchable; a repeat request surfaces the earlier decision.
- Rollback: drop the `app_feature_*` functions, the two tables and the sequence, and restore the previous `audit_events_ops` policy; nothing else refers to them.
