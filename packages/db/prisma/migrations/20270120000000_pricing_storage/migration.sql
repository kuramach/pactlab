-- Per-deal price books, pact promo codes and stored quotes (T-177a, ADR 0061). Expand-only: seven
-- new tables, their triggers and functions, one trigger on promo_codes (the shared code namespace)
-- and the USD v1 seed. Like T-087's billing state, the tables are reached only through SECURITY
-- DEFINER functions owned by `pactlab_billing`; the runtime role has no table privileges at all.
-- The arithmetic runs in TypeScript (packages/domain/src/pricing); these functions store what it
-- produced and re-check what they can (the version, the footing, the promo) before anything is kept.
--
-- Rollback: drop the functions below and the trigger promo_codes_shared_namespace, then
-- pricing_promo_redemptions, pricing_promo_changes, pact_quote_lines, pact_quotes, pricing_promos,
-- price_book_bands and price_book_versions. Nothing else reads them.

-- ---------------------------------------------------------------------------
-- Price book versions: one market (currency) each, versioned, frozen at publish.
-- ---------------------------------------------------------------------------
CREATE TABLE "price_book_versions" (
    "id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMPTZ(3),
    "fixed_fee" DECIMAL(21,6) NOT NULL,
    "variable_cap" DECIMAL(21,6) NOT NULL,
    "pilot_flat" DECIMAL(21,6) NOT NULL,
    "rounding" DECIMAL(21,6) NOT NULL,
    "base_documents" INTEGER NOT NULL,
    "base_ai_budget" DECIMAL(21,6) NOT NULL,
    "based_on_version_id" UUID,
    "suggested_from" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(3),
    "first_quoted_at" TIMESTAMPTZ(3),
    CONSTRAINT "price_book_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_book_versions_based_on_fkey" FOREIGN KEY ("based_on_version_id") REFERENCES "price_book_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "price_book_versions_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "price_book_versions_version" CHECK ("version" >= 1),
    CONSTRAINT "price_book_versions_status" CHECK ("status" IN ('DRAFT', 'PUBLISHED')),
    -- An effective time exactly when published; who and when with it.
    CONSTRAINT "price_book_versions_published" CHECK (("status" = 'PUBLISHED') = ("effective_from" IS NOT NULL) AND ("status" = 'PUBLISHED') = ("published_at" IS NOT NULL)),
    CONSTRAINT "price_book_versions_amounts" CHECK ("fixed_fee" >= 0 AND "variable_cap" > 0 AND "pilot_flat" >= 0 AND "rounding" > 0 AND "base_documents" >= 0 AND "base_ai_budget" >= 0),
    CONSTRAINT "price_book_versions_quoted" CHECK ("first_quoted_at" IS NULL OR "status" = 'PUBLISHED')
);
CREATE UNIQUE INDEX "price_book_versions_currency_version_key" ON "price_book_versions"("currency", "version");
-- At most one open draft per market.
CREATE UNIQUE INDEX "price_book_versions_one_draft_key" ON "price_book_versions"("currency") WHERE "status" = 'DRAFT';
CREATE INDEX "price_book_versions_live_idx" ON "price_book_versions"("currency", "effective_from" DESC, "version" DESC) WHERE "status" = 'PUBLISHED';
CREATE INDEX "price_book_versions_history_idx" ON "price_book_versions"("created_at" DESC, "id" DESC);

CREATE TABLE "price_book_bands" (
    "version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "up_to" DECIMAL(21,6),
    "bps" DECIMAL(5,2) NOT NULL,
    "documents" INTEGER NOT NULL,
    "ai_budget" DECIMAL(21,6) NOT NULL,
    CONSTRAINT "price_book_bands_pkey" PRIMARY KEY ("version_id", "position"),
    CONSTRAINT "price_book_bands_version_fkey" FOREIGN KEY ("version_id") REFERENCES "price_book_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "price_book_bands_position" CHECK ("position" BETWEEN 0 AND 9),
    CONSTRAINT "price_book_bands_values" CHECK ("bps" >= 0 AND "bps" <= 100 AND ("up_to" IS NULL OR "up_to" > 0) AND "documents" >= 0 AND "ai_budget" >= 0)
);

-- A published version and its bands never change; only the moment it first quoted is written, once.
CREATE FUNCTION app_price_book_version_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'VERSION_PUBLISHED' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    IF OLD.first_quoted_at IS NULL AND NEW.first_quoted_at IS NOT NULL
       AND (to_jsonb(NEW) - 'first_quoted_at') = (to_jsonb(OLD) - 'first_quoted_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'VERSION_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.currency <> OLD.currency OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'a version keeps its market and number' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER price_book_versions_guard BEFORE UPDATE OR DELETE ON price_book_versions FOR EACH ROW EXECUTE FUNCTION app_price_book_version_guard();

CREATE FUNCTION app_price_book_band_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_version uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
BEGIN
  -- A cascade from a draft's deletion finds no row: that is a draft, and allowed.
  IF EXISTS (SELECT 1 FROM price_book_versions v WHERE v.id = v_version AND v.status = 'PUBLISHED')
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM price_book_versions v WHERE v.id = OLD.version_id AND v.status = 'PUBLISHED')) THEN
    RAISE EXCEPTION 'VERSION_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER price_book_bands_guard BEFORE INSERT OR UPDATE OR DELETE ON price_book_bands FOR EACH ROW EXECUTE FUNCTION app_price_book_band_guard();

