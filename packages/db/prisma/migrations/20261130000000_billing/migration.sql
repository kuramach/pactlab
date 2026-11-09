-- Billing and promo codes (T-087, ADR 0025). Expand-only: new tables, one nullable deal column,
-- new functions. Billing state changes mostly from verified Stripe webhooks, which have no signed-in
-- user, so — like sign-in state — it is reached only through SECURITY DEFINER functions owned by a
-- no-login role, `pactlab_billing`. The runtime role cannot read or write these tables directly.
-- Stripe is the source of truth for money; these rows mirror it for entitlement checks.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pactlab_billing') THEN
    CREATE ROLE pactlab_billing NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
GRANT pactlab_billing TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO pactlab_billing;

-- A pact's live period (12 months; 6 for a sale). After it, the pact is read-only (T-087b).
ALTER TABLE "deals" ADD COLUMN "live_until" TIMESTAMPTZ(3);

-- The price book: data, not code. Amounts are for display and audit; Stripe charges its price.
CREATE TABLE "billing_plans" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "interval" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "pacts_included" INTEGER,
    "overage_amount" DECIMAL(12,2),
    "grants" TEXT NOT NULL,
    "self_serve" BOOLEAN NOT NULL,
    "stripe_price_id" TEXT,
    "display" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "billing_plans_kind" CHECK ("kind" IN ('ONE_TIME', 'SUBSCRIPTION') AND ("kind" = 'SUBSCRIPTION') = ("interval" IS NOT NULL) AND ("interval" IS NULL OR "interval" IN ('month', 'year'))),
    CONSTRAINT "billing_plans_grants" CHECK ("grants" IN ('PACT', 'VENTURE_ROUND', 'SELL_SIDE')),
    CONSTRAINT "billing_plans_amounts" CHECK ("amount" >= 0 AND ("overage_amount" IS NULL OR "overage_amount" >= 0) AND ("pacts_included" IS NULL OR "pacts_included" >= 0))
);

-- One per organization: the mirror of its Stripe customer and subscription.
CREATE TABLE "billing_accounts" (
    "organization_id" UUID NOT NULL,
    "stripe_customer_id" TEXT,
    "plan_key" TEXT,
    "subscription_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "pacts_used" INTEGER NOT NULL DEFAULT 0,
    "pending_promo_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "billing_accounts_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "billing_accounts_plan_fkey" FOREIGN KEY ("plan_key") REFERENCES "billing_plans"("key") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "billing_accounts_status" CHECK ("status" IN ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED')),
    CONSTRAINT "billing_accounts_used" CHECK ("pacts_used" >= 0)
);
CREATE UNIQUE INDEX "billing_accounts_customer_key" ON "billing_accounts"("stripe_customer_id");
CREATE UNIQUE INDEX "billing_accounts_subscription_key" ON "billing_accounts"("subscription_id");

-- Admin-made promo codes: a discount (mirrored to a Stripe promotion code) or free pacts.
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "percent_off" DECIMAL(5,2),
    "amount_off" DECIMAL(12,2),
    "currency" CHAR(3),
    "duration" TEXT,
    "duration_months" INTEGER,
    "plan_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "free_pacts" INTEGER,
    "packs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),
    "max_redemptions" INTEGER,
    "skips_approval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stripe_promotion_code_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promo_codes_code_format" CHECK ("code" ~ '^[A-Z0-9-]{4,40}$'),
    CONSTRAINT "promo_codes_kind" CHECK (
      ("kind" = 'DISCOUNT' AND "free_pacts" IS NULL AND (("percent_off" IS NOT NULL AND "percent_off" > 0 AND "percent_off" <= 100 AND "amount_off" IS NULL)
        OR ("amount_off" IS NOT NULL AND "amount_off" > 0 AND "currency" IS NOT NULL AND "percent_off" IS NULL))
        AND "duration" IN ('ONCE', 'REPEATING', 'FOREVER') AND (("duration" = 'REPEATING') = ("duration_months" IS NOT NULL)))
      OR ("kind" = 'FREE_PACTS' AND "free_pacts" BETWEEN 1 AND 100 AND "percent_off" IS NULL AND "amount_off" IS NULL AND "duration" IS NULL)
    ),
    CONSTRAINT "promo_codes_window" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
    CONSTRAINT "promo_codes_max" CHECK ("max_redemptions" IS NULL OR "max_redemptions" >= 1)
);
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promo_redemptions_promo_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promo_redemptions_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "promo_redemptions_once_key" ON "promo_redemptions"("promo_id", "organization_id");

