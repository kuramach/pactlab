# Demo organization

"Pactlab Demo (synthetic)": one organization with a complete pact per pack, for demos on stage and live (ADR 0019 amendment).

## Who signs in

| Side | Email | Role |
|---|---|---|
| Buyer | kumar+demo@pactlab.ai | Organization owner, deal lead |
| Seller | kumar+demoseller@pactlab.ai | Target contributor (guest) on each pact |

Sign-in is by email code, delivered to the kumar@pactlab.ai inbox (plus-addressing).

## What it builds

- **Pacts:** live gets one per released pack; stage and lower get all 13 packs.
- **Each buyer-led pact:**
  - the data room from `kuramach/pactlab-demo-data` at the commit pinned in `demo-org.ts`;
  - findings, submitted by the lead and accepted by "Demo Reviewer (synthetic)";
  - Downside, Base and Upside scenarios;
  - a persona evaluation;
  - terms proposed, the price countered by the seller, revised and accepted;
  - both signatories signed off in Pactlab;
  - a closing checklist with funds recorded and confirmed, ready to close.
- **Venture raise pact:** stops after the scenarios, because a raise has no buyer terms.
- **Teaser:** one seller-led Multifamily pact with a published anonymous teaser and property facts (fixture data).
- **Foresight:** prepares itself the first time each pact's tab is opened.

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
- Re-running is safe: pacts are matched by name and only missing ones are built.
- The output lists each pact and whether it was built, already present, or FAILED (with the reason).
- No email is sent and no Bedrock tokens are spent.

## Safety

- The script touches only the organization with the fixed demo id and slug `pactlab-demo`; it stops if another organization holds that slug.
- `--reset` deletes only that organization's pacts, through the normal deletion service (audited, documents purged).
- To remove it entirely, suspend the organization in the operator console.