-- ---------------------------------------------------------------------------
-- Promo codes that change a pact's price, in every kind the engine knows.
-- ---------------------------------------------------------------------------
CREATE TABLE "pricing_promos" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "percent" DECIMAL(5,2),
    "amount" DECIMAL(21,6),
    "pilot_flat" DECIMAL(21,6),
    "currency" CHAR(3),
    "markets" CHAR(3)[] NOT NULL DEFAULT ARRAY[]::CHAR(3)[],
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'ANY',
    "organization_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),
    "max_redemptions" INTEGER,
    "max_per_organization" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_promos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_promos_code_format" CHECK ("code" ~ '^[A-Z0-9-]{4,40}$'),
    CONSTRAINT "pricing_promos_effect" CHECK (
      ("effect" IN ('PERCENT_TOTAL', 'PERCENT_FIXED') AND "percent" > 0 AND "percent" <= 100 AND "amount" IS NULL AND "pilot_flat" IS NULL AND "currency" IS NULL)
      OR ("effect" = 'AMOUNT_OFF' AND "amount" > 0 AND "currency" IS NOT NULL AND "percent" IS NULL AND "pilot_flat" IS NULL)
      OR ("effect" = 'WAIVE_VARIABLE' AND "percent" IS NULL AND "amount" IS NULL AND "pilot_flat" IS NULL AND "currency" IS NULL)
      OR ("effect" = 'PILOT_FLAT' AND "pilot_flat" >= 0 AND "currency" IS NOT NULL AND "percent" IS NULL AND "amount" IS NULL)
    ),
    CONSTRAINT "pricing_promos_scope" CHECK ("scope" IN ('ANY', 'PILOT_ONLY', 'ORGANIZATIONS') AND (("scope" = 'ORGANIZATIONS') = (cardinality("organization_ids") > 0))),
    CONSTRAINT "pricing_promos_window" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
    CONSTRAINT "pricing_promos_caps" CHECK (("max_redemptions" IS NULL OR "max_redemptions" >= 1) AND "max_per_organization" >= 1),
    CONSTRAINT "pricing_promos_status" CHECK ("status" IN ('ACTIVE', 'PAUSED', 'EXPIRED'))
);
CREATE UNIQUE INDEX "pricing_promos_code_key" ON "pricing_promos"("code");
CREATE INDEX "pricing_promos_history_idx" ON "pricing_promos"("created_at" DESC, "id" DESC);

-- Every change to a promo, field by field (audit events carry no free text, ADR 0039).
CREATE TABLE "pricing_promo_changes" (
    "id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    CONSTRAINT "pricing_promo_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_promo_changes_promo_fkey" FOREIGN KEY ("promo_id") REFERENCES "pricing_promos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "pricing_promo_changes_promo_idx" ON "pricing_promo_changes"("promo_id", "changed_at");

-- ---------------------------------------------------------------------------
-- Stored quotes: the inputs, the book version and the result lines, so a quote re-shows exactly.
-- ---------------------------------------------------------------------------
CREATE TABLE "pact_quotes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "book_version_id" UUID NOT NULL,
    "enterprise_value" DECIMAL(21,6),
    "pilot" BOOLEAN NOT NULL,
    "promo_code" TEXT,
    "promo_id" UUID,
    "promo_refusal" TEXT,
    "partner_code" TEXT,
    "reseller_percent" DECIMAL(5,2),
    "subtotal" DECIMAL(21,6) NOT NULL,
    "total" DECIMAL(21,6) NOT NULL,
    "applied" TEXT NOT NULL,
    "includes" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "consumed_at" TIMESTAMPTZ(3),
    CONSTRAINT "pact_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pact_quotes_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pact_quotes_version_fkey" FOREIGN KEY ("book_version_id") REFERENCES "price_book_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pact_quotes_promo_fkey" FOREIGN KEY ("promo_id") REFERENCES "pricing_promos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pact_quotes_applied" CHECK ("applied" IN ('NONE', 'RESELLER', 'PROMO', 'BOTH')),
    CONSTRAINT "pact_quotes_status" CHECK ("status" IN ('OPEN', 'CONSUMED', 'EXPIRED', 'VOIDED')),
    CONSTRAINT "pact_quotes_consumed" CHECK (("status" = 'CONSUMED') = ("consumed_at" IS NOT NULL) AND ("status" <> 'CONSUMED' OR "deal_id" IS NOT NULL)),
    CONSTRAINT "pact_quotes_amounts" CHECK ("subtotal" >= 0 AND "total" >= 0 AND "total" <= "subtotal" AND ("enterprise_value" IS NULL OR "enterprise_value" >= 0)),
    CONSTRAINT "pact_quotes_pilot" CHECK (NOT "pilot" OR "enterprise_value" IS NULL),
    CONSTRAINT "pact_quotes_expiry" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "pact_quotes_organization_idx" ON "pact_quotes"("organization_id", "created_at" DESC);

CREATE TABLE "pact_quote_lines" (
    "quote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "from" DECIMAL(21,6),
    "up_to" DECIMAL(21,6),
    "bps" DECIMAL(5,2),
    "slice" DECIMAL(21,6),
    "percent" DECIMAL(5,2),
    "amount" DECIMAL(21,6) NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "pact_quote_lines_pkey" PRIMARY KEY ("quote_id", "position"),
    CONSTRAINT "pact_quote_lines_quote_fkey" FOREIGN KEY ("quote_id") REFERENCES "pact_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pact_quote_lines_kind" CHECK ("kind" IN ('FIXED', 'BAND', 'PROMO', 'RESELLER')),
    CONSTRAINT "pact_quote_lines_shape" CHECK (
      ("kind" = 'BAND' AND "from" IS NOT NULL AND "bps" IS NOT NULL AND "slice" IS NOT NULL)
      OR ("kind" = 'RESELLER' AND "percent" IS NOT NULL)
      OR "kind" IN ('FIXED', 'PROMO')),
    CONSTRAINT "pact_quote_lines_amount" CHECK ("amount" >= 0)
);

-- Lines never change; a quote changes only its status (forward), and its pact once.
CREATE FUNCTION app_pact_quote_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'pact_quote_lines' THEN
    IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM pact_quotes q WHERE q.id = NEW.quote_id AND q.status <> 'OPEN') THEN
      RAISE EXCEPTION 'QUOTE_FROZEN' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'QUOTE_FROZEN' USING ERRCODE = 'P0001'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QUOTE_FROZEN' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status <> 'OPEN' OR NEW.status NOT IN ('OPEN', 'CONSUMED', 'EXPIRED', 'VOIDED')
     OR (OLD.deal_id IS NOT NULL AND NEW.deal_id IS DISTINCT FROM OLD.deal_id)
     OR (to_jsonb(NEW) - 'status' - 'deal_id' - 'consumed_at') <> (to_jsonb(OLD) - 'status' - 'deal_id' - 'consumed_at') THEN
    RAISE EXCEPTION 'QUOTE_FROZEN' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pact_quotes_guard BEFORE UPDATE OR DELETE ON pact_quotes FOR EACH ROW EXECUTE FUNCTION app_pact_quote_guard();