-- Failed code checks, for the per-address limit.
CREATE TABLE "promo_attempts" (
    "id" UUID NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "promo_attempts_ip_hash_created_at_idx" ON "promo_attempts"("ip_hash", "created_at");

ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_pending_promo_fkey" FOREIGN KEY ("pending_promo_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A pact credit: bought, comped, or from a promo; optionally only for some packs.
CREATE TABLE "pact_credits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stripe_event_id" TEXT,
    "promo_id" UUID,
    "comped_by" UUID,
    "packs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_deal_id" UUID,
    "consumed_at" TIMESTAMPTZ(3),
    CONSTRAINT "pact_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pact_credits_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pact_credits_promo_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pact_credits_kind" CHECK ("kind" IN ('PACT', 'VENTURE_ROUND', 'SELL_SIDE')),
    CONSTRAINT "pact_credits_source" CHECK (
      ("source" = 'PURCHASE' AND "stripe_event_id" IS NOT NULL) OR ("source" = 'COMP' AND "comped_by" IS NOT NULL) OR ("source" = 'PROMO' AND "promo_id" IS NOT NULL)),
    CONSTRAINT "pact_credits_consumed" CHECK (("consumed_deal_id" IS NULL) = ("consumed_at" IS NULL))
);
-- A Stripe event grants at most one credit, so a replay grants nothing.
CREATE UNIQUE INDEX "pact_credits_stripe_event_key" ON "pact_credits"("stripe_event_id");
CREATE INDEX "pact_credits_organization_open_idx" ON "pact_credits"("organization_id", "kind") WHERE "consumed_at" IS NULL;

-- Every Stripe event handled, once.
CREATE TABLE "stripe_events" (
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("event_id")
);

-- The launch price book (ADR 0025). Stripe price ids are set per environment by the ops script.
INSERT INTO billing_plans (key, kind, interval, amount, currency, pacts_included, overage_amount, grants, self_serve, display) VALUES
  ('PACT', 'ONE_TIME', NULL, 2500.00, 'USD', NULL, NULL, 'PACT', true, '{"name": "Pact", "summary": "One buyer pact, every module, unlimited users. Live for 12 months, then read-only."}'),
  ('TEAM_ANNUAL', 'SUBSCRIPTION', 'year', 18000.00, 'USD', 10, 1500.00, 'PACT', true, '{"name": "Team (annual)", "summary": "10 pacts a year, extra pacts $1,500 each, unlimited users."}'),
  ('TEAM_MONTHLY', 'SUBSCRIPTION', 'month', 1800.00, 'USD', 10, 1500.00, 'PACT', true, '{"name": "Team (monthly)", "summary": "10 pacts a year, billed monthly."}'),
  ('VENTURE_MONTHLY', 'SUBSCRIPTION', 'month', 99.00, 'USD', NULL, NULL, 'VENTURE_ROUND', true, '{"name": "Venture Raise (monthly)", "summary": "Your raise: claims, investor offers and the round model."}'),
  ('VENTURE_ANNUAL', 'SUBSCRIPTION', 'year', 990.00, 'USD', NULL, NULL, 'VENTURE_ROUND', true, '{"name": "Venture Raise (annual)", "summary": "Two months free."}'),
  ('VENTURE_ROUND', 'ONE_TIME', NULL, 500.00, 'USD', NULL, NULL, 'VENTURE_ROUND', true, '{"name": "Venture Raise (one round)", "summary": "One round, start to close."}'),
  ('FIRM_ANNUAL', 'SUBSCRIPTION', 'year', 42000.00, 'USD', 30, 1500.00, 'PACT', false, '{"name": "Firm", "summary": "30 pacts a year, company SSO, confidential MCP, DocuSign, invoice billing."}'),
  ('SELL_SIDE', 'ONE_TIME', NULL, 1500.00, 'USD', NULL, NULL, 'SELL_SIDE', false, '{"name": "Sell-side", "summary": "One sale: teaser, bidders, Q&A and close. Live for 6 months."}');

