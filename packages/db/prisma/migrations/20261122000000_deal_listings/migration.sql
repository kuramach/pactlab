-- Public deal page (listing): a seller-written teaser at an unguessable link, and the
-- requests for access that interested buyers leave on it. Expand-only: two new tables,
-- one new no-login role and its functions. Rollback: drop the functions, tables and role.

-- 1. The listing: one per pact, written by the seller's side. Only seller-authored teaser
--    text is ever public; nothing here is read from evidence, findings or valuation.
CREATE TABLE "deal_listings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "visibility" TEXT NOT NULL DEFAULT 'ANONYMOUS',
    "codename" TEXT NOT NULL,
    "public_name" TEXT,
    "headline" TEXT NOT NULL,
    "sector" TEXT,
    "region" TEXT,
    "size_band" TEXT,
    "asking_low" DECIMAL(20,2),
    "asking_high" DECIMAL(20,2),
    "asking_currency" CHAR(3),
    "summary" TEXT NOT NULL DEFAULT '',
    "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "indexable" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_listings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_listings_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
    CONSTRAINT "deal_listings_visibility_check" CHECK ("visibility" IN ('ANONYMOUS', 'NAMED')),
    CONSTRAINT "deal_listings_slug_check" CHECK ("slug" ~ '^pl-[a-z0-9]{10}$'),
    CONSTRAINT "deal_listings_text_check" CHECK (
      length(btrim("codename")) BETWEEN 1 AND 80 AND length(btrim("headline")) BETWEEN 1 AND 160
      AND length("summary") <= 2000 AND cardinality("highlights") <= 6
      AND ("public_name" IS NULL OR length(btrim("public_name")) BETWEEN 1 AND 160)
      AND ("sector" IS NULL OR length("sector") <= 80) AND ("region" IS NULL OR length("region") <= 80)
      AND ("size_band" IS NULL OR length("size_band") <= 80)),
    -- A named listing shows a name; an anonymous one never stores the choice to show it.
    CONSTRAINT "deal_listings_named_check" CHECK ("visibility" = 'ANONYMOUS' OR "public_name" IS NOT NULL),
    CONSTRAINT "deal_listings_asking_check" CHECK (
      ("asking_low" IS NULL AND "asking_high" IS NULL AND "asking_currency" IS NULL)
      OR ("asking_currency" ~ '^[A-Z]{3}$' AND "asking_low" > 0 AND ("asking_high" IS NULL OR "asking_high" >= "asking_low")))
);
CREATE UNIQUE INDEX "deal_listings_slug_key" ON "deal_listings"("slug");
CREATE UNIQUE INDEX "deal_listings_org_deal_key" ON "deal_listings"("organization_id", "deal_id");
CREATE UNIQUE INDEX "deal_listings_org_deal_id_key" ON "deal_listings"("organization_id", "deal_id", "id");
ALTER TABLE "deal_listings" ADD CONSTRAINT "deal_listings_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Requests for access. Personal data of a prospective buyer: kept until decided;
--    unconfirmed ones go after 7 days and declined ones 90 days after the decision.
CREATE TABLE "listing_interests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_EMAIL',
    "token_hash" TEXT,
    "ip_hash" TEXT NOT NULL,
    "email_confirmed_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "decision_note" TEXT,
    "bid_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_interests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listing_interests_status_check" CHECK ("status" IN ('PENDING_EMAIL', 'NEW', 'APPROVED', 'DECLINED')),
    CONSTRAINT "listing_interests_intent_check" CHECK ("intent" IN ('STRATEGIC', 'FINANCIAL', 'INDIVIDUAL', 'ADVISER')),
    CONSTRAINT "listing_interests_text_check" CHECK (
      length(btrim("name")) BETWEEN 1 AND 120 AND length(btrim("firm")) BETWEEN 1 AND 200
      AND "email" = lower("email") AND "email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length("email") <= 254
      AND ("message" IS NULL OR length("message") <= 1000) AND ("decision_note" IS NULL OR length("decision_note") <= 1000))
);
CREATE UNIQUE INDEX "listing_interests_token_key" ON "listing_interests"("token_hash");
CREATE INDEX "listing_interests_listing_idx" ON "listing_interests"("listing_id", "created_at");
CREATE INDEX "listing_interests_ip_idx" ON "listing_interests"("ip_hash", "created_at");
CREATE INDEX "listing_interests_org_deal_idx" ON "listing_interests"("organization_id", "deal_id", "status", "created_at");
ALTER TABLE "listing_interests" ADD CONSTRAINT "listing_interests_listing_fkey" FOREIGN KEY ("organization_id", "deal_id", "listing_id") REFERENCES "deal_listings"("organization_id", "deal_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listing_interests" ADD CONSTRAINT "listing_interests_bid_fkey" FOREIGN KEY ("organization_id", "deal_id", "bid_id") REFERENCES "bids"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. The seller's side runs the listing and decides requests; no one else sees either.
GRANT SELECT, INSERT, UPDATE ON deal_listings TO pactlab_app;
GRANT SELECT, UPDATE (status, decided_at, decided_by, decision_note, bid_id) ON listing_interests TO pactlab_app;
ALTER TABLE deal_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_listings FORCE ROW LEVEL SECURITY;
ALTER TABLE listing_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_interests FORCE ROW LEVEL SECURITY;
CREATE POLICY deal_listings_own_side ON deal_listings FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY listing_interests_own_side ON listing_interests FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));

