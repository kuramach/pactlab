# Week-1 tester onboarding checklist

Work top to bottom. Each day's generated plan is in `docs/testing/plans/`; ask Kumar to run `scripts/tester-plan.mjs` if today's is missing.

## Before day 1

- [ ] Read `docs/testing/tester-plan-system.md` end to end.
- [ ] Get a GitHub account with access to file issues in `kuramach/pactlab`.
- [ ] Get demo-identity sign-ins for dev and for the live demo org (from Kumar; never share or paste credentials into issues).
- [ ] Know the test rules: Stripe test mode cards only, BoldSign sandbox recipients only, no real people's data anywhere.

## Day 1 (Mon) — core platform

- [ ] Run today's plan, smoke first.
- [ ] File one practice bug with the `tester-bug` issue template, filling every field. Kumar reviews it.
- [ ] Write the end-of-day report from `docs/testing/end-of-day-report.template.md`.

## Day 2 (Tue) — pack deep-dive A

- [ ] Run the plan. Learn how a pack's evidence imports and findings flow into valuation.

## Day 3 (Wed) — money path

- [ ] Run the plan: bridge, personas, confidentiality walls. A confidentiality leak is S1: stop, file, tell Kumar.

## Day 4 (Thu) — pack deep-dive B and integrations

- [ ] Run the plan, including one integration walk-through in sandbox mode.

## Day 5 (Fri) — retest sweep, cross-browser/mobile, free-range

- [ ] Retest every fixed `tester-bug` issue; label `retest-passed` or reopen.
- [ ] Run the cross-browser and mobile checks.
- [ ] Spend the free-range charter on whatever worried you most this week.
- [ ] Send the end-of-day report and a short week summary to Kumar.

## By the end of the week you should be able to

- [ ] Generate or find today's plan and know what is in each section.
- [ ] File a bug that Kumar can triage without asking a question.
- [ ] Say which severity (S1–S4) a given problem is and why.
- [ ] Explain why you skip paths the automated suite already covers.