-- ---------------------------------------------------------------------------
-- Access: pactlab_billing only, through the functions below.
-- ---------------------------------------------------------------------------
ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE pact_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE pact_credits FORCE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_redemptions FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_attempts FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON billing_plans, billing_accounts, pact_credits, stripe_events, promo_codes, promo_redemptions, promo_attempts TO pactlab_billing;
GRANT SELECT (id, name, slug, status) ON organizations TO pactlab_billing;
GRANT SELECT (organization_id, user_id, status, role) ON organization_memberships TO pactlab_billing;
GRANT SELECT (organization_id, pilot_mode) ON organization_flags TO pactlab_billing;
GRANT SELECT (id, organization_id, live_until) ON deals TO pactlab_billing;
GRANT UPDATE (live_until) ON deals TO pactlab_billing;
GRANT SELECT, INSERT ON audit_events TO pactlab_billing;

CREATE POLICY billing_plans_billing ON billing_plans FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY billing_accounts_billing ON billing_accounts FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY pact_credits_billing ON pact_credits FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY stripe_events_billing ON stripe_events FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY promo_codes_billing ON promo_codes FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY promo_redemptions_billing ON promo_redemptions FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY promo_attempts_billing ON promo_attempts FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY organizations_billing ON organizations FOR SELECT TO pactlab_billing USING (true);
CREATE POLICY organization_memberships_billing ON organization_memberships FOR SELECT TO pactlab_billing USING (true);
CREATE POLICY organization_flags_billing ON organization_flags FOR SELECT TO pactlab_billing USING (true);
CREATE POLICY deals_billing ON deals FOR SELECT TO pactlab_billing USING (true);
CREATE POLICY deals_billing_live_until ON deals FOR UPDATE TO pactlab_billing USING (true) WITH CHECK (true);
-- The audit chain trigger reads the previous link of the organization's chain.
CREATE POLICY audit_events_billing_select ON audit_events FOR SELECT TO pactlab_billing USING (true);
CREATE POLICY audit_events_billing_insert ON audit_events FOR INSERT TO pactlab_billing
  WITH CHECK (action LIKE 'billing.%' OR action LIKE 'promo.%');
GRANT EXECUTE ON FUNCTION app_ops_require(uuid) TO pactlab_billing;

CREATE FUNCTION app_billing_audit(p_org uuid, p_actor uuid, p_action text, p_target_type text, p_target text, p_outcome text DEFAULT 'SUCCEEDED', p_deal uuid DEFAULT NULL)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    VALUES (uuidv7(), p_org, p_deal, p_actor, p_action, p_target_type, p_target, p_outcome)
  $$;

