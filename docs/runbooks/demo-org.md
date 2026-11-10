# Demo organization

"Pactlab Demo (synthetic)": one organization with a complete pact per pack, for demos on stage and live (ADR 0019 amendment).

## Who signs in

| Side | Email | Role |
|---|---|---|
| Buyer | kumar+demo@pactlab.ai | Organization owner, deal lead |
| Seller | kumar+demoseller@pactlab.ai | Target contributor (guest) on each pact |
| Bidders | kumar+bidder-a@, kumar+bidder-b@, kumar+bidder-c@pactlab.ai | One bidding firm each on the seller-led teaser (guests; each sees only their own bid) |

Sign-in is by email code, delivered to the kumar@pactlab.ai inbox (plus-addressing).

## What it builds

Every tab of every demo pact has synthetic data (2026-11-09).

- **Pacts:** live gets the released packs; stage and lower get all 13.
  - **Two per buyer-led pack:** "<Pack> demo", left *ready to close* so the close can be shown live, and "<Pack> demo, closed", closed with its Post-Close register worked.
  - **Venture Raise:** one pact; a raise has no close.
- **Each pact holds:**
  - **Overview / Screening:** an asking price (the banker's indication), headline figures, red flags and a GO verdict.
  - **Team:** lead, reviewer and a synthetic analyst, plus the seller as a guest.
  - **Documents and Evidence:** the data room from `kuramach/pactlab-demo-data` at the pinned commit, and the pack's extracts imported.
  - **Sources and Engineering:** a synthetic GitHub repository and Jira site, synced, for packs that read code or delivery (Software, Fintech, Healthcare, Telecom, E-commerce, Venture; Jira only for Services).
  - **Findings:** up to five accepted (drags priced), one with more support requested, one rejected.
  - **Claims:** the screening red flags, plus seller assertions marked verified, contradicted (linked to a finding) or unverified.
  - **Finances:** cash, a term loan and debt-like items, each cited to a synthetic balance-sheet page.
  - **Regulatory:** certainty terms (efforts, divestiture cap, reverse termination fee), the enforcement posture and a pledge, cited to a synthetic agreement extract.
  - **Valuation / Sextant:** Downside, Base and Upside scenarios; comparables of the pack's own type; two negotiation anchors; the lead's judgement of the ask; a persona evaluation.
  - **Terms and Closing:** proposed, countered by the seller, revised and accepted; both signed; the closing checklist with funds confirmed.
  - **Raise** (Venture only): round settings and three offers, so the round model, comparison and investor view work.
  - **Post-Close** (closed pacts): the register generated, with owners, dates and one item done.
  - **Foresight:** prepares itself the first time the tab is opened.
- **Seller-led Multifamily teaser:** a published anonymous listing with property facts, and three bidder firms. All three accepted the NDA and asked questions (one answered to all, one privately); two made offers, one passed, and one is shortlisted.
- **Organization-wide:** entered comparables for every pack, and an executive report plus a pact report in Reports.

## Run

One command checks your AWS sign-in and the latest deploy, then runs the task:

```bash
pnpm demo:live                         # live: adds whatever is missing
scripts/demo-org.sh stage              # any environment
scripts/demo-org.sh live --reset       # rebuild (asks you to type RESET on live)
```

The underlying commands:

```bash
scripts/ops-task.sh stage src/ops/demo-org.ts          # adds whatever is missing
scripts/ops-task.sh stage src/ops/demo-org.ts --reset  # deletes the demo pacts, then rebuilds them
scripts/ops-task.sh live  src/ops/demo-org.ts          # the owner runs this
```

- `ops-task.sh` runs this script on the **seed** task definition, which has the document bucket; other ops scripts use the migrate task, which has no AWS permissions.
- The task downloads the demo data from GitHub over the app subnets' NAT.
- Re-running is safe: pacts are matched by name and only missing ones are built. Existing pacts are not upgraded in place, so after a change to what the demo builds, run with `--reset` to rebuild them in full.
- The output lists each pact and whether it was built, already present, or FAILED (with the reason).
- No email is sent and no Bedrock tokens are spent.

## Safety

- The script touches only the organization with the fixed demo id and slug `pactlab-demo`; it stops if another organization holds that slug.
- `--reset` deletes only that organization's pacts, through the normal deletion service (audited, documents purged).
- To remove it entirely, suspend the organization in the operator console.
