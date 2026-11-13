-- Letters of intent (T-119, ADR 0030): generated from the agreed terms, in two labelled parts —
-- non-binding economics and a binding part (exclusivity, confidentiality, law, expenses) — and
-- signed by both sides, in the app or by e-signature. Optional unless the pact requires one.
-- Expand-only: new tables, nullable or defaulted columns; app_signing_record replaced with the
-- same behaviour for every envelope that is not an LOI's.
-- Rollback: drop loi_signoffs, loi_versions, signature_envelopes.loi_id, deals.loi_required, and
-- restore app_signing_record from 20261126000100_signing_audit.

CREATE TABLE "loi_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "fields" JSONB NOT NULL,
    "snapshot" JSONB,
    "method" TEXT,
    "object_key" TEXT,
    "sha256" CHAR(64),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "respond_by" TIMESTAMPTZ(3),
    "countersigned_at" TIMESTAMPTZ(3),
    "declined_at" TIMESTAMPTZ(3),
    "declined_by" UUID,
    "exclusivity_ends_at" TIMESTAMPTZ(3),
    CONSTRAINT "loi_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loi_versions_version_key" UNIQUE ("deal_id", "version"),
    CONSTRAINT "loi_versions_status_check" CHECK ("status" IN ('DRAFT', 'SENT', 'COUNTERSIGNED', 'DECLINED', 'EXPIRED')),
    CONSTRAINT "loi_versions_method_check" CHECK ("method" IS NULL OR "method" IN ('IN_APP', 'ESIGN')),
    CONSTRAINT "loi_versions_sent_check" CHECK (("status" = 'DRAFT') = ("sent_at" IS NULL)),
    CONSTRAINT "loi_versions_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "loi_versions_batch_fkey" FOREIGN KEY ("organization_id", "deal_id", "batch_id") REFERENCES "term_proposal_batches"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "loi_signoffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "loi_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "envelope_id" UUID,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loi_signoffs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loi_signoffs_side_key" UNIQUE ("loi_id", "side"),
    CONSTRAINT "loi_signoffs_side_check" CHECK ("side" IN ('BUYER', 'SELLER')),
    CONSTRAINT "loi_signoffs_method_check" CHECK ("method" IN ('IN_APP', 'ESIGN')),
    CONSTRAINT "loi_signoffs_loi_fkey" FOREIGN KEY ("loi_id") REFERENCES "loi_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "signature_envelopes" ADD COLUMN "loi_id" UUID,
  ADD CONSTRAINT "signature_envelopes_loi_fkey" FOREIGN KEY ("loi_id") REFERENCES "loi_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD COLUMN "loi_required" BOOLEAN NOT NULL DEFAULT false;

-- A sent letter is what was signed: its content never changes, only its status moves forward.
CREATE FUNCTION loi_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'letters of intent are kept' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'DRAFT' THEN RETURN NEW; END IF;
  IF NEW.id <> OLD.id OR NEW.batch_id <> OLD.batch_id OR NEW.version <> OLD.version OR NEW.fields <> OLD.fields
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.object_key IS DISTINCT FROM OLD.object_key
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.method IS DISTINCT FROM OLD.method
     OR NOT (OLD.status = NEW.status OR (OLD.status = 'SENT' AND NEW.status IN ('COUNTERSIGNED', 'DECLINED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'a sent letter of intent cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER loi_versions_guard BEFORE UPDATE OR DELETE ON loi_versions FOR EACH ROW EXECUTE FUNCTION loi_versions_guard();
CREATE FUNCTION loi_signoffs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'signatures are kept' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER loi_signoffs_immutable BEFORE UPDATE OR DELETE ON loi_signoffs FOR EACH ROW EXECUTE FUNCTION loi_signoffs_immutable();

-- Both sides see a sent letter; a draft stays with the side writing it (the pact's own side).
ALTER TABLE loi_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loi_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE loi_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE loi_signoffs FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON loi_versions, loi_signoffs TO pactlab_app;
GRANT UPDATE ("status", "fields", "snapshot", "method", "object_key", "sha256", "sent_by", "sent_at", "respond_by", "countersigned_at", "declined_at", "declined_by", "exclusivity_ends_at") ON loi_versions TO pactlab_app;
GRANT UPDATE ("loi_required") ON deals TO pactlab_app;
CREATE POLICY loi_versions_tenant ON loi_versions FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND (status <> 'DRAFT' OR app_is_buyer_side(deal_id)));
CREATE POLICY loi_versions_draft ON loi_versions FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND status = 'DRAFT' AND created_by = app_current_user_id());
-- The own side edits and sends; either side's signatory moves a sent letter (countersign, decline, expire).
CREATE POLICY loi_versions_update ON loi_versions FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND (status <> 'DRAFT' OR app_is_buyer_side(deal_id)))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY loi_signoffs_tenant ON loi_signoffs FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
-- A side's named signatory signs, as themselves, for their side.
CREATE POLICY loi_signoffs_sign ON loi_signoffs FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND user_id = app_current_user_id() AND app_current_signatory(deal_id, side) = app_current_user_id()
  );

