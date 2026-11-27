# Hosting cost (admin console)

**Admin → Hosting cost** shows three things for a period you pick (this month, last month, 3, 6 or 12 months, or custom dates) and an environment (or all):

1. **AWS billed**, from Cost Explorer in the **payer (management) account**:
   - by month (environments stacked);
   - by environment (the `pactlab:environment` tag);
   - by AWS product.

   It is read on live only.
2. **Metered here (estimated):** live's own AI runs and documents, priced with the rates you enter.
   - **Broken down by:** organization, sign-in method (company SSO or email code), pact, person (email) and model.
   - **AI:** tokens × the model's rate on the run's day.
   - **Storage:** documents held × the GB-month rate (30 days = one month).
3. **Shared, not allocated:** what AWS billed live, less what is metered. That covers the database, servers, network and email. It is never spread across customers.

There is also a **Bedrock check**: what AWS billed for Bedrock on live next to the meter's Bedrock estimate. A large gap means a rate is wrong or missing.

## One-time setup (Kumar)

1. **Create the read-only role in the payer account.** Use payer credentials; an agent or CI never does this.
   ```bash
   pnpm --filter @pactlab/cdk exec cdk deploy PactlabCostRead \
     -c pactlab:cost:payerAccount=<payer account id> -c pactlab:cost:liveAccount=<live account id> --profile <payer profile>
   ```
   This creates the role `PactlabCostRead`:
   - it can call only `ce:GetCostAndUsage`, `ce:GetDimensionValues` and `ce:GetTags`;
   - only live's API task role can assume it.
2. **Activate the cost allocation tag.** In the payer account, go to **Billing → Cost allocation tags**, then activate `pactlab:environment`.
   - **Timing:** AWS applies it from activation onward, and it can take up to a day to appear.
   - **Earlier spend** shows as "untagged".
3. **Tell live which role to use.** In GitHub, open **Settings → Environments → live → Variables** and add `COST_EXPLORER_ROLE_ARN` = `arn:aws:iam::<payer account id>:role/PactlabCostRead`. The next live deploy passes it to the API, along with permission to assume that role only.
4. **Enter rates.** Go to **Admin → Hosting cost → Rates** and copy them from AWS's price pages for the region (us-east-2 for live):
   - one Bedrock input rate and one Bedrock output rate per model ID that live uses (the page lists any that are missing);
   - one S3 storage rate (`standard`).

   Give each one a start date. When a price changes, add a new rate with the new date; saving again with the same date corrects a rate.

## How it refreshes
- **Automatic:** opening the page reads Cost Explorer again when the stored data is over a day old.
- **Manual:** **Refresh now** reads it straight away, at most once an hour.
- **Cost:** each refresh makes two to four Cost Explorer requests, at about $0.01 each.
- **What it reads:** 13 months by month and the last 92 days by day. A refresh replaces what is stored, so there are no duplicates.
- **Failures:** a failed refresh shows its error class on the page, and the last good data stays.
  - `AccessDenied…`: the role, its trust or the variable in step 3 is wrong.
- **Audit:** `operator.cost_refreshed`, `operator.cost_refresh_failed`, `operator.cost_rate_set` and `operator.cost_rate_deleted`.

## Limits
- **Per-person figures start 2026-11-15:** `ai_runs.requested_by` began then, so earlier runs show as "Before per-person tracking".
- **Metered rows cover this environment only:** each environment has its own database, so live's console meters live. AWS billed covers every environment.
- **Open months are estimates:** months still open are AWS's estimate and are marked "estimate".

## Environment states (ADR 0063)

The page lists dev, qa, stage and live with their state (awake, paused, hibernated; live always on), when it changed, the hibernate snapshot, and the estimated cost while hibernated. Live reads the other accounts through their read-only `pactlab-<env>-power-read` roles (the `live` GitHub Environment's `POWER_READ_ROLE_ARNS`); without them those rows say *Not readable from here*. Setup: [hibernate.md](hibernate.md), step 5.