CREATE TRIGGER pact_quote_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON pact_quote_lines FOR EACH ROW EXECUTE FUNCTION app_pact_quote_guard();

-- A promo use, counted when the quote that carries it is bought (Kumar, decision 6).
CREATE TABLE "pricing_promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_forgone" DECIMAL(21,6) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    CONSTRAINT "pricing_promo_redemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_promo_redemptions_promo_fkey" FOREIGN KEY ("promo_id") REFERENCES "pricing_promos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pricing_promo_redemptions_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pricing_promo_redemptions_quote_fkey" FOREIGN KEY ("quote_id") REFERENCES "pact_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pricing_promo_redemptions_amount" CHECK ("amount_forgone" >= 0)
);
CREATE UNIQUE INDEX "pricing_promo_redemptions_quote_key" ON "pricing_promo_redemptions"("quote_id");
CREATE INDEX "pricing_promo_redemptions_promo_idx" ON "pricing_promo_redemptions"("promo_id", "redeemed_at" DESC, "id" DESC);

-- A promo's effect, market, stacking and scope are frozen once it has been used.
CREATE FUNCTION app_pricing_promo_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PROMO_IN_USE' USING ERRCODE = 'P0001'; END IF;
  IF NEW.code <> OLD.code THEN RAISE EXCEPTION 'a code keeps its name' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.effect, NEW.percent, NEW.amount, NEW.pilot_flat, NEW.currency, NEW.markets, NEW.stackable, NEW.scope, NEW.organization_ids)
       IS DISTINCT FROM (OLD.effect, OLD.percent, OLD.amount, OLD.pilot_flat, OLD.currency, OLD.markets, OLD.stackable, OLD.scope, OLD.organization_ids)
     AND EXISTS (SELECT 1 FROM pricing_promo_redemptions r WHERE r.promo_id = OLD.id) THEN
    RAISE EXCEPTION 'PROMO_IN_USE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pricing_promos_guard BEFORE UPDATE OR DELETE ON pricing_promos FOR EACH ROW EXECUTE FUNCTION app_pricing_promo_guard();

-- One code namespace with T-087's promo_codes: a code means one thing wherever it is typed.
CREATE FUNCTION app_promo_code_namespace() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pactlab-promo-code-namespace'));
  IF TG_TABLE_NAME = 'promo_codes' AND EXISTS (SELECT 1 FROM pricing_promos p WHERE p.code = NEW.code) THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "promo_codes_code_key"' USING ERRCODE = '23505';
  END IF;
  IF TG_TABLE_NAME = 'pricing_promos' AND EXISTS (SELECT 1 FROM promo_codes c WHERE c.code = NEW.code) THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "pricing_promos_code_key"' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER promo_codes_shared_namespace BEFORE INSERT ON promo_codes FOR EACH ROW EXECUTE FUNCTION app_promo_code_namespace();
CREATE TRIGGER pricing_promos_shared_namespace BEFORE INSERT ON pricing_promos FOR EACH ROW EXECUTE FUNCTION app_promo_code_namespace();

-- ---------------------------------------------------------------------------
-- The seed: USD v1 from the T-177 numbers (Kumar, decision 4). Data, not code. The other markets
-- refuse quotes until a book is authored for them (T-177b).
-- ---------------------------------------------------------------------------
-- Written as a draft with its bands, then published: the same path an operator takes.
INSERT INTO price_book_versions (id, currency, version, fixed_fee, variable_cap, pilot_flat, rounding, base_documents, base_ai_budget)
VALUES ('019ac000-0000-7000-8000-000000000001', 'USD', 1, 5000, 50000, 5000, 0.01, 500, 50);
INSERT INTO price_book_bands (version_id, position, up_to, bps, documents, ai_budget) VALUES
  ('019ac000-0000-7000-8000-000000000001', 0, 25000000, 5, 1000, 100),
  ('019ac000-0000-7000-8000-000000000001', 1, 100000000, 2, 2500, 250),
  ('019ac000-0000-7000-8000-000000000001', 2, NULL, 1, 5000, 500);
UPDATE price_book_versions SET status = 'PUBLISHED', effective_from = CURRENT_TIMESTAMP, published_at = CURRENT_TIMESTAMP
 WHERE id = '019ac000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Access: pactlab_billing only, through the functions below.
-- ---------------------------------------------------------------------------
ALTER TABLE price_book_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_book_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE price_book_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_book_bands FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_promos FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_promo_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_promo_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE pact_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pact_quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE pact_quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pact_quote_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_promo_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_promo_redemptions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON price_book_versions, price_book_bands TO pactlab_billing;
GRANT SELECT, INSERT, UPDATE ON pricing_promos, pact_quotes, pricing_promo_redemptions TO pactlab_billing;
GRANT SELECT, INSERT ON pricing_promo_changes, pact_quote_lines TO pactlab_billing;

-- The functions decide who may read what (an organization only its own quotes); the policies admit
-- the owning role and nobody else, as T-087's billing tables do.
CREATE POLICY price_book_versions_billing ON price_book_versions FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY price_book_bands_billing ON price_book_bands FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY pricing_promos_billing ON pricing_promos FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY pricing_promo_changes_billing ON pricing_promo_changes FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY pact_quotes_billing ON pact_quotes FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY pact_quote_lines_billing ON pact_quote_lines FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY pricing_promo_redemptions_billing ON pricing_promo_redemptions FOR ALL TO pactlab_billing USING (true) WITH CHECK (true);
CREATE POLICY audit_events_billing_pricing_insert ON audit_events FOR INSERT TO pactlab_billing WITH CHECK (action LIKE 'pricing.%');

