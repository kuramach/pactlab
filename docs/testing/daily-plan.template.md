# Tester plan — {{DATE}} ({{WEEKDAY}})

Focus today: **{{FOCUS}}**. Generated {{GENERATED_AT}} from main @ `{{HEAD}}`. Read `docs/testing/tester-plan-system.md` for the ground rules.

Ground rules in one line: test new work on **dev**; live gets prod-safe checks only, inside demo orgs; Stripe test mode and BoldSign sandbox recipients only; demo identities only.

## 1. Smoke — first, always (timebox 30 min)

Do not start section 2 until every smoke check below has a result. A failed smoke check is filed as a bug (S1 or S2) and reported to Kumar immediately.

- [ ] Sign in to dev as the demo buyer; the home screen loads without error.
- [ ] Open the demo pact; the evidence list, findings and valuation views load.
- [ ] Open one finding and follow its citation to the source evidence.
- [ ] Create a pact in a demo org, then delete or abandon it; nothing breaks.
- [ ] Sign out; a protected URL pasted afterwards sends you to sign-in.
- [ ] Check the live demo org read paths (prod-safe only): sign in, open the demo pact, change nothing.

Exit: all smoke boxes ticked or a bug filed against each failure.

## 2. What changed — regression checks (timebox 90 min)

{{WHAT_CHANGED}}

Exit: each change has a pass, fail (bug filed) or "not testable on dev" with a reason.

## 3. Rotation focus — {{FOCUS}} (timebox 120 min)

{{ROTATION}}

Exit: the focus area walked end to end; every deviation filed as a bug.

## 4. Exploratory charters (timebox 60 min)

{{CHARTERS}}

Exit: each charter has notes of what you tried and found, even when nothing was found.

## 5. Retests (timebox 30 min)

{{RETESTS}}

Exit: each fixed bug is confirmed fixed (comment and add the `retest-passed` label) or reopened with new evidence.

## End of day

Fill in `docs/testing/end-of-day-report.template.md` and send it to Kumar. Skip nothing in section 1; if time ran out, say which sections were not reached.
