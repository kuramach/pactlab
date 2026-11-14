# Quarantine (T-113)

A test that passes on retry is flaky. It leaves the gating suite the same day, keeps running outside the gate, and gets an owner and a fix-or-delete date (CLAUDE.md, "Flaky means quarantined").

## How
1. Tag the test: `test('…', { tag: '@quarantine' }, async …)`.
2. Add it to [`quarantine.json`](quarantine.json):
   ```json
   { "spec": "listing.spec.ts", "title": "public deal page: …", "owner": "kuramach", "reason": "Times out waiting for the access email (CI run 42038078164)", "quarantinedOn": "2026-11-14", "fixBy": "2026-11-28" }
   ```
3. **Rules,** checked by `pnpm --filter @pactlab/e2e quarantine:check` in CI before the suite runs:
   - an owner and a reason for every entry;
   - `fixBy` at most 10 working days after `quarantinedOn`, and never in the past;
   - at most 8 at once;
   - every `@quarantine` test listed, and every listed test tagged.
4. **Leaving quarantine:** fix the test, then burn it in with `pnpm --filter @pactlab/e2e exec playwright test <spec> --repeat-each 20`. If it passes all 20, remove the tag and the entry. If it can't be fixed by its date, delete it and push its coverage down to an API test.

## Where flaky tests show up
- **Every CI run:** the job summary lists each test that passed on retry, and so does `test-results/flaky.json` (from `support/flaky-reporter.ts`).
- **Across runs:** `pnpm --filter @pactlab/e2e flaky:history 60` tallies flaky and failed tests over the last 60 runs of `ci.yml` and `e2e-full.yml`, most frequent first: the de-flake work queue. A failure on a feature branch may be a real break rather than a flake; check before quarantining.

## Now
Nothing is quarantined. The queue on 2026-11-14 (the last ~80 runs):
- `regulatory.spec.ts` failed 4 times;
- `passkeys.spec.ts` and `listing.spec.ts` failed twice each;
- `foresight.spec.ts` (2 tests), `invitations.spec.ts` and `seller-led.spec.ts` failed once each;
- `venture-pack.spec.ts` was flaky once.

None of these has failed in the gating suite since 2026-11-10. The first pass-on-retry from here on goes into quarantine.
