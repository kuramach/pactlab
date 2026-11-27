# ADR 0057: Product-help chat on the site and in the app: first-party, published corpus only, no pact data (T-175)

**Status:** accepted (Kumar, 2026-11-26).

## Context
- Kumar wants a chat on the public site and in the logged-in app that explains features, walks people through steps and clears up confusion.
- A third-party support widget would mean a per-seat SaaS commitment, and an outside vendor receiving conversations from a product whose brand is confidentiality. So the chat is built on Pactlab's own AI stack.

## Decision
1. **One service, two surfaces.** `apps/api` `SupportChatService`:
   - `POST /v1/public/support-chat/messages` on the site (anonymous);
   - `POST /v1/support-chat/messages` in the app (signed in);
   - one shared panel, `HelpChat` (`apps/web/app/_components/help-chat`).
2. **A new job, `support_chat`** (`JOB_MODEL_MAP`):
   - Haiku 5.5 first (fast lane), then Gemini Flash where Google is connected, then Sonnet 5.5;
   - runs through the same gateway, routing and ADR 0034 gates as every job;
   - in-app calls use the caller's organization, so its allow-list applies; site calls use the platform scope;
   - prompt `support.chat@1`, versioned and registered.
3. **The corpus is published knowledge only** (`packages/ai/src/support`). It holds:
   - the site's guides, FAQ, how-it-works, product, pricing, trust and released industry pages;
   - in-app help with steps matched to the screens' own wording (`APP_HELP`);
   - the What's-new cards (in-app).

   The site's articles are generated from `apps/site` content (`site-corpus.generated.ts`). A site test fails when the committed copy drifts.
4. **The boundary is structural.** The search index (`SupportIndex`) is built only from `HelpArticle`s. `assertKnowledgeOnly` refuses any other kind, and any text carrying a UUID or an email address. The service imports nothing that reads tenant rows for an answer.
   - **Page context:** in-app, the only context is the page's path. Its shape (ids replaced) reaches the model; the pact id only fills a deep link.
   - **Deterministic pre-check:** a check refuses questions that ask what a pact, deal or organization contains, before any model call. The model's `NEEDS_ACCOUNT` gives the same boundary sentence.
   - **Locale:** the boundary sentence is fixed text in the surface's locale.
5. **Code decides what is shown.** An answer must cite at least one source it was given. It must state no price or date its sources don't state. Otherwise it becomes the fixed don't-know with the email offer. A question with no corpus match gets the don't-know without a model call.
6. **Steps mode.** A "how do I…" answer is numbered steps from the help article, with a deep link to the screen, filled with the pact the person is on.
7. **Hand-off only on confirmation.** A question or a feature request goes to the team only when the visitor confirms it:
   - **Address:** on the site, with the visitor's email address (required).
   - **Questions:** emailed to `SUPPORT_TEAM_EMAIL`, falling back to `OPERATOR_EMAIL`.
   - **Feature requests:** go to a `FeatureRequestIntake` port (`FeatureRequestIntakeItem` in contracts). T-176 builds its store and triage. Until then it emails the team, so nothing is dropped.
   - **No promises:** the assistant never says a request will be built, or when.
8. **Locale.** Requests carry `en`, `de`, `fr` or `ja`, a recorded parameter of the call.
   - Only the English corpus is published. On other pages the assistant answers from it in English and says so in the page's language.
   - The boundary, don't-know, rate-limit and feature-request sentences, and the panel's own labels, are in all four.
9. **Anonymous and stateless.** The panel keeps the conversation and sends its last turns. The server stores none of it.
   - **Site limits:** per conversation (20 per 10 minutes) and per client address (60 per 10 minutes).
   - **In-app limits:** per person.
   - **Hand-offs:** 5 an hour.
10. **On the site, a small window.** The marketing site is a static export whose CSP allows `connect-src 'self'` only. So its "Ask about Pactlab" button opens the app's public `/assistant` page in a small window. That page renders the same panel.

## Consequences
- **Metering is a structured `ai.run.metered` record** per model call: job, surface, prompt, provider, model, tokens, latency and status, with no content.
  - Help runs belong to no pact, so they are not `ai_runs` rows (which need a deal), and Hosting cost does not show them yet.
  - Storing them and adding `support_chat` to the console's route keys needs `packages/db`, outside this task: follow-up **T-185**.
  - Until then the console's routing view shows the job's registry chain, and it cannot be re-routed per organization.
- **Rate limits are per API task** (in memory), not shared.
- **An in-page panel on the site** needs the site CSP's `connect-src` to allow the app's origin (infra), also in T-185.
- **Rollback:** remove the launcher from both layouts. The API routes and the job are inert without them. No migration.