-- The price book, for display and for building checkouts.
CREATE FUNCTION app_billing_plans()
  RETURNS TABLE (key text, kind text, "interval" text, amount numeric, currency text, pacts_included integer, overage_amount numeric, grants text, self_serve boolean, stripe_price_id text, display jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT p.key, p.kind, p.interval, p.amount, p.currency, p.pacts_included, p.overage_amount, p.grants, p.self_serve, p.stripe_price_id, p.display
      FROM billing_plans p WHERE p.active ORDER BY p.amount
  $$;

-- An organization's billing state, for an active member of it. No row for anyone else.
CREATE FUNCTION app_billing_state(p_org uuid, p_user uuid)
  RETURNS TABLE (stripe_customer_id text, plan_key text, status text, period_start timestamptz, period_end timestamptz, pacts_used integer,
                 pacts_included integer, pilot boolean, credits jsonb, pending_promo text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT a.stripe_customer_id, a.plan_key, coalesce(a.status, 'NONE'), a.period_start, a.period_end, coalesce(a.pacts_used, 0),
           p.pacts_included, coalesce(f.pilot_mode, false),
           coalesce((SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'source', c.source, 'packs', c.packs) ORDER BY c.granted_at)
                       FROM pact_credits c WHERE c.organization_id = o.id AND c.consumed_at IS NULL), '[]'::jsonb),
           (SELECT pc.code FROM promo_codes pc WHERE pc.id = a.pending_promo_id)
      FROM organizations o
      LEFT JOIN billing_accounts a ON a.organization_id = o.id
      LEFT JOIN billing_plans p ON p.key = a.plan_key
      LEFT JOIN organization_flags f ON f.organization_id = o.id
     WHERE o.id = p_org
       AND EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = p_org AND m.user_id = p_user AND m.status = 'ACTIVE')
  $$;