-- An operator's action is audited under the operator's own organization (as T-087's promo codes).
CREATE FUNCTION app_pricing_ops_audit(p_actor uuid, p_action text, p_target_type text, p_target text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT app_billing_audit(m.organization_id, p_actor, p_action, p_target_type, p_target)
      FROM organization_memberships m WHERE m.user_id = p_actor AND m.status = 'ACTIVE' ORDER BY m.organization_id LIMIT 1
  $$;

-- A version as the API reads it: the domain's PriceBook shape plus id, status and lineage.
CREATE FUNCTION app_pricing_book_json(p_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT jsonb_build_object(
             'id', v.id, 'currency', v.currency, 'version', v.version, 'status', v.status, 'effectiveFrom', v.effective_from,
             'fixedFee', v.fixed_fee::text, 'variableCap', v.variable_cap::text, 'pilotFlat', v.pilot_flat::text, 'rounding', v.rounding::text,
             'baseIncludes', jsonb_build_object('documents', v.base_documents, 'aiBudget', v.base_ai_budget::text),
             'bands', coalesce((SELECT jsonb_agg(jsonb_build_object('upTo', b.up_to::text, 'bps', b.bps::text,
                                                                   'includes', jsonb_build_object('documents', b.documents, 'aiBudget', b.ai_budget::text)) ORDER BY b.position)
                                  FROM price_book_bands b WHERE b.version_id = v.id), '[]'::jsonb),
             'basedOnVersionId', v.based_on_version_id, 'suggestedFrom', v.suggested_from,
             'createdBy', v.created_by, 'createdAt', v.created_at, 'publishedBy', v.published_by, 'publishedAt', v.published_at,
             'firstQuotedAt', v.first_quoted_at)
      FROM price_book_versions v WHERE v.id = p_id
  $$;

-- The version that prices a quote made now in this market; null when the market has no book yet.
CREATE FUNCTION app_pricing_live_book(p_currency text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT app_pricing_book_json(v.id) FROM price_book_versions v
     WHERE v.currency = p_currency AND v.status = 'PUBLISHED' AND v.effective_from <= now()
     ORDER BY v.effective_from DESC, v.version DESC LIMIT 1
  $$;

-- Operators ---------------------------------------------------------------------------------------

CREATE FUNCTION app_pricing_book_get(p_actor uuid, p_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN app_pricing_book_json(p_id);
END
$$;

-- Version history, newest first, a page at a time (T-126); optionally one market.
CREATE FUNCTION app_pricing_book_page(p_actor uuid, p_currency text, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (book jsonb, created_at timestamptz, id uuid, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT app_pricing_book_json(v.id), v.created_at::timestamptz, v.id,
           (SELECT count(*) FROM price_book_versions c WHERE p_currency IS NULL OR c.currency = p_currency)
      FROM price_book_versions v
     WHERE (p_currency IS NULL OR v.currency = p_currency)
       AND (p_after_at IS NULL OR (v.created_at, v.id) < (p_after_at, p_after_id))
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT least(greatest(p_limit, 1), 101);
END
$$;

-- Create a draft (p_id null) or replace one, from a book the API has already checked. A published
-- version is never edited: VERSION_PUBLISHED, and the caller makes a draft from it instead.
CREATE FUNCTION app_pricing_draft_save(p_actor uuid, p_id uuid, p_book jsonb, p_based_on uuid, p_suggested jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := p_id;
  v_currency text := p_book->>'currency';
  v_status text;
  v_band jsonb;
  v_position integer := 0;
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_based_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM price_book_versions b WHERE b.id = p_based_on AND b.currency = v_currency) THEN
    RAISE EXCEPTION 'NO_SUCH_VERSION' USING ERRCODE = 'P0002';
  END IF;
  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('pactlab-price-book:' || v_currency));
    IF EXISTS (SELECT 1 FROM price_book_versions d WHERE d.currency = v_currency AND d.status = 'DRAFT') THEN
      RAISE EXCEPTION 'DRAFT_EXISTS' USING ERRCODE = 'P0001';
    END IF;
    v_id := uuidv7();
    INSERT INTO price_book_versions (id, currency, version, fixed_fee, variable_cap, pilot_flat, rounding, base_documents, base_ai_budget, based_on_version_id, suggested_from, created_by)
    VALUES (v_id, v_currency, coalesce((SELECT max(x.version) FROM price_book_versions x WHERE x.currency = v_currency), 0) + 1,
            (p_book->>'fixedFee')::numeric, (p_book->>'variableCap')::numeric, (p_book->>'pilotFlat')::numeric, (p_book->>'rounding')::numeric,
            (p_book->'baseIncludes'->>'documents')::integer, (p_book->'baseIncludes'->>'aiBudget')::numeric, p_based_on, p_suggested, p_actor);
    PERFORM app_pricing_ops_audit(p_actor, 'pricing.book_drafted', 'price_book_version', v_id::text);
  ELSE
    SELECT v.status INTO v_status FROM price_book_versions v WHERE v.id = v_id AND v.currency = v_currency FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_SUCH_VERSION' USING ERRCODE = 'P0002'; END IF;
    IF v_status = 'PUBLISHED' THEN RAISE EXCEPTION 'VERSION_PUBLISHED' USING ERRCODE = 'P0001'; END IF;
    UPDATE price_book_versions SET fixed_fee = (p_book->>'fixedFee')::numeric, variable_cap = (p_book->>'variableCap')::numeric,
           pilot_flat = (p_book->>'pilotFlat')::numeric, rounding = (p_book->>'rounding')::numeric,
           base_documents = (p_book->'baseIncludes'->>'documents')::integer, base_ai_budget = (p_book->'baseIncludes'->>'aiBudget')::numeric
     WHERE id = v_id;
    DELETE FROM price_book_bands WHERE version_id = v_id;
    PERFORM app_pricing_ops_audit(p_actor, 'pricing.book_draft_updated', 'price_book_version', v_id::text);
  END IF;
  FOR v_band IN SELECT value FROM jsonb_array_elements(p_book->'bands') LOOP
    INSERT INTO price_book_bands (version_id, position, up_to, bps, documents, ai_budget)
    VALUES (v_id, v_position, nullif(v_band->>'upTo', '')::numeric, (v_band->>'bps')::numeric,
            (v_band->'includes'->>'documents')::integer, (v_band->'includes'->>'aiBudget')::numeric);
    v_position := v_position + 1;
  END LOOP;
  RETURN v_id;
END
$$;

CREATE FUNCTION app_pricing_draft_discard(p_actor uuid, p_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM app_ops_require(p_actor);
  SELECT v.status INTO v_status FROM price_book_versions v WHERE v.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_status = 'PUBLISHED' THEN RAISE EXCEPTION 'VERSION_PUBLISHED' USING ERRCODE = 'P0001'; END IF;
  DELETE FROM price_book_versions WHERE id = p_id;
  PERFORM app_pricing_ops_audit(p_actor, 'pricing.book_draft_discarded', 'price_book_version', p_id::text);
  RETURN true;
END
$$;

-- Publish a draft: frozen from here on. It starts pricing at p_effective (now when null), never
-- earlier than now, so a quote already made is never repriced.
CREATE FUNCTION app_pricing_publish(p_actor uuid, p_id uuid, p_effective timestamptz) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v price_book_versions%ROWTYPE;
  v_effective timestamptz := coalesce(p_effective, now());
  v_bands integer;
  v_open integer;
  v_ascending boolean;
BEGIN
  PERFORM app_ops_require(p_actor);
  SELECT * INTO v FROM price_book_versions x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_SUCH_VERSION' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'PUBLISHED' THEN RAISE EXCEPTION 'VERSION_PUBLISHED' USING ERRCODE = 'P0001'; END IF;
  IF v_effective < now() THEN RAISE EXCEPTION 'BACKDATED' USING ERRCODE = 'P0001'; END IF;
  SELECT count(*), count(*) FILTER (WHERE b.up_to IS NULL) INTO v_bands, v_open FROM price_book_bands b WHERE b.version_id = p_id;
  SELECT coalesce(bool_and(ok), true) INTO v_ascending FROM (
    SELECT (b.up_to IS NULL) = (b.position = v_bands - 1)
           AND (b.up_to IS NULL OR lag(b.up_to) OVER (ORDER BY b.position) IS NULL OR b.up_to > lag(b.up_to) OVER (ORDER BY b.position)) AS ok
      FROM price_book_bands b WHERE b.version_id = p_id) checks;
  IF v_bands = 0 OR v_open <> 1 OR NOT v_ascending THEN RAISE EXCEPTION 'INVALID_BOOK' USING ERRCODE = 'P0001'; END IF;
  UPDATE price_book_versions SET status = 'PUBLISHED', effective_from = v_effective, published_by = p_actor, published_at = now() WHERE id = p_id;
  PERFORM app_pricing_ops_audit(p_actor, 'pricing.book_published', 'price_book_version', p_id::text);
  RETURN app_pricing_book_json(p_id);
END
$$;

-- A promo as the API reads it, with its uses and revenue forgone per market.
CREATE FUNCTION app_pricing_promo_json(p_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT jsonb_build_object(
             'id', p.id, 'code', p.code, 'description', p.description, 'effect', p.effect, 'percent', p.percent::text, 'amount', p.amount::text,
             'pilotFlat', p.pilot_flat::text, 'currency', p.currency, 'markets', to_jsonb(p.markets), 'stackable', p.stackable, 'scope', p.scope,
             'organizationIds', to_jsonb(p.organization_ids), 'validFrom', p.valid_from, 'validUntil', p.valid_until,
             'maxRedemptions', p.max_redemptions, 'maxPerOrganization', p.max_per_organization, 'status', p.status,
             'createdBy', p.created_by, 'createdAt', p.created_at,
             'redemptions', (SELECT count(*) FROM pricing_promo_redemptions r WHERE r.promo_id = p.id AND r.voided_at IS NULL),
             'byMarket', coalesce((SELECT jsonb_agg(jsonb_build_object('currency', m.currency, 'uses', m.uses, 'forgone', m.forgone::text) ORDER BY m.currency)
                                     FROM (SELECT r.currency, count(*) AS uses, sum(r.amount_forgone) AS forgone FROM pricing_promo_redemptions r
                                            WHERE r.promo_id = p.id AND r.voided_at IS NULL GROUP BY r.currency) m), '[]'::jsonb))
      FROM pricing_promos p WHERE p.id = p_id
  $$;

CREATE FUNCTION app_pricing_promo_create(p_actor uuid, p jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
BEGIN
  PERFORM app_ops_require(p_actor);
  INSERT INTO pricing_promos (id, code, description, effect, percent, amount, pilot_flat, currency, markets, stackable, scope, organization_ids,
                              valid_from, valid_until, max_redemptions, max_per_organization, created_by)
  VALUES (v_id, upper(btrim(p->>'code')), btrim(p->>'description'), p->>'effect', (p->>'percent')::numeric, (p->>'amount')::numeric, (p->>'pilotFlat')::numeric,
          p->>'currency', coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'markets'))::char(3)[], ARRAY[]::char(3)[]),
          coalesce((p->>'stackable')::boolean, false), coalesce(p->>'scope', 'ANY'),
          coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'organizationIds'))::uuid[], ARRAY[]::uuid[]),
          coalesce((p->>'validFrom')::timestamptz, now()), (p->>'validUntil')::timestamptz, (p->>'maxRedemptions')::integer,
          coalesce((p->>'maxPerOrganization')::integer, 1), p_actor);
  PERFORM app_pricing_ops_audit(p_actor, 'pricing.promo_created', 'pricing_promo', v_id::text);
  RETURN v_id;
END
$$;

-- Change a promo: status, window, caps and description always; its effect, markets, stacking and
-- scope only while unused (the guard). Each change is kept field by field and audited.
CREATE FUNCTION app_pricing_promo_update(p_actor uuid, p_id uuid, p jsonb) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_old_status text;
  v_new_status text;
BEGIN
  PERFORM app_ops_require(p_actor);
  SELECT to_jsonb(x) - 'created_at' - 'created_by', x.status INTO v_before, v_old_status FROM pricing_promos x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_SUCH_PROMO' USING ERRCODE = 'P0002'; END IF;
  UPDATE pricing_promos x SET
    description = CASE WHEN p ? 'description' THEN btrim(p->>'description') ELSE x.description END,
    status = CASE WHEN p ? 'status' THEN p->>'status' ELSE x.status END,
    valid_from = CASE WHEN p ? 'validFrom' THEN (p->>'validFrom')::timestamptz ELSE x.valid_from END,
    valid_until = CASE WHEN p ? 'validUntil' THEN (p->>'validUntil')::timestamptz ELSE x.valid_until END,
    max_redemptions = CASE WHEN p ? 'maxRedemptions' THEN (p->>'maxRedemptions')::integer ELSE x.max_redemptions END,
    max_per_organization = CASE WHEN p ? 'maxPerOrganization' THEN (p->>'maxPerOrganization')::integer ELSE x.max_per_organization END,
    effect = CASE WHEN p ? 'effect' THEN p->>'effect' ELSE x.effect END,
    percent = CASE WHEN p ? 'effect' THEN (p->>'percent')::numeric ELSE x.percent END,
    amount = CASE WHEN p ? 'effect' THEN (p->>'amount')::numeric ELSE x.amount END,
    pilot_flat = CASE WHEN p ? 'effect' THEN (p->>'pilotFlat')::numeric ELSE x.pilot_flat END,
    currency = CASE WHEN p ? 'effect' THEN p->>'currency' ELSE x.currency END,
    markets = CASE WHEN p ? 'markets' THEN coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'markets'))::char(3)[], ARRAY[]::char(3)[]) ELSE x.markets END,
    stackable = CASE WHEN p ? 'stackable' THEN (p->>'stackable')::boolean ELSE x.stackable END,
    scope = CASE WHEN p ? 'scope' THEN p->>'scope' ELSE x.scope END,
    organization_ids = CASE WHEN p ? 'organizationIds' THEN coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'organizationIds'))::uuid[], ARRAY[]::uuid[]) ELSE x.organization_ids END
   WHERE x.id = p_id
   RETURNING to_jsonb(x) - 'created_at' - 'created_by', x.status INTO v_after, v_new_status;
  IF v_after IS DISTINCT FROM v_before THEN
    INSERT INTO pricing_promo_changes (id, promo_id, actor_user_id, before, after) VALUES (uuidv7(), p_id, p_actor, v_before, v_after);
    PERFORM app_pricing_ops_audit(p_actor,
      CASE WHEN v_new_status IS DISTINCT FROM v_old_status THEN
        CASE v_new_status WHEN 'PAUSED' THEN 'pricing.promo_paused' WHEN 'EXPIRED' THEN 'pricing.promo_expired' ELSE 'pricing.promo_resumed' END
      ELSE 'pricing.promo_updated' END,
      'pricing_promo', p_id::text);
  END IF;
  RETURN app_pricing_promo_json(p_id);
