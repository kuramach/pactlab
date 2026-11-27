# ADR 0061: Storing the per-deal price books, promo codes and quotes (T-177a)

**Status:** accepted (2026-11-27), with Kumar's decisions below. It builds on ADR 0025 and its T-177 addendum.

## Context
- **What T-177 built:** the deterministic engine in `packages/domain/src/pricing` (`priceBookProblems`, `quotePact`, `liveBook`, `priceCheckout`, `suggestConvertedBook`) and `priceBookSchema` in `packages/contracts`. It has no storage, so the book lives nowhere, quotes aren't kept, and the promo kinds the engine knows have no table.
- **What T-087 stores:** organization-level billing in `billing_plans`, `promo_codes` (DISCOUNT against a Stripe coupon, or FREE_PACTS) and `promo_redemptions`. All of it is reached only through SECURITY DEFINER functions owned by `pactlab_billing`, and operator actions go through `app_ops_require`.
- **The brief:**
  - versioned books per currency (USD, GBP, EUR, JPY, INR), each with an effective time;
  - a version is immutable once it has quoted;
  - an in-flight quote keeps its price;
  - promos in every engine kind, with market scope, a window, a cap and stacking;
  - stored quotes that re-show exactly;
  - operator-only writes, every one audited;
  - expand-only migrations.

## Decision (proposed)

### 1. One access pattern: T-087's
The new tables are reached only through `pactlab_billing` SECURITY DEFINER functions. The runtime role `pactlab_app` gets EXECUTE on those functions and no table privileges at all. Operator functions start with `app_ops_require(p_actor)`, and every write calls `app_billing_audit`, the same way T-087's promo codes do. Organization reads go through functions that return only what that organization needs to quote its own pacts (§5).

### 2. Price book versions
- **`price_book_versions`:**
  - `id` (uuidv7), `currency` char(3), `version` int, `status` (`DRAFT` | `PUBLISHED`);
  - `effective_from` timestamptz (null while a draft);
  - `fixed_fee`, `variable_cap`, `pilot_flat` and `rounding` as `NUMERIC(21,6)`;
  - `base_documents` int and `base_ai_budget` `NUMERIC(21,6)`;
  - `based_on_version_id` (the version a draft was edited from), and `suggested_from` jsonb (`currency`, `version`, `rate`, `rateDate`, set when a draft was seeded by `suggestConvertedBook`);
  - `created_by` / `created_at`, `published_by` / `published_at`, and `first_quoted_at`.
- **`price_book_bands`:** `version_id`, `position`, `up_to` (null only on the last band), `bps` `NUMERIC(5,2)`, `documents` and `ai_budget`. Every amount is in the version row's currency, so money stays numeric with an explicit currency and scale (rule 3). The book's rounding unit is the display scale, and `NUMERIC(21,6)` holds everything the contract regex admits.
- **Constraints:**
  - unique `(currency, version)`, with versions counting up per currency so each market's history is its own;
  - at most one open `DRAFT` per currency (a partial unique index);
  - CHECKs that mirror the domain's cheap checks: bps 0–100, cap > 0, amounts ≥ 0, rounding > 0, and an effective time exactly when published;
  - band ordering and rounding against the currency's minor unit run in `priceBookProblems`, at the API, before any write. The publish function checks again that the bands ascend and that only the last one is open.
- **Immutability, enforced by a trigger:** a `PUBLISHED` version and its bands refuse every UPDATE and DELETE. The only columns that can still be written are `first_quoted_at`, set once by the quote function. **To edit, you create a draft from a version** (`based_on_version_id`) and publish it as the next version number. This freezes at publish, which is stricter than the brief's "once it has quoted". It means a version a customer may have seen is never rewritten, and it keeps the trigger simple. *Decision 1 for Kumar.*
- **Effective time:** chosen at publish, now or later, never earlier than the publish time. Nothing can be backdated, so a quote already made is never repriced. The live book at time *t* is the one `liveBook` picks: the latest published version in that currency whose `effective_from` ≤ *t*. A scheduled future version goes live with no deploy. A market with no published book refuses quotes (`NO_PRICE_BOOK`); it is never priced off another market's book.
- **Seed:** the migration inserts **USD v1** with the T-177 numbers, published and effective at the moment the migration runs. These are data, not code constants (ADR 0025: prices are data). EUR, GBP, JPY and INR get no book until Kumar authors them, starting from a suggested conversion if he likes (T-177b). Until then, quotes in those currencies are refused. *Decision 4 for Kumar.*

