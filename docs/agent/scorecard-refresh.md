# Monthly model scorecard refresh

Run on the 1st of each month (a scheduled Claude routine; see the runbook), or on demand. Output: one PR. A person merges it; nothing changes on live until then.

## Steps
1. **Read** `docs/model-scorecard.md`: its method (per-job boards, cost per task, hard gates) and its **Sources** line.
2. **Re-pull each source** named there, for the current cycle. Use the boards' own pages and the scorecard repo the doc cites (`github.com/sboghossian/legal-ai-model-router`, `data/scorecard-YYYY-MM.md`).
   - **Record:** the date, the cycle, and each model's figure **in that board's own metric**.
   - **Never merge or compare** across boards, or across a board's cycles when its method changed. Never fill a gap with an estimate. Write "no public figure".
   - **Keep variants apart** (Max, High and base are different rows).
3. **Apply the method per job,** with the hard gates as pass/fail and never averaged:
   - data terms (DPA and zero retention) for non-AWS providers;
   - US residency;
   - Pactlab's health check;
   - API reachable.

   Cost per task is the price of the finished answer, not the list price.
4. **Write the changes:**
   - `docs/model-scorecard.md`: update every table, the routing reads, the closing verdict table, the date and the sources. Mark new or dropped models, and say what changed since last month in a short **Changes this month** section at the top.
   - `packages/ai/src/scorecard.ts`: set `SCORECARD_AS_OF` and each job's picks (`name`, `score`, `costPerTask`, `role`, `note`), mirroring the doc. Names exactly as the boards give them; **no model IDs**.
   - `packages/ai/src/jobs.ts`: change a default chain **only** when the verdict for that job changed, with a one-line reason citing the board and figure. A model with no reachable route (no key, not on Bedrock) can still be a pick; chains fall through to Claude lanes.
5. **Checks:** `pnpm lint && pnpm typecheck && pnpm test` (the scorecard tests guard the structure). Fix anything you broke.
6. **Open a PR** titled `Model scorecard: <Month YYYY>`. Its body says:
   - what moved, per job (old → new, with the figure and source);
   - which default chains changed, and why;
   - anything that couldn't be re-pulled (say so; keep last month's figure and mark it with its date).

## Never
- Invent a score, a cost or a model ID.
- Promote a model on version number alone (the doc's caution 2: newest isn't best).
- Change live configuration, credentials or deploy anything. The PR is the whole output.
