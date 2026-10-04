# Metering — per-deal AI usage

Pricing bills per deal, so AI usage must be attributable to a deal.

## What exists

The Claude gateway (`packages/ai`) emits an `AiRunRecord` for every call:
organization, deal, task type, prompt id/version/hash, resolved model,
`inputTokens`, `outputTokens`, latency, status — and never raw content. The
record is passed to the gateway's `onRun` hook.

## Gap

Nothing persists `onRun` records yet. The follow-up (outside T-007's Touches:
`packages/db`, `apps/api`) is:

1. An `ai_runs` table with organization and deal identity, RLS, UUIDv7 ids and
   UTC timestamps; written in the same transaction scope as the run's audit
   event.
2. A per-deal usage summary (tokens by model and task, by month) for org
   admins.
3. Token counts as integers; any cost figure computed with decimal arithmetic
   from a versioned price table, never floating point.

Until then, per-deal usage for a pilot invoice cannot be produced from the
platform; pilot agreements should be flat-fee.
