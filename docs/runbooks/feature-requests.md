# Feature requests

Feature requests confirmed in the help chat (T-175) are filed as proposals (T-176, ADR 0069). Kumar triages them in the operator console; the person who asked sees where it stands.

## Triage

1. Console → **Feature requests**. Filter by status or search the wording, and the reasons of declined requests.
2. Open a request. **Requesters** lists each person (an address for the site, an organization for the app). A requester marked *suggested* was grouped by similarity: **Same ask** counts them, **Different** splits them into a proposal of their own. Nothing merges by itself.
3. If an earlier request for the same thing was declined, the page says so with its reason.
4. **Take it up**, **Request info** (emails site requesters; in-app requesters see the question in Settings → Feature requests and answer there, which reopens it; for an emailed reply, paste it into **Reopen**), **Reject** (an optional reason, shown to the requester and kept), or **Approve**.

## Approve → task

1. Edit the proposed model, lane, context, touches and needs (a first guess from where the request was made), then **Approve**. The requester now sees *Approved: a task exists*, never a date.
2. Open the task issue link and create the issue on GitHub (label `feature-proposal` must exist once: `gh label create feature-proposal`), then add the label `triage-approved`. The `triage-to-task` workflow writes `tasks/ready/T-nnn.md` with `Origin: feature-proposal <id>` and comments the task id on the issue.
3. Back in the console, **Link the task** with its id, then its pull request. Adding the What's-new card link marks the request **shipped** and emails site requesters.

The API does not hold a GitHub token; it only needs `TASK_ISSUE_REPOSITORY` (`owner/repo`) to offer the issue link. Without it the console says so and no link is shown.

## Limits and spam

5 requests per person per day; 300 per hour from the public site; the public intake also refuses requests with several links, repeated text or only capitals. A refused or limited request is not stored.

## Not yet

Status emails to site requesters are in English. A site visitor cannot reply from a link in the email; Kumar enters the reply.