END
$$;

CREATE FUNCTION app_pricing_promo_page(p_actor uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (promo jsonb, created_at timestamptz, id uuid, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT app_pricing_promo_json(p.id), p.created_at::timestamptz, p.id, (SELECT count(*) FROM pricing_promos)
      FROM pricing_promos p
     WHERE p_after_at IS NULL OR (p.created_at, p.id) < (p_after_at, p_after_id)
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT least(greatest(p_limit, 1), 101);
END
$$;

CREATE FUNCTION app_pricing_promo_redemption_page(p_actor uuid, p_promo uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, organization_id uuid, organization_name text, quote_id uuid, deal_id uuid, currency text, amount_forgone text, redeemed_at timestamptz, voided_at timestamptz, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT r.id, r.organization_id, o.name, r.quote_id, r.deal_id, r.currency::text, r.amount_forgone::text, r.redeemed_at::timestamptz, r.voided_at::timestamptz,
           (SELECT count(*) FROM pricing_promo_redemptions c WHERE c.promo_id = p_promo)
      FROM pricing_promo_redemptions r JOIN organizations o ON o.id = r.organization_id
     WHERE r.promo_id = p_promo AND (p_after_at IS NULL OR (r.redeemed_at, r.id) < (p_after_at, p_after_id))
     ORDER BY r.redeemed_at DESC, r.id DESC
     LIMIT least(greatest(p_limit, 1), 101);
END
$$;

-- Organizations -----------------------------------------------------------------------------------

-- Is this promo code usable by this organization right now? Only the code asked about, never a list.
-- Reasons: OK, UNKNOWN, PAUSED, NOT_YET, EXPIRED, USED_UP, ALREADY, NOT_ELIGIBLE, RATE_LIMITED.
-- Market and currency are the engine's to judge (promoRefusal), so the effect comes back with OK.
CREATE FUNCTION app_pricing_promo_check(p_org uuid, p_code text, p_ip_hash text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v pricing_promos%ROWTYPE;
  v_pilot boolean := coalesce((SELECT f.pilot_mode FROM organization_flags f WHERE f.organization_id = p_org), false);
  v_reason text;
BEGIN
  IF (SELECT count(*) FROM promo_attempts a WHERE a.ip_hash = p_ip_hash AND a.created_at > now() - interval '1 hour') >= 20 THEN
    RETURN jsonb_build_object('reason', 'RATE_LIMITED');
  END IF;
  SELECT * INTO v FROM pricing_promos p WHERE p.code = upper(btrim(p_code));
  v_reason := CASE
    WHEN NOT FOUND THEN 'UNKNOWN'
    WHEN v.status = 'PAUSED' THEN 'PAUSED'
    WHEN v.status = 'EXPIRED' OR (v.valid_until IS NOT NULL AND v.valid_until <= now()) THEN 'EXPIRED'
    WHEN v.valid_from > now() THEN 'NOT_YET'
    WHEN (v.scope = 'PILOT_ONLY' AND NOT v_pilot) OR (v.scope = 'ORGANIZATIONS' AND NOT p_org = ANY (v.organization_ids)) THEN 'NOT_ELIGIBLE'
    WHEN v.max_redemptions IS NOT NULL AND (SELECT count(*) FROM pricing_promo_redemptions r WHERE r.promo_id = v.id AND r.voided_at IS NULL) >= v.max_redemptions THEN 'USED_UP'
    WHEN (SELECT count(*) FROM pricing_promo_redemptions r WHERE r.promo_id = v.id AND r.organization_id = p_org AND r.voided_at IS NULL) >= v.max_per_organization THEN 'ALREADY'
    ELSE 'OK' END;
  IF v_reason <> 'OK' THEN
    INSERT INTO promo_attempts (id, ip_hash) VALUES (uuidv7(), p_ip_hash);
    RETURN jsonb_build_object('reason', v_reason);
  END IF;
  RETURN jsonb_build_object('reason', 'OK', 'promo', app_pricing_promo_json(v.id) - 'organizationIds' - 'byMarket' - 'redemptions' - 'createdBy' - 'maxRedemptions');
END
$$;

-- Store a quote the engine produced, for an owner or admin of the organization (Kumar, decision 5),
-- after re-checking what can be checked here: the version is the live one in its market, the pilot
-- flag is the organization's, the lines foot, and an applied promo is valid for this market.
CREATE FUNCTION app_pricing_quote_record(p_org uuid, p_actor uuid, p jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
  v price_book_versions%ROWTYPE;
  v_live uuid;
  v_currency text := p->>'currency';
  v_pilot boolean := (p->>'pilot')::boolean;
  v_fixed numeric;
  v_expected_fixed numeric;
  v_bands numeric;
  v_discounts numeric;
  v_subtotal numeric := (p->>'subtotal')::numeric;
  v_total numeric := (p->>'total')::numeric;
  v_promo pricing_promos%ROWTYPE;
  v_line jsonb;
  v_position integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = p_org AND m.user_id = p_actor AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM price_book_versions x WHERE x.id = (p->>'versionId')::uuid;
  SELECT x.id INTO v_live FROM price_book_versions x
   WHERE x.currency = v_currency AND x.status = 'PUBLISHED' AND x.effective_from <= now() ORDER BY x.effective_from DESC, x.version DESC LIMIT 1;
  IF v.id IS NULL OR v.currency <> v_currency OR v_live IS DISTINCT FROM v.id THEN RAISE EXCEPTION 'NOT_LIVE_BOOK' USING ERRCODE = 'P0001'; END IF;
  IF v_pilot IS DISTINCT FROM coalesce((SELECT f.pilot_mode FROM organization_flags f WHERE f.organization_id = p_org), false) THEN
    RAISE EXCEPTION 'PILOT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF p->>'dealId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = (p->>'dealId')::uuid AND d.organization_id = p_org) THEN
    RAISE EXCEPTION 'NO_SUCH_PACT' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(sum((l->>'amount')::numeric) FILTER (WHERE l->>'kind' = 'FIXED'), 0),
         coalesce(sum((l->>'amount')::numeric) FILTER (WHERE l->>'kind' = 'BAND'), 0),
         coalesce(sum((l->>'amount')::numeric) FILTER (WHERE l->>'kind' IN ('PROMO', 'RESELLER') AND coalesce((l->>'applied')::boolean, true)), 0)
    INTO v_fixed, v_bands, v_discounts FROM jsonb_array_elements(p->'lines') l;
  v_expected_fixed := CASE WHEN v_pilot THEN v.pilot_flat ELSE v.fixed_fee END;
  IF v_fixed <> v_expected_fixed
     OR (v_pilot AND v_bands <> 0)
     OR v_subtotal <> v_fixed + least(v_bands, v.variable_cap)
     OR v_total <> v_subtotal - v_discounts OR v_total < 0 THEN
    RAISE EXCEPTION 'QUOTE_DOES_NOT_FOOT' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'lines') l WHERE l->>'kind' = 'PROMO' AND coalesce((l->>'applied')::boolean, true)) THEN
    SELECT * INTO v_promo FROM pricing_promos x WHERE x.id = (p->>'promoId')::uuid AND x.code = upper(btrim(p->>'promoCode'));
    IF v_promo.id IS NULL OR v_promo.status <> 'ACTIVE' OR v_promo.valid_from > now() OR (v_promo.valid_until IS NOT NULL AND v_promo.valid_until <= now())
       OR (cardinality(v_promo.markets) > 0 AND NOT v_currency = ANY (v_promo.markets))
       OR (v_promo.scope = 'PILOT_ONLY' AND NOT v_pilot) OR (v_promo.scope = 'ORGANIZATIONS' AND NOT p_org = ANY (v_promo.organization_ids)) THEN
      RAISE EXCEPTION 'PROMO_NOT_VALID' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO pact_quotes (id, organization_id, deal_id, currency, book_version_id, enterprise_value, pilot, promo_code, promo_id, promo_refusal,
                           partner_code, reseller_percent, subtotal, total, applied, includes, engine_version, created_by, expires_at)
  VALUES (v_id, p_org, (p->>'dealId')::uuid, v_currency, v.id, (p->>'enterpriseValue')::numeric, v_pilot, upper(btrim(p->>'promoCode')),
          (p->>'promoId')::uuid, p->>'promoRefusal', upper(btrim(p->>'partnerCode')), (p->>'resellerPercent')::numeric, v_subtotal, v_total,
          p->>'applied', p->'includes', p->>'engineVersion', p_actor, now() + interval '30 days');
  FOR v_line IN SELECT value FROM jsonb_array_elements(p->'lines') LOOP
    INSERT INTO pact_quote_lines (quote_id, position, kind, "from", up_to, bps, slice, percent, amount, applied)
    VALUES (v_id, v_position, v_line->>'kind', (v_line->>'from')::numeric, (v_line->>'upTo')::numeric, (v_line->>'bps')::numeric,
            (v_line->>'slice')::numeric, (v_line->>'percent')::numeric, (v_line->>'amount')::numeric, coalesce((v_line->>'applied')::boolean, true));
    v_position := v_position + 1;
  END LOOP;
  UPDATE price_book_versions SET first_quoted_at = now() WHERE id = v.id AND first_quoted_at IS NULL;
  PERFORM app_billing_audit(p_org, p_actor, 'pricing.quote_created', 'pact_quote', v_id::text);
  RETURN v_id;
END
$$;

-- A stored quote, only to its own organization. Status reads EXPIRED once an open quote has lapsed.
CREATE FUNCTION app_pricing_quote_get(p_org uuid, p_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT jsonb_build_object(
             'id', q.id, 'organizationId', q.organization_id, 'dealId', q.deal_id, 'currency', q.currency, 'bookVersionId', q.book_version_id,
             'bookVersion', v.version, 'variableCap', v.variable_cap::text, 'enterpriseValue', q.enterprise_value::text, 'pilot', q.pilot,
             'promoCode', q.promo_code, 'promoId', q.promo_id, 'promoRefusal', q.promo_refusal, 'partnerCode', q.partner_code,
             'resellerPercent', q.reseller_percent::text, 'subtotal', q.subtotal::text, 'total', q.total::text, 'applied', q.applied,
             'includes', q.includes, 'engineVersion', q.engine_version, 'createdBy', q.created_by, 'createdAt', q.created_at, 'expiresAt', q.expires_at,
             'status', CASE WHEN q.status = 'OPEN' AND q.expires_at <= now() THEN 'EXPIRED' ELSE q.status END, 'consumedAt', q.consumed_at,
             'lines', (SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'from', l."from"::text, 'upTo', l.up_to::text, 'bps', l.bps::text, 'slice', l.slice::text,
                                                           'percent', l.percent::text, 'amount', l.amount::text, 'applied', l.applied) ORDER BY l.position)
                         FROM pact_quote_lines l WHERE l.quote_id = q.id))
      FROM pact_quotes q JOIN price_book_versions v ON v.id = q.book_version_id
     WHERE q.id = p_id AND q.organization_id = p_org
  $$;

-- The pact is bought on this quote (T-177c wires checkout to it): the price is the quote's, and a
-- promo it carries is counted now, under its caps, locked so two buyers cannot take the last use.
-- Returns CONSUMED, or why not: UNKNOWN, NOT_OPEN, EXPIRED, NO_SUCH_PACT, PROMO_USED_UP, PROMO_ALREADY.
CREATE FUNCTION app_pricing_quote_consume(p_org uuid, p_id uuid, p_deal uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  q pact_quotes%ROWTYPE;
  v_promo pricing_promos%ROWTYPE;
  v_forgone numeric;
BEGIN
  SELECT * INTO q FROM pact_quotes x WHERE x.id = p_id AND x.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN 'UNKNOWN'; END IF;
  IF q.status <> 'OPEN' THEN RETURN 'NOT_OPEN'; END IF;
  IF q.expires_at <= now() THEN
    UPDATE pact_quotes SET status = 'EXPIRED' WHERE id = p_id;
    RETURN 'EXPIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = p_deal AND d.organization_id = p_org) OR (q.deal_id IS NOT NULL AND q.deal_id <> p_deal) THEN
    RETURN 'NO_SUCH_PACT';
  END IF;
  SELECT sum(l.amount) INTO v_forgone FROM pact_quote_lines l WHERE l.quote_id = p_id AND l.kind = 'PROMO' AND l.applied;
  IF v_forgone IS NOT NULL THEN
    SELECT * INTO v_promo FROM pricing_promos x WHERE x.id = q.promo_id FOR UPDATE;
    IF v_promo.max_redemptions IS NOT NULL AND (SELECT count(*) FROM pricing_promo_redemptions r WHERE r.promo_id = v_promo.id AND r.voided_at IS NULL) >= v_promo.max_redemptions THEN
      RETURN 'PROMO_USED_UP';
    END IF;
    IF (SELECT count(*) FROM pricing_promo_redemptions r WHERE r.promo_id = v_promo.id AND r.organization_id = p_org AND r.voided_at IS NULL) >= v_promo.max_per_organization THEN
      RETURN 'PROMO_ALREADY';
    END IF;
    INSERT INTO pricing_promo_redemptions (id, promo_id, organization_id, quote_id, deal_id, currency, amount_forgone)
    VALUES (uuidv7(), v_promo.id, p_org, p_id, p_deal, q.currency, v_forgone);
  END IF;
  UPDATE pact_quotes SET status = 'CONSUMED', deal_id = p_deal, consumed_at = now() WHERE id = p_id;
  PERFORM app_billing_audit(p_org, NULL, 'pricing.quote_consumed', 'pact_quote', p_id::text, 'SUCCEEDED', p_deal);
  RETURN 'CONSUMED';
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_pricing_ops_audit(uuid, text, text, text)', 'app_pricing_book_json(uuid)', 'app_pricing_promo_json(uuid)',
    'app_promo_code_namespace()',
    'app_pricing_live_book(text)', 'app_pricing_book_get(uuid, uuid)', 'app_pricing_book_page(uuid, text, timestamptz, uuid, integer)',
    'app_pricing_draft_save(uuid, uuid, jsonb, uuid, jsonb)', 'app_pricing_draft_discard(uuid, uuid)', 'app_pricing_publish(uuid, uuid, timestamptz)',
    'app_pricing_promo_create(uuid, jsonb)', 'app_pricing_promo_update(uuid, uuid, jsonb)', 'app_pricing_promo_page(uuid, timestamptz, uuid, integer)',
    'app_pricing_promo_redemption_page(uuid, uuid, timestamptz, uuid, integer)', 'app_pricing_promo_check(uuid, text, text)',
    'app_pricing_quote_record(uuid, uuid, jsonb)', 'app_pricing_quote_get(uuid, uuid)', 'app_pricing_quote_consume(uuid, uuid, uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_billing', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    -- The JSON shapers, the audit helper and the trigger are internal: only the functions above call them.
    IF fn NOT LIKE 'app_pricing_ops_audit%' AND fn NOT LIKE 'app_pricing_book_json%' AND fn NOT LIKE 'app_pricing_promo_json%' AND fn NOT LIKE 'app_promo_code_namespace%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
    END IF;
  END LOOP;
END
$$;
