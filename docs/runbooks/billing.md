# Billing and promo codes (T-087, ADR 0025)

Stripe is the source of truth for money. Pactlab mirrors it to decide whether a pact can start. Card details never reach Pactlab: Checkout and the Customer Portal are hosted by Stripe.

## How it works
- **Plans:** the price book is the `billing_plans` table, seeded with ADR 0025's prices.
  - **Self-serve:** Pact, Team and Venture Raise.
  - **On request:** Firm and Sell-side (an operator comps or arranges these).
- **Starting a pact** is paid for, in order, by:
  1. **Pilot:** the organization's `pilotMode` flag; always free;
  2. **Subscription allowance:** Team is 10 per period;
  3. **A prepaid credit:** bought, comped, or from a promo code. A credit limited to certain packs only pays for those packs.
- **When payment is required:** with nothing left, the pact isn't created and the person is pointed to Settings → Billing.
- **`BILLING_ENFORCEMENT=off`** (the default): nothing is gated; purchases and credits still count.
- **Past due or canceled:** existing pacts stay open; only new pacts are blocked.
- **Live period:** each pact is live for 12 months (6 for a sale). After that it's meant to be read-only, but enforcement isn't built yet (T-087b).
- **Webhook:** `POST /v1/webhooks/stripe`.
  - The signature is checked over the raw body.
  - Every handler is idempotent, so Stripe's retries change nothing.
  - Access is never granted from a browser redirect.

## Promo codes (Admin → Promo codes)
- **Free pacts:** N credits, optionally only for some packs.
- **Discount:** percent or amount off; once, for N months, or forever; optionally only on some plans. Creating one also creates the matching Stripe coupon and promotion code.
- **Limits on every code:**
  - optional start and end dates and a maximum number of redemptions;
  - at most one use per organization;
  - "skips approval" (the default): a new sign-up with the code is ACTIVE at once, with no approval queue.
- **Where people enter codes:** on the sign-up form, or in Settings → Billing → "Have a promo code?". A discount applies at that organization's next checkout.
- **Guessing:** wrong codes are limited to 20 an hour per address.
- **To stop a code:** Admin → Promo codes → Deactivate.

## Per-deal price books and pact promos (T-177a, ADR 0061)
There is no console screen yet (T-177b); operators use the API under `/v1/admin/pricing`.
- **Markets:** USD v1 is seeded ($5,000 fixed; 5, 2 and 1 bps; $50,000 cap; $5,000 pilot). GBP, EUR, JPY and INR refuse quotes until a book is published for them.
- **Change a price:** `POST /v1/admin/pricing/books/drafts` with `fromVersionId` (or `suggest` to start a new market from a converted book, rate and date kept), edit it with `PUT …/drafts/:id`, compare with `POST …/drafts/:id/preview`, then `POST …/drafts/:id/publish` (now, or a later `effectiveFrom`; never earlier). A published version never changes: an edit answers 422 `VERSION_PUBLISHED`. Fresh quotes use the new version from its effective time, with no deploy.
- **Quotes:** owners and admins quote with `POST /v1/pricing/quotes`; a quote keeps its version's price for 30 days and re-shows from its stored lines (`GET /v1/pricing/quotes/:id`).
- **Pact promos** (`/v1/admin/pricing/promos`): percent off the total or the fixed fee, an amount off, the variable waived, or a pilot flat price; markets (empty is global; an amount is valid only in its own currency), a window, a total cap and a per-organization cap, stackable or not, any organization, pilots only or named organizations. Pause, resume or expire with `PATCH …/promos/:id`; the effect is frozen once a code has been used. A use is counted when the pact is bought (`…/promos/:id/redemptions`, by market). Codes share one namespace with the organization promo codes above.
- **Audit events:** `pricing.book_drafted`, `pricing.book_draft_updated`, `pricing.book_draft_discarded`, `pricing.book_published`, `pricing.promo_created`, `pricing.promo_updated`, `pricing.promo_paused`, `pricing.promo_resumed`, `pricing.promo_expired` (under the operator's organization), `pricing.quote_created` and `pricing.quote_consumed` (under the buyer's). Each promo change is also kept field by field in `pricing_promo_changes`.

## Support
- **Give a free pact:** Admin → Organizations → Comp a pact (audited as `billing.credit_comped`).
- **A payment didn't show up:** Admin → Organizations → Resync, which re-reads the subscription from Stripe. Check the Stripe dashboard's webhook log for failed deliveries.
- **Refunds:** done in the Stripe dashboard. A refunded one-time purchase doesn't remove the credit automatically; if it's unused, ask engineering to void it.
- **Reconcile everything:** `scripts/ops-task.sh <env> src/ops/billing-reconcile.ts` re-mirrors every subscription. Run it nightly; scheduling it is part of T-087b.
- **Audit events:** `billing.checkout_started`, `billing.credit_granted`, `billing.credit_consumed`, `billing.credit_comped`, `billing.status_changed`, `promo.created`, `promo.deactivated`, `promo.redeemed`, `promo.rejected`.

## Local and test runs
With no Stripe keys, checkout goes to `/billing/fixture-checkout`, a stand-in that is never used in production. "Pay (test)" sends the same signed events Stripe would.

## Stage with Stripe test mode
1. In the Stripe dashboard, in **test mode**, create the products and prices from ADR 0025.
2. Put the test keys in SSM as `STRIPE_SECRET_KEY` (`sk_test_…`) and `STRIPE_WEBHOOK_SECRET`.
3. Add a webhook endpoint at `https://<stage>/v1/webhooks/stripe` for these events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Run `scripts/ops-task.sh stage src/ops/billing-plans.ts set PACT price_…` for each plan, then `… list` to check.
5. Buy a pact with card 4242 4242 4242 4242, confirm the credit appears, and open Manage billing.

## Go-live checklist (Kumar)
1. A legal entity, its EIN, and a business bank account.
2. The Stripe account activated, with live-mode products and prices created. Per-pact prices are no longer an open question: they are the price book's values (`docs/pricing-research.md` §6; ADR 0025 addendum T-177), one book per launch currency, each confirmed by Kumar in the console before its market goes live.
3. Live keys in SSM, and the live webhook endpoint registered with the events above.
4. `billing-plans.ts set` run for every plan on live.
5. The tax setting decided with a CPA (`STRIPE_AUTOMATIC_TAX`); VAT numbers are collected at checkout either way.
6. Terms, Privacy and DPA pages published.
7. A low-value live charge made, then refunded.
8. Existing customers marked pilot in Admin, or given credits.
9. `BILLING_ENFORCEMENT=on`.
10. Live sign-up approval switched off: `signupRequiresApproval: false` in `infra/cdk/config/prod.ts`.
