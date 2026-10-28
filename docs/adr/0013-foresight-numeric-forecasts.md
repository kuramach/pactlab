# ADR 0013 — Foresight: numeric forecasts from published, AI and user sources

Status: accepted (T-094 B10, 2026-10-28; decisions by Kumar)

## Context

Foresight (T-073) asked the model for qualitative trend lines on a button
press. In pilot testing the live call failed and left an empty tab with an
error banner. Kumar asked for: no Generate button; a five-year numeric
forecast per key metric from published external projections and from the
AI; the user's own forecast next to them; and the value of the business
under the AI set and the user's set, side by side, assumptions visible.

## Decision

1. **Key metrics per pack.** `foresightMetricsFor(pack)` (domain) lists the
   macro metrics every pact forecasts — inflation and real GDP growth — plus
   one sector metric per pack (e.g. RevPAR growth for hotels). Each has a
   neutral level and versioned elasticities (growth points and discount-rate
   points per point above neutral).
2. **Published forecasts: IMF World Economic Outlook only.** Official, free,
   public, no credentials (DataMapper API, verified 2026-10-28; USD → USA,
   EUR → euro area, GBP → GBR). Behind a `MacroForecastProvider` port with
   live and fixture adapters; `MACRO_FORECAST_SOURCE=fixture` in tests and
   e2e, so CI never calls out. Sector metrics have no free official
   forecast; they show "no published forecast" rather than a scraped one.
3. **AI forecast: a new versioned prompt** (`foresight.forecast@1`) — five
   bounded yearly values and a rationale per metric asked; anything else is
   dropped. Only sector, currency and public figures reach the model.
4. **Stored, versioned, append-only** in `foresight_forecasts` (source
   EXTERNAL | AI | USER); an unchanged published or AI series is not stored
   again; a user forecast is always a new version, audited.
5. **Never a view-time model call.** A `foresight_baselines` row records the
   refresh state. Creating a pact requests the baseline; opening Foresight
   starts a background refresh when it is missing, older than 30 days, failed
   over 10 minutes ago, or a run was lost — and returns at once. The page
   re-reads itself while it runs. What could not be fetched is stated as a
   note on the page, never hidden.
6. **Value is deterministic** (`projectWithForecasts`,
   `foresight-forecast-1`): each year's growth and the discount rate move by
   the metric gaps × elasticities; a discount-rate move changes the exit
   multiple. Two sets are shown: published + AI (AI where present, else
   published, else neutral) and yours (your series where entered).

## Consequences

- The refresh runs in the API process, fire-and-forget with stored state.
  T-095 (always-on AI) moves AI work to queued worker jobs; this refresh moves
  with it.
- The qualitative trend lines, scenarios and Q&A stay; the background refresh
  also creates the trend lines when a pact has none.
- Elasticities are a first version; changing them is a new
  `FORESIGHT_METRICS_VERSION` and engine version, never a silent edit.
