# Product-help chat (T-175, ADR 0057)

The "Ask about Pactlab" chat on pactlab.ai (it opens the app's `/assistant` page) and the **?** button in the app.

## Setup
- **Where hand-offs go:** set `SUPPORT_TEAM_EMAIL` on the API task. Unset, it falls back to `OPERATOR_EMAIL`. With neither set, or no email sender, the panel says the message can't be passed on from there.
- **The site button:** it shows only when the site is built with `NEXT_PUBLIC_APP_URL`.
- **The model:** it runs on the `support_chat` job (Haiku 5.5 first). With AI off, the assistant says it is unavailable and still offers the email route.

## Changing what it knows
- **Site pages:** edit the content in `apps/site/lib`, then run `UPDATE_SUPPORT_CORPUS=1 pnpm --filter @pactlab/site test` and commit `packages/ai/src/support/site-corpus.generated.ts`.
- **In-app steps:** edit `packages/ai/src/support/app-help.ts` whenever a screen's buttons or headings change. Steps quote them.
- **What's new:** new cards in `apps/api/src/feature-cards/feature-cards.ts` are answerable at once.

## Checking it
- Every model call logs `event: "ai.run.metered"` with `jobType: "support_chat"`: tokens, model, provider, latency and status. It carries no content.
- Every hand-off logs `event: "support_chat.handoff"` with the kind and surface. Who asked is only in the email.
- A visitor who hits the limit sees "That's a lot of questions…". Limits are per API task and reset after 10 minutes.

## If it says something wrong
- **The cause is the corpus:** it answers only from it. Correct the page or the help steps, regenerate, and release.
- **An invented price or date:** check the cited article. The answer is replaced by "I don't know" unless a cited source states that figure.