### 3. Promo codes for pact pricing
- **A separate table, `pricing_promos`,** rather than widening `promo_codes`. T-087's codes are organization-level: they're redeemed at sign-up and apply through a Stripe coupon or as free credits. Mixing per-quote price effects into those rows would change what `app_promo_check` and `app_promo_redeem` do for the running release. Both kinds still share **one code namespace**: the create functions lock and check both tables, so a customer typing a code never hits two meanings. *Decision 2 for Kumar.*
- **Columns:**
  - `id`, `code` (`^[A-Z0-9-]{4,40}$`, unique), `description`;
  - `effect` (`PERCENT_TOTAL` | `PERCENT_FIXED` | `AMOUNT_OFF` | `WAIVE_VARIABLE` | `PILOT_FLAT`), with `percent` `NUMERIC(5,2)`, `amount` + `currency`, or `pilot_flat` + `currency`, exactly as the effect needs (CHECK), matching the engine's `PromoEffect`;
  - `markets` char(3)[] (empty means global) and `stackable` bool;
  - `scope` (`ANY` | `PILOT_ONLY` | `ORGANIZATIONS`) with `organization_ids` uuid[] (non-empty exactly for `ORGANIZATIONS`);
  - `valid_from` / `valid_until`, `max_redemptions` and `max_per_organization`;
  - `status` (`ACTIVE` | `PAUSED` | `EXPIRED`), plus `created_by` / `created_at`.
- **What can change:** `effect`, `markets`, `stackable` and `scope` are frozen (by a trigger) once the code has a redemption. Status, window and caps stay editable, and each change writes a `pricing_promo_changes` row (append-only: actor, time, the fields before and after as jsonb) as well as the audit event. Audit events carry no free text (ADR 0039), so this row is where "before/after" lives. Pausing or expiring never touches completed purchases.
- **`pricing_promo_redemptions`:** `promo_id`, `organization_id`, `quote_id` (unique), `deal_id`, `currency`, `amount_forgone`, `redeemed_at` and `voided_at` (for T-087b refunds, set in T-177c). **A redemption is recorded when the quote is consumed** (the pact is bought), not when a quote is made. The redeem path locks the promo row `FOR UPDATE`, so two buyers can't both take the last use. Reports group by `currency` (uses and revenue forgone per market). *Decision 6 for Kumar.*
- **Rate limiting:** failed code checks reuse T-087's `promo_attempts` per-address limit.
- **Reseller codes stay with T-093.** The quote stores `partner_code` as typed and leaves `reseller_percent` null until T-093 resolves it. The engine already takes that percentage as an input.

### 4. Stored quotes
- **`pact_quotes`:**
  - `id`, `organization_id`, `deal_id` (null until the quote is consumed, because a pact is bought at creation), `currency`;
  - `book_version_id` (FK to an immutable version);
  - the inputs: `enterprise_value` (null for a pilot), `pilot` bool, `promo_code`, `promo_id`, `partner_code`, `reseller_percent`;
  - the outcome: `subtotal`, `total`, `applied` (`NONE` | `RESELLER` | `PROMO` | `BOTH`) and `includes` jsonb;
  - `engine_version` (`pricing-1`), `created_by` / `created_at`, `expires_at`;
  - `status` (`OPEN` | `CONSUMED` | `EXPIRED` | `VOIDED`).
- **`pact_quote_lines`:** `quote_id`, `position`, `kind` (`FIXED` | `BAND` | `PROMO` | `RESELLER`), with `from`, `up_to`, `bps`, `slice` and `amount` as each kind needs, plus a `capped` marker on the variable. These are the itemized lines that checkout (T-177c) turns into Stripe `price_data` items. The quote is re-shown from these stored lines, never recomputed.
- **Immutable except status:** a trigger allows only `OPEN → CONSUMED | EXPIRED | VOIDED` and setting `deal_id` once, on consume. Lines can't be changed at all.
- **In flight means open and unexpired.** An open quote keeps its price until `expires_at`, whatever is published in the meantime. *Decision 3 for Kumar:* validity of **30 days** is proposed.
- **Where the arithmetic runs:** in TypeScript, in the domain engine, as for every calculation. The record function (`app_pricing_quote_record`) still checks what it can before storing:
  - the version is published and was live at `created_at`;
  - the currency matches the version;
  - the lines foot to the subtotal, and the subtotal less the discount lines equals the total;
  - the promo is valid for this organization, market and pilot flag.

  It sets `first_quoted_at` on the version. Only the API holds `pactlab_app`, the same trust model as `app_billing_consume`.
- **Pilot is decided by the server** from `organization_flags.pilot_mode`, never taken from the request.

### 5. Row-level security and who reads what
- **The live book:** `app_pricing_live_book(currency)` returns the live published version and its bands to any signed-in member. Drafts, scheduled future versions and history are operator-only.
- **Quotes:** `app_pricing_quote_get(org, id)` returns a quote only to its own organization. RLS on `pact_quotes` and `pact_quote_lines` is `organization_id = current_setting('app.organization_id')` for `pactlab_billing` reads made on behalf of an organization, plus the function's own organization argument check. Another organization gets nothing (a 404 at the API).
- **Promos:** an organization never lists promos. It only checks one code, and gets back that code's effect only when it applies to this organization, market and pilot flag. Otherwise it gets a reason (`UNKNOWN`, `PAUSED`, `NOT_YET`, `EXPIRED`, `USED_UP`, `ALREADY`, `WRONG_MARKET`, `WRONG_CURRENCY`, `NOT_ELIGIBLE`).
- **Writes:** only the operator functions write books and promos. Only the record and consume functions write quotes and redemptions.