-- E-signature: an LOI's envelope completes the LOI; every other envelope, the terms, as before.
GRANT SELECT, INSERT ON loi_signoffs TO pactlab_auth;
GRANT SELECT, UPDATE ("status", "countersigned_at", "declined_at", "exclusivity_ends_at") ON loi_versions TO pactlab_auth;
CREATE POLICY loi_versions_webhook ON loi_versions FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY loi_signoffs_webhook ON loi_signoffs FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);

CREATE POLICY audit_events_auth_loi_signing_insert ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NOT NULL AND actor_user_id IS NULL AND target_type = 'signature_envelope'
              AND action IN ('loi.esign_completed', 'loi.esign_declined', 'loi.esign_voided'));

CREATE OR REPLACE FUNCTION app_signing_record(p_provider text, p_envelope text, p_status text)
  RETURNS TABLE (organization_id uuid, deal_id uuid, batch_id uuid, status text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_env signature_envelopes%ROWTYPE;
  v_loi loi_versions%ROWTYPE;
BEGIN
  IF p_status NOT IN ('COMPLETED', 'DECLINED', 'VOIDED') THEN RETURN; END IF;
  SELECT * INTO v_env FROM signature_envelopes e WHERE e.provider = p_provider AND e.provider_envelope_id = p_envelope FOR UPDATE;
  -- Unknown, or already settled: nothing to do (webhooks retry).
  IF NOT FOUND OR v_env.status <> 'SENT' THEN RETURN; END IF;
  UPDATE signature_envelopes SET status = p_status, completed_at = CASE WHEN p_status = 'COMPLETED' THEN now() END WHERE id = v_env.id;
  IF v_env.loi_id IS NOT NULL THEN
    SELECT * INTO v_loi FROM loi_versions l WHERE l.id = v_env.loi_id FOR UPDATE;
    IF v_loi.status = 'SENT' AND p_status = 'COMPLETED' THEN
      INSERT INTO loi_signoffs (id, organization_id, deal_id, loi_id, side, user_id, method, envelope_id)
      VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, v_loi.id, 'BUYER', v_env.buyer_signatory, 'ESIGN', v_env.id),
             (uuidv7(), v_env.organization_id, v_env.deal_id, v_loi.id, 'SELLER', v_env.seller_signatory, 'ESIGN', v_env.id)
      ON CONFLICT DO NOTHING;
      UPDATE loi_versions SET status = 'COUNTERSIGNED', countersigned_at = now(),
             exclusivity_ends_at = now() + make_interval(days => coalesce((v_loi.fields->>'exclusivityDays')::int, 0))
       WHERE id = v_loi.id;
    ELSIF v_loi.status = 'SENT' THEN
      UPDATE loi_versions SET status = 'DECLINED', declined_at = now() WHERE id = v_loi.id;
    END IF;
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, NULL, 'loi.esign_' || lower(p_status), 'signature_envelope', v_env.id::text, 'SUCCEEDED');
    RETURN QUERY SELECT v_env.organization_id, v_env.deal_id, v_env.batch_id, p_status;
    RETURN;
  END IF;
  IF p_status = 'COMPLETED' AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = v_env.batch_id AND b.agreed_at IS NOT NULL AND b.declined_at IS NULL) THEN
    INSERT INTO term_signoffs (id, organization_id, deal_id, batch_id, side, user_id, method, envelope_id)
    VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, v_env.batch_id, 'BUYER', v_env.buyer_signatory, 'ESIGN', v_env.id),
           (uuidv7(), v_env.organization_id, v_env.deal_id, v_env.batch_id, 'SELLER', v_env.seller_signatory, 'ESIGN', v_env.id)
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, NULL, 'terms.esign_' || lower(p_status), 'signature_envelope', v_env.id::text, 'SUCCEEDED');
  RETURN QUERY SELECT v_env.organization_id, v_env.deal_id, v_env.batch_id, p_status;
END
$$;