-- 4. Signed-out visitors reach these tables only through the functions below, which run as
--    the no-login role `pactlab_public` with column-limited grants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pactlab_public') THEN
    CREATE ROLE pactlab_public NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
GRANT pactlab_public TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO pactlab_public;
GRANT SELECT (id, organization_id, deal_id, slug, status, visibility, codename, public_name, headline, sector, region, size_band,
              asking_low, asking_high, asking_currency, summary, highlights, indexable, published_at) ON deal_listings TO pactlab_public;
GRANT SELECT, INSERT, DELETE ON listing_interests TO pactlab_public;
GRANT UPDATE (status, token_hash, email_confirmed_at) ON listing_interests TO pactlab_public;
-- The audit chain trigger reads the chain's last link as the inserting role.
GRANT SELECT (organization_id, deal_id, chain_seq, hash), INSERT ON audit_events TO pactlab_public;
CREATE POLICY deal_listings_public ON deal_listings FOR SELECT TO pactlab_public USING (status = 'PUBLISHED');
CREATE POLICY listing_interests_public ON listing_interests FOR ALL TO pactlab_public USING (true) WITH CHECK (true);
-- Readable columns are only the chain's own (no actions, actors or targets).
CREATE POLICY audit_events_public_select ON audit_events FOR SELECT TO pactlab_public USING (true);
CREATE POLICY audit_events_public_insert ON audit_events FOR INSERT TO pactlab_public
  WITH CHECK (actor_user_id IS NULL AND action = 'listing.interest.received' AND target_type = 'listing_interest');

-- A published listing's teaser. Never the pact id, the target's name (unless the seller
-- chose to show one), or anything from the pact itself.
CREATE FUNCTION app_listing_public(p_slug text)
  RETURNS TABLE (slug text, visibility text, codename text, public_name text, headline text, sector text, region text, size_band text,
                 asking_low text, asking_high text, asking_currency text, summary text, highlights text[], indexable boolean, published_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT l.slug, l.visibility, l.codename, CASE WHEN l.visibility = 'NAMED' THEN l.public_name END, l.headline, l.sector, l.region, l.size_band,
           l.asking_low::text, l.asking_high::text, l.asking_currency::text, l.summary, l.highlights, l.indexable, l.published_at::timestamptz
      FROM deal_listings l
     WHERE l.slug = p_slug AND l.status = 'PUBLISHED';
$$;

-- Leave a request for access. Returns true when recorded (the caller then emails the
-- confirmation link), false otherwise: unknown or unpublished listing, a duplicate open
-- request from the same address, or a rate limit. Callers respond identically either way.
CREATE FUNCTION app_listing_interest_file(p_slug text, p_name text, p_firm text, p_email text, p_intent text, p_message text,
                                          p_ip_hash text, p_token_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_listing record;
  v_email text := lower(btrim(p_email));
BEGIN
  -- Housekeeping: requests never confirmed, and declined ones past their retention.
  DELETE FROM listing_interests WHERE status = 'PENDING_EMAIL' AND created_at < now() - interval '7 days';
  DELETE FROM listing_interests WHERE status = 'DECLINED' AND decided_at < now() - interval '90 days';

  SELECT l.id, l.organization_id, l.deal_id INTO v_listing FROM deal_listings l WHERE l.slug = p_slug AND l.status = 'PUBLISHED';
  IF NOT FOUND THEN RETURN false; END IF;
  IF (SELECT count(*) FROM listing_interests i WHERE i.ip_hash = p_ip_hash AND i.created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM listing_interests i WHERE i.listing_id = v_listing.id AND i.ip_hash = p_ip_hash AND i.created_at > now() - interval '1 hour') >= 3
     OR EXISTS (SELECT 1 FROM listing_interests i WHERE i.listing_id = v_listing.id AND i.email = v_email AND i.status IN ('PENDING_EMAIL', 'NEW')) THEN
    RETURN false;
  END IF;
  INSERT INTO listing_interests (id, organization_id, deal_id, listing_id, name, firm, email, intent, message, token_hash, ip_hash)
  VALUES (uuidv7(), v_listing.organization_id, v_listing.deal_id, v_listing.id, btrim(p_name), btrim(p_firm), v_email, p_intent,
          NULLIF(btrim(coalesce(p_message, '')), ''), p_token_hash, p_ip_hash);
  RETURN true;
END
$$;

-- Confirm the email address of a request (link valid 7 days, used once): it reaches the
-- seller's inbox. Returns the listing's slug, or no row.
CREATE FUNCTION app_listing_interest_confirm(p_token_hash text) RETURNS TABLE (slug text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_interest listing_interests%ROWTYPE;
BEGIN
  UPDATE listing_interests i SET status = 'NEW', email_confirmed_at = now(), token_hash = NULL
   WHERE i.token_hash = p_token_hash AND i.status = 'PENDING_EMAIL' AND i.created_at > now() - interval '7 days'
  RETURNING * INTO v_interest;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_interest.organization_id, v_interest.deal_id, NULL, 'listing.interest.received', 'listing_interest', v_interest.id::text, 'SUCCEEDED');
  RETURN QUERY SELECT l.slug FROM deal_listings l WHERE l.id = v_interest.listing_id;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_listing_public(text)',
    'app_listing_interest_file(text, text, text, text, text, text, text, text)',
    'app_listing_interest_confirm(text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_public', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