### 6. Audit
- **Events:** `pricing.book_drafted`, `pricing.book_draft_updated`, `pricing.book_draft_discarded`, `pricing.book_published` (target: the version id; "before" is `based_on_version_id`), `pricing.promo_created`, `pricing.promo_updated`, `pricing.promo_paused`, `pricing.promo_resumed`, `pricing.promo_expired`, `pricing.quote_created` and `pricing.quote_consumed`.
- **Where they go:** operator events sit under the operator's own organization, as T-087's promo codes and AI models do (the `operator.` view lists them). Quote events sit under the buying organization.

### 7. API (apps/api, a `pricing` module beside `billing`)
- **Organization routes:**
  - `GET /v1/pricing/books/:currency`: the live book;
  - `POST /v1/pricing/quotes`: body `pactQuoteRequestSchema` plus an optional `dealId`; returns `PactQuoteView` with the quote id; `@NoDemo`;
  - `GET /v1/pricing/quotes/:id`: re-shows a stored quote.
  - Quoting is open to the same roles that may start checkout today (`ORG_OWNER` and `ORG_ADMIN`). *Decision 5 for Kumar:* or any member, for a "what would this cost" view.
- **Operator routes** (platform operator, `@RecentSignIn` on publish and promo create):
  - `GET /v1/admin/pricing/books?currency=&cursor=&limit=`: version history, keyset-paged (T-126);
  - `POST /v1/admin/pricing/books/drafts` (from a version, or a suggested conversion), `PUT …/drafts/:id`, `DELETE …/drafts/:id`, and `POST …/drafts/:id/publish` with `{ effectiveFrom }`;
  - `POST …/drafts/:id/preview`: quotes sample sizes against the draft and the live version, for T-177b;
  - `GET|POST /v1/admin/pricing/promos` (paged), `PATCH /v1/admin/pricing/promos/:id`, and `GET …/promos/:id/redemptions` (paged, by market).
  - An edit to a published version answers **409 `VERSION_PUBLISHED`** and names the endpoint that creates a draft from it.
- **Contracts:** draft, publish, promo create/update and quote view schemas in `packages/contracts/src/pricing.ts`. Each book that enters still passes `priceBookSchema`, so the domain checks run.

### 8. Tests
- **Database integration** (`packages/db/src/price-books.integration.test.ts`; the existing `pricing.integration.test.ts` covers buyer personas):
  - the runtime role can't touch the tables;
  - a published version refuses an UPDATE;
  - a second open draft per currency is refused;
  - a quote binds its version and re-reads unchanged after a new version is published;
  - organization B can't read organization A's quote;
  - a non-operator gets an error from every operator function;
  - a promo's cap holds under two concurrent redemptions.
- **API, one per acceptance item:**
  - publishing USD v2 changes a fresh quote while the earlier quote re-shows byte-identical;
  - an edit of a published (and quoted) version is refused, and a draft from it publishes as v2;
  - a JPY-scoped promo applies to a JPY quote and is refused (`WRONG_MARKET`) on a USD one;
  - the audit log lists every book and promo change;
  - a non-operator gets 403.
- **Existing suites** stay green, e2e included (this task adds no UI).

### 9. Migration and rollback
- **One migration**, `20270119000000_pricing_storage`, expand-only: five tables, their triggers, functions and grants, plus the USD v1 seed. It changes no existing table or function.
- **Rollback:** drop the functions, then `pricing_promo_redemptions`, `pricing_promo_changes`, `pact_quote_lines`, `pact_quotes`, `pricing_promos`, `price_book_bands` and `price_book_versions`. Nothing else reads them.

## Decisions for Kumar
1. **Freeze a version at publish** (proposed), or only once it has quoted, as the brief says?
2. **A separate `pricing_promos` table** sharing one code namespace with T-087's `promo_codes` (proposed), or one widened table?
3. **Quote validity:** 30 days (proposed)?
4. **Seed USD v1** from the T-177 numbers in the migration (proposed), with the other markets refusing quotes until you author their books?
5. **Who may quote:** owners and admins only (proposed), or every member?
6. **Count a promo redemption at purchase** (proposed) rather than at quote time?

## Kumar's decisions (2026-11-27)
1. **A version freezes at publish.** Once published, a version never changes, and any edit makes a new version.
2. **A separate `pricing_promos` table,** sharing one code namespace with T-087's `promo_codes` (the proposal, accepted).
3. **A quote is valid for 30 days.**
4. **Only USD v1 is seeded,** from the T-177 numbers. GBP, EUR, JPY and INR refuse quotes until Kumar authors their books (T-177b).
5. **Owners and admins only** may quote, the same people who can buy today.
6. **A redemption counts at purchase,** not at quote time (the proposal, accepted).

## Out of scope
The console screen (T-177b), Stripe checkout from a quote and refunds (T-177c), reseller codes and commissions (T-093), and any true-up of the variable after purchase (a T-177 non-goal).