-- Record a Stripe event once. False when it was already handled (a replay).
CREATE FUNCTION app_billing_event_begin(p_event_id text, p_type text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  INSERT INTO stripe_events (event_id, type) VALUES (p_event_id, p_type) ON CONFLICT (event_id) DO NOTHING;
  RETURN FOUND;
END
$$;

-- Attach a Stripe customer to an organization (first checkout).
CREATE FUNCTION app_billing_link_customer(p_org uuid, p_customer text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO billing_accounts (organization_id, stripe_customer_id) VALUES (p_org, p_customer)
    ON CONFLICT (organization_id) DO UPDATE SET stripe_customer_id = coalesce(billing_accounts.stripe_customer_id, EXCLUDED.stripe_customer_id), updated_at = now()
  $$;

CREATE FUNCTION app_billing_organization_of_customer(p_customer text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT a.organization_id FROM billing_accounts a WHERE a.stripe_customer_id = p_customer $$;

-- A paid one-time purchase: one credit of the plan's kind, once per Stripe event.
CREATE FUNCTION app_billing_grant_purchase(p_org uuid, p_plan text, p_event_id text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_kind text := (SELECT p.grants FROM billing_plans p WHERE p.key = p_plan AND p.kind = 'ONE_TIME');
BEGIN
  IF v_kind IS NULL OR NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org) THEN
    RETURN false;
  END IF;
  INSERT INTO pact_credits (id, organization_id, kind, source, stripe_event_id) VALUES (uuidv7(), p_org, v_kind, 'PURCHASE', p_event_id)
  ON CONFLICT (stripe_event_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE billing_accounts SET pending_promo_id = NULL, updated_at = now() WHERE organization_id = p_org;
  PERFORM app_billing_audit(p_org, NULL, 'billing.credit_granted', 'pact_credit', p_plan);
  RETURN true;
END
$$;

-- The subscription as Stripe reports it. `p_new_period` resets usage when the period start moved.
CREATE FUNCTION app_billing_set_subscription(p_org uuid, p_customer text, p_subscription text, p_plan text, p_status text,
                                             p_period_start timestamptz, p_period_end timestamptz, p_new_period boolean)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid := coalesce(p_org, (SELECT a.organization_id FROM billing_accounts a WHERE a.subscription_id = p_subscription),
                         (SELECT a.organization_id FROM billing_accounts a WHERE a.stripe_customer_id = p_customer));
  v_before text;
BEGIN
  IF v_org IS NULL OR p_status NOT IN ('ACTIVE', 'PAST_DUE', 'CANCELED') THEN
    RETURN false;
  END IF;
  IF p_plan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM billing_plans p WHERE p.key = p_plan AND p.kind = 'SUBSCRIPTION') THEN
    RETURN false;
  END IF;
  SELECT a.status INTO v_before FROM billing_accounts a WHERE a.organization_id = v_org FOR UPDATE;
  INSERT INTO billing_accounts (organization_id, stripe_customer_id, plan_key, subscription_id, status, period_start, period_end)
  VALUES (v_org, p_customer, p_plan, p_subscription, p_status, p_period_start, p_period_end)
  ON CONFLICT (organization_id) DO UPDATE SET
    stripe_customer_id = coalesce(EXCLUDED.stripe_customer_id, billing_accounts.stripe_customer_id),
    plan_key = coalesce(EXCLUDED.plan_key, billing_accounts.plan_key),
    subscription_id = coalesce(EXCLUDED.subscription_id, billing_accounts.subscription_id),
    status = EXCLUDED.status,
    period_start = coalesce(EXCLUDED.period_start, billing_accounts.period_start),
    period_end = coalesce(EXCLUDED.period_end, billing_accounts.period_end),
    -- Only a period that really changed resets usage, so a replayed invoice event changes nothing.
    pacts_used = CASE WHEN p_new_period AND EXCLUDED.period_start IS NOT NULL AND EXCLUDED.period_start IS DISTINCT FROM billing_accounts.period_start THEN 0 ELSE billing_accounts.pacts_used END,
    pending_promo_id = CASE WHEN p_status = 'ACTIVE' THEN NULL ELSE billing_accounts.pending_promo_id END,
    updated_at = now();
  IF v_before IS DISTINCT FROM p_status THEN
    PERFORM app_billing_audit(v_org, NULL, 'billing.status_changed', 'billing_account', p_status);
  END IF;
  RETURN true;
END
$$;

-- Starting a pact: decide and record what pays for it, atomically with the pact insert (same
-- transaction). Returns PILOT, FREE (enforcement off), ALLOWANCE, CREDIT, or NULL (payment required).
CREATE FUNCTION app_billing_consume(p_org uuid, p_deal uuid, p_kind text, p_company_type text, p_enforce boolean) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_account billing_accounts%ROWTYPE;
  v_plan billing_plans%ROWTYPE;
  v_credit uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = p_deal AND d.organization_id = p_org) THEN
    RAISE EXCEPTION 'no such pact' USING ERRCODE = 'P0002';
  END IF;
  -- Every pact gets its live period (12 months; 6 for a sale), however it is paid for.
  UPDATE deals SET live_until = now() + make_interval(months => CASE WHEN p_kind = 'SELL_SIDE' THEN 6 ELSE 12 END)
   WHERE id = p_deal AND live_until IS NULL;
  IF coalesce((SELECT f.pilot_mode FROM organization_flags f WHERE f.organization_id = p_org), false) THEN
    RETURN 'PILOT';
  END IF;
  SELECT * INTO v_account FROM billing_accounts a WHERE a.organization_id = p_org FOR UPDATE;
  SELECT * INTO v_plan FROM billing_plans p WHERE p.key = v_account.plan_key;
  -- A subscription in good standing covers its kind, within its allowance (NULL: unlimited).
  IF FOUND AND v_account.status = 'ACTIVE' AND v_plan.grants = p_kind AND (v_account.period_end IS NULL OR v_account.period_end > now())
     AND (v_plan.pacts_included IS NULL OR v_account.pacts_used < v_plan.pacts_included) THEN
    UPDATE billing_accounts SET pacts_used = pacts_used + 1, updated_at = now() WHERE organization_id = p_org;
    PERFORM app_billing_audit(p_org, NULL, 'billing.credit_consumed', 'deal', p_deal::text, 'SUCCEEDED', p_deal);
    RETURN 'ALLOWANCE';
  END IF;
  -- Otherwise an unused credit of this kind, for this pack (or any pack). Oldest first.
  SELECT c.id INTO v_credit FROM pact_credits c
   WHERE c.organization_id = p_org AND c.kind = p_kind AND c.consumed_at IS NULL
     AND (cardinality(c.packs) = 0 OR p_company_type = ANY (c.packs))
   ORDER BY c.granted_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_credit IS NOT NULL THEN
    UPDATE pact_credits SET consumed_deal_id = p_deal, consumed_at = now() WHERE id = v_credit;
    PERFORM app_billing_audit(p_org, NULL, 'billing.credit_consumed', 'deal', p_deal::text, 'SUCCEEDED', p_deal);
    RETURN 'CREDIT';
  END IF;
  IF NOT p_enforce THEN
    RETURN 'FREE';
  END IF;
  RETURN NULL;
END
$$;

-- Operators ---------------------------------------------------------------------------------------

CREATE FUNCTION app_billing_admin_accounts(p_actor uuid)
  RETURNS TABLE (organization_id uuid, plan_key text, status text, period_end timestamptz, pacts_used integer, open_credits integer, stripe_customer_id text, subscription_id text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT o.id, a.plan_key, coalesce(a.status, 'NONE'), a.period_end, coalesce(a.pacts_used, 0),
           (SELECT count(*)::int FROM pact_credits c WHERE c.organization_id = o.id AND c.consumed_at IS NULL),
           a.stripe_customer_id, a.subscription_id
      FROM organizations o LEFT JOIN billing_accounts a ON a.organization_id = o.id;
END
$$;

CREATE FUNCTION app_billing_comp(p_actor uuid, p_org uuid, p_kind text, p_packs text[]) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
BEGIN
  PERFORM app_ops_require(p_actor);
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org) THEN RAISE EXCEPTION 'no organization' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO pact_credits (id, organization_id, kind, source, comped_by, packs) VALUES (v_id, p_org, p_kind, 'COMP', p_actor, coalesce(p_packs, ARRAY[]::text[]));
  PERFORM app_billing_audit(p_org, p_actor, 'billing.credit_comped', 'pact_credit', v_id::text);
  RETURN v_id;
END
$$;

-- Set a plan's Stripe price id for this environment (operators, or the schema owner in an ops task).
CREATE FUNCTION app_billing_set_price(p_actor uuid, p_key text, p_price_id text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE billing_plans SET stripe_price_id = p_price_id, updated_at = now() WHERE key = p_key;
  RETURN FOUND;
END
$$;

-- Promo codes -------------------------------------------------------------------------------------

CREATE FUNCTION app_promo_create(p_actor uuid, p_code text, p_description text, p_kind text, p_percent_off numeric, p_amount_off numeric, p_currency text,
                                 p_duration text, p_duration_months integer, p_plan_keys text[], p_free_pacts integer, p_packs text[],
                                 p_valid_from timestamptz, p_valid_until timestamptz, p_max_redemptions integer, p_skips_approval boolean)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
BEGIN
  PERFORM app_ops_require(p_actor);
  INSERT INTO promo_codes (id, code, description, kind, percent_off, amount_off, currency, duration, duration_months, plan_keys, free_pacts, packs,
                           valid_from, valid_until, max_redemptions, skips_approval, created_by)
  VALUES (v_id, upper(btrim(p_code)), btrim(p_description), p_kind, p_percent_off, p_amount_off, p_currency, p_duration, p_duration_months,
          coalesce(p_plan_keys, ARRAY[]::text[]), p_free_pacts, coalesce(p_packs, ARRAY[]::text[]), coalesce(p_valid_from, now()), p_valid_until,
          p_max_redemptions, p_skips_approval, p_actor);
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  SELECT uuidv7(), m.organization_id, NULL, p_actor, 'promo.created', 'promo_code', upper(btrim(p_code)), 'SUCCEEDED'
    FROM organization_memberships m WHERE m.user_id = p_actor AND m.status = 'ACTIVE' ORDER BY m.organization_id LIMIT 1;
  RETURN v_id;
END
$$;

CREATE FUNCTION app_promo_set_stripe(p_actor uuid, p_id uuid, p_promotion_code text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE promo_codes SET stripe_promotion_code_id = p_promotion_code WHERE id = p_id;
END
$$;

CREATE FUNCTION app_promo_deactivate(p_actor uuid, p_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_code text;
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE promo_codes SET active = false WHERE id = p_id AND active RETURNING code INTO v_code;
  IF v_code IS NULL THEN RETURN false; END IF;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  SELECT uuidv7(), m.organization_id, NULL, p_actor, 'promo.deactivated', 'promo_code', v_code, 'SUCCEEDED'
    FROM organization_memberships m WHERE m.user_id = p_actor AND m.status = 'ACTIVE' ORDER BY m.organization_id LIMIT 1;
  RETURN true;
END
$$;

CREATE FUNCTION app_promo_list(p_actor uuid)
  RETURNS TABLE (id uuid, code text, description text, kind text, percent_off numeric, amount_off numeric, currency text, duration text, duration_months integer,
                 plan_keys text[], free_pacts integer, packs text[], valid_from timestamptz, valid_until timestamptz, max_redemptions integer,
                 skips_approval boolean, active boolean, redemptions integer, stripe_promotion_code_id text, created_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT c.id, c.code, c.description, c.kind, c.percent_off, c.amount_off, c.currency::text, c.duration, c.duration_months, c.plan_keys, c.free_pacts, c.packs,
           c.valid_from, c.valid_until, c.max_redemptions, c.skips_approval, c.active,
           (SELECT count(*)::int FROM promo_redemptions r WHERE r.promo_id = c.id), c.stripe_promotion_code_id, c.created_at
      FROM promo_codes c ORDER BY c.created_at DESC;
END
$$;

-- Is a code usable right now? Failed checks are counted per address: after 20 in an hour every
-- check fails (RATE_LIMITED), so codes can't be guessed. Reasons: OK, UNKNOWN, INACTIVE, NOT_YET,
-- EXPIRED, USED_UP, RATE_LIMITED.
CREATE FUNCTION app_promo_check(p_code text, p_ip_hash text)
  RETURNS TABLE (reason text, id uuid, kind text, skips_approval boolean, free_pacts integer, packs text[], percent_off numeric, amount_off numeric, currency text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v promo_codes%ROWTYPE;
  v_reason text;
BEGIN
  IF (SELECT count(*) FROM promo_attempts a WHERE a.ip_hash = p_ip_hash AND a.created_at > now() - interval '1 hour') >= 20 THEN
    RETURN QUERY SELECT 'RATE_LIMITED'::text, NULL::uuid, NULL::text, NULL::boolean, NULL::integer, NULL::text[], NULL::numeric, NULL::numeric, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v FROM promo_codes c WHERE c.code = upper(btrim(p_code));
  v_reason := CASE
    WHEN NOT FOUND THEN 'UNKNOWN'
    WHEN NOT v.active THEN 'INACTIVE'
    WHEN v.valid_from > now() THEN 'NOT_YET'
    WHEN v.valid_until IS NOT NULL AND v.valid_until <= now() THEN 'EXPIRED'
    WHEN v.max_redemptions IS NOT NULL AND (SELECT count(*) FROM promo_redemptions r WHERE r.promo_id = v.id) >= v.max_redemptions THEN 'USED_UP'
    ELSE 'OK' END;
  IF v_reason <> 'OK' THEN
    INSERT INTO promo_attempts (id, ip_hash) VALUES (uuidv7(), p_ip_hash);
    RETURN QUERY SELECT v_reason, NULL::uuid, NULL::text, NULL::boolean, NULL::integer, NULL::text[], NULL::numeric, NULL::numeric, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v.id, v.kind, v.skips_approval, v.free_pacts, v.packs, v.percent_off, v.amount_off, v.currency::text;
END
$$;

-- Redeem a checked-OK code for an organization (sign-up, or Settings by an org admin): once per
-- organization, within the limits. FREE_PACTS grants its credits; DISCOUNT is kept for the next
-- checkout. Returns REDEEMED or the reason it can't be (ALREADY, plus app_promo_check's reasons).
CREATE FUNCTION app_promo_redeem(p_code text, p_org uuid, p_actor uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v promo_codes%ROWTYPE;
  v_reason text;
BEGIN
  SELECT * INTO v FROM promo_codes c WHERE c.code = upper(btrim(p_code)) FOR UPDATE;
  v_reason := CASE
    WHEN NOT FOUND THEN 'UNKNOWN'
    WHEN NOT v.active THEN 'INACTIVE'
    WHEN v.valid_from > now() THEN 'NOT_YET'
    WHEN v.valid_until IS NOT NULL AND v.valid_until <= now() THEN 'EXPIRED'
    WHEN v.max_redemptions IS NOT NULL AND (SELECT count(*) FROM promo_redemptions r WHERE r.promo_id = v.id) >= v.max_redemptions THEN 'USED_UP'
    WHEN EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.promo_id = v.id AND r.organization_id = p_org) THEN 'ALREADY'
    WHEN NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org) THEN 'UNKNOWN'
    ELSE 'REDEEMED' END;
  IF v_reason <> 'REDEEMED' THEN
    PERFORM app_billing_audit(p_org, p_actor, 'promo.rejected', 'promo_code', v_reason, 'DENIED')
      FROM organizations o WHERE o.id = p_org;
    RETURN v_reason;
  END IF;
  INSERT INTO promo_redemptions (id, promo_id, organization_id) VALUES (uuidv7(), v.id, p_org);
  IF v.kind = 'FREE_PACTS' THEN
    INSERT INTO pact_credits (id, organization_id, kind, source, promo_id, packs)
    SELECT uuidv7(), p_org, 'PACT', 'PROMO', v.id, v.packs FROM generate_series(1, v.free_pacts);
  ELSE
    INSERT INTO billing_accounts (organization_id, pending_promo_id) VALUES (p_org, v.id)
    ON CONFLICT (organization_id) DO UPDATE SET pending_promo_id = EXCLUDED.pending_promo_id, updated_at = now();
  END IF;
  PERFORM app_billing_audit(p_org, p_actor, 'promo.redeemed', 'promo_code', v.code);
  RETURN 'REDEEMED';
END
$$;

-- The Stripe promotion code to apply at checkout for this organization and plan, if any.
CREATE FUNCTION app_billing_checkout_discount(p_org uuid, p_plan text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT c.stripe_promotion_code_id FROM billing_accounts a JOIN promo_codes c ON c.id = a.pending_promo_id
     WHERE a.organization_id = p_org AND c.active AND c.stripe_promotion_code_id IS NOT NULL
       AND (cardinality(c.plan_keys) = 0 OR p_plan = ANY (c.plan_keys))
       AND (c.valid_until IS NULL OR c.valid_until > now())
  $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_billing_audit(uuid, uuid, text, text, text, text, uuid)', 'app_billing_plans()', 'app_billing_state(uuid, uuid)',
    'app_billing_event_begin(text, text)', 'app_billing_link_customer(uuid, text)', 'app_billing_organization_of_customer(text)',
    'app_billing_grant_purchase(uuid, text, text)', 'app_billing_set_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean)',
    'app_billing_consume(uuid, uuid, text, text, boolean)', 'app_billing_admin_accounts(uuid)', 'app_billing_comp(uuid, uuid, text, text[])',
    'app_billing_set_price(uuid, text, text)',
    'app_promo_create(uuid, text, text, text, numeric, numeric, text, text, integer, text[], integer, text[], timestamptz, timestamptz, integer, boolean)',
    'app_promo_set_stripe(uuid, uuid, text)', 'app_promo_deactivate(uuid, uuid)', 'app_promo_list(uuid)', 'app_promo_check(text, text)',
    'app_promo_redeem(text, uuid, uuid)', 'app_billing_checkout_discount(uuid, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_billing', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    -- The audit helper is internal: only the other billing functions call it.
    IF fn NOT LIKE 'app_billing_audit%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
    END IF;
  END LOOP;
END
$$;
