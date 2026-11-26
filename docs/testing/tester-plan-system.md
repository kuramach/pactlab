# Tester plan system

Each morning a fresh plan is generated from what actually changed. The tester runs it, files bugs as GitHub issues, and Kumar triages. Approved 2026-11-24.

## Generate today's plan

```bash
node scripts/tester-plan.mjs            # today
node scripts/tester-plan.mjs 2026-11-26 # a specific date
```

It reads git and GitHub state (needs `gh` signed in) and writes only `docs/testing/plans/YYYY-MM-DD.md`, filled from `docs/testing/daily-plan.template.md`. Sections: smoke first, regression-from-changes, rotation focus, exploratory charters, retests — each with a timebox and exit criteria. The smoke-first order and its "do not start section 2" rule live in the template.

Inputs:

- **What changed:** merges to `main` since the last plan. The watermark is `docs/testing/plans/.watermark` (the main commit the last plan was built from); with no watermark, the last 24 hours. Each merge becomes one regression check.
- **Rotation:** the weekday table below.
- **Retests:** closed issues labelled `tester-bug` that do not yet carry `retest-passed`.
- **Triage digest:** the latest T-150 digest, when one exists at `docs/testing/triage-digest/latest.md`; each `##` or `-` heading line becomes an exploratory charter. Absent digest means generic charters only.

## Weekly rotation

| Day | Focus |
|---|---|
| Mon | Core platform |
| Tue | Pack deep-dive A |
| Wed | Money path: bridge, personas, confidentiality walls |
| Thu | Pack deep-dive B and integrations |
| Fri | Retest sweep, cross-browser and mobile, free-range charter |

Pack order (`docs/testing/pack-rotation.txt`): software-saas, healthcare, small-clinics, hospitals, fintech, ecommerce-dtc, commercial-property, multifamily, hotels, pharma-biotech, professional-services, telecom-media, venture-raise. Each ISO week takes the next two packs (A on Tue, B on Thu) and the list wraps. Unbuilt packs join the file when they merge.

## Ground rules

- New work is tested on **dev**. Live gets prod-safe checks only, inside demo orgs.
- Stripe test mode and BoldSign sandbox recipients only. Demo identities only; no real customer data exists or may be entered.
- Never re-walk a path the Playwright suite already covers green. Smoke runs first; humans hunt what automation cannot see.
- A confidentiality leak (one party seeing another's buyer-only or seller-only data) is S1: stop, file, tell Kumar.

## Filing bugs

Use the **Tester bug** issue template (`.github/ISSUE_TEMPLATE/tester-bug.yml`). It carries environment/build, account/org/pact, steps, expected vs actual, evidence, frequency and severity:

| Severity | Meaning |
|---|---|
| S1 | Blocker or confidentiality leak |
| S2 | Major or wrong result |
| S3 | Minor, with a workaround |
| S4 | Cosmetic |

## Triage hand-off (manual)

1. Kumar triages `tester-bug` issues.
2. Approved bugs are filed as task files under `tasks/ready/`; rejected or duplicate ones are closed with a reason.
3. When the fix merges the issue is closed; it then appears in the next plan's retest section.
4. The tester confirms and adds `retest-passed`, or reopens with new evidence.

Automatic task creation (reusing the T-150 `triage-approved` pattern) is out of scope for now.

## Files

- `docs/testing/daily-plan.template.md`, `end-of-day-report.template.md`, `tester-onboarding.md`
- `docs/testing/plans/` generated plans and `.watermark`
- `scripts/tester-plan.mjs` the generator
