-- T-136: in-workflow signing behind a provider seam, BoldSign first (ADR 0036).
-- - Envelopes may be sent with BOLDSIGN, and move SENT -> DELIVERED -> a settled status
--   (COMPLETED, DECLINED, EXPIRED or VOIDED), with the provider's reason where it gives one.
-- - signing_envelope_events: the envelope's timeline, and the deduplication key for provider
--   webhooks (one row per provider event; polling records one row per status it observed).
-- - signing_artifacts: the signed PDF and the provider's certificate of completion, stored once,
--   byte-for-byte, as the pact's legal record of the signature.
-- - organizations.signing_provider: PACTLAB (Pactlab signing, the default) or DOCUSIGN (the
--   organization's own connected DocuSign). Organizations already signing with a connected DocuSign
--   keep it.
-- - app_signing_event: records one provider observation, idempotently. app_signing_record stays
--   unchanged for the release still running.
-- Expand-only. Rollback: drop app_signing_artifact, app_signing_event, signing_artifacts,
-- signing_envelope_events, the new signature_envelopes columns, organizations.signing_provider, the
-- two audit policies; restore the provider and status checks from 20261126000000_two_sided_close.

ALTER TABLE "signature_envelopes" DROP CONSTRAINT "signature_envelopes_provider_check",
  ADD CONSTRAINT "signature_envelopes_provider_check" CHECK ("provider" IN ('FIXTURE', 'DOCUSIGN', 'BOLDSIGN'));
ALTER TABLE "signature_envelopes" DROP CONSTRAINT "signature_envelopes_status_check",
  ADD CONSTRAINT "signature_envelopes_status_check" CHECK ("status" IN ('SENT', 'DELIVERED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED'));
ALTER TABLE "signature_envelopes" ADD COLUMN "status_reason" TEXT,
  ADD COLUMN "status_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "checked_at" TIMESTAMPTZ(3);
GRANT UPDATE ("status_reason", "status_changed_at", "checked_at") ON signature_envelopes TO pactlab_auth;

CREATE TABLE "signing_envelope_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "envelope_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signing_envelope_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "signing_envelope_events_status_check" CHECK ("status" IN ('SENT', 'DELIVERED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED')),
    CONSTRAINT "signing_envelope_events_source_check" CHECK ("source" IN ('APP', 'WEBHOOK', 'POLL')),
    CONSTRAINT "signing_envelope_events_envelope_fkey" FOREIGN KEY ("envelope_id") REFERENCES "signature_envelopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- A provider event is recorded once, however often it is delivered.
CREATE UNIQUE INDEX "signing_envelope_events_dedup_key" ON "signing_envelope_events"("envelope_id", "provider_event_id");

CREATE TABLE "signing_artifacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "envelope_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "stored_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signing_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "signing_artifacts_kind_check" CHECK ("kind" IN ('SIGNED_DOCUMENT', 'CERTIFICATE')),
    CONSTRAINT "signing_artifacts_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "signing_artifacts_key_check" CHECK (starts_with("object_key", "organization_id"::text || '/' || "deal_id"::text || '/signing/')),
    CONSTRAINT "signing_artifacts_envelope_fkey" FOREIGN KEY ("envelope_id") REFERENCES "signature_envelopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "signing_artifacts_kind_key" ON "signing_artifacts"("envelope_id", "kind");

-- Signed artifacts are the legal record: never changed, never deleted.
CREATE FUNCTION signing_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'signing records are kept as received' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER signing_artifacts_immutable BEFORE UPDATE OR DELETE ON signing_artifacts FOR EACH ROW EXECUTE FUNCTION signing_records_immutable();
CREATE TRIGGER signing_envelope_events_immutable BEFORE UPDATE OR DELETE ON signing_envelope_events FOR EACH ROW EXECUTE FUNCTION signing_records_immutable();

ALTER TABLE signing_envelope_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_envelope_events FORCE ROW LEVEL SECURITY;
ALTER TABLE signing_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_artifacts FORCE ROW LEVEL SECURITY;
-- Everyone on the pact reads its envelopes' timelines and signed files, as they read the envelopes.
GRANT SELECT ON signing_envelope_events, signing_artifacts TO pactlab_app;
-- The app writes only the first event, when it sends: the provider's later observations arrive through app_signing_event.
GRANT INSERT ON signing_envelope_events TO pactlab_app;
CREATE POLICY signing_envelope_events_read ON signing_envelope_events FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY signing_envelope_events_sent ON signing_envelope_events FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND source = 'APP' AND status = 'SENT'
              AND EXISTS (SELECT 1 FROM signature_envelopes e WHERE e.id = signing_envelope_events.envelope_id AND e.deal_id = signing_envelope_events.deal_id));
CREATE POLICY signing_artifacts_read ON signing_artifacts FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
GRANT SELECT, INSERT ON signing_envelope_events, signing_artifacts TO pactlab_auth;
CREATE POLICY signing_envelope_events_webhook ON signing_envelope_events FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY signing_artifacts_webhook ON signing_artifacts FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);

-- The new outcomes audited on the deal's chain by the signing functions.
CREATE POLICY audit_events_auth_signing_seam_insert ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NOT NULL AND actor_user_id IS NULL AND target_type = 'signature_envelope'
              AND action IN ('terms.esign_delivered', 'terms.esign_expired', 'loi.esign_delivered', 'loi.esign_expired', 'terms.esign_artifacts_stored', 'loi.esign_artifacts_stored'));

-- Which provider the organization signs new envelopes with (item 9). Owners and admins change it
-- (organizations_admin_update checks the role); envelopes in flight keep their own provider.
ALTER TABLE "organizations" ADD COLUMN "signing_provider" TEXT NOT NULL DEFAULT 'PACTLAB',
  ADD CONSTRAINT "organizations_signing_provider_check" CHECK ("signing_provider" IN ('PACTLAB', 'DOCUSIGN'));
GRANT UPDATE ("signing_provider", "updated_at") ON organizations TO pactlab_app;
-- Organizations that already send from a connected DocuSign keep doing so.
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
UPDATE organizations o SET signing_provider = 'DOCUSIGN'
 WHERE EXISTS (SELECT 1 FROM organization_connections c WHERE c.organization_id = o.id AND c.provider = 'docusign' AND c.disconnected_at IS NULL);
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- One provider observation (a webhook event, a poll, or the fixture), recorded at most once:
-- - p_event names the observation; a second delivery of the same event changes nothing.
-- - Status only moves forward: SENT -> DELIVERED -> a settled status. Anything else is ignored
--   (a poll still stamps checked_at, so the fallback knows when it last looked).
-- - A settled envelope settles its letter of intent or its agreed terms, as app_signing_record does;
--   an expired one expires its letter (the exclusivity clock never starts).
-- Returns the envelope when this call changed it; nothing otherwise.
CREATE FUNCTION app_signing_event(p_provider text, p_envelope text, p_status text, p_reason text, p_event text, p_source text)
  RETURNS TABLE (envelope_row_id uuid, organization_id uuid, deal_id uuid, batch_id uuid, loi_id uuid, status text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_env signature_envelopes%ROWTYPE;
  v_loi loi_versions%ROWTYPE;
  v_reason text := left(nullif(btrim(p_reason), ''), 500);
  v_inserted int;
BEGIN
  IF p_source NOT IN ('WEBHOOK', 'POLL') OR coalesce(p_event, '') = '' THEN RETURN; END IF;
  -- SENT is only ever a poll that found nothing new.
  IF p_status NOT IN ('DELIVERED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED') AND NOT (p_status = 'SENT' AND p_source = 'POLL') THEN RETURN; END IF;
  SELECT * INTO v_env FROM signature_envelopes e WHERE e.provider = p_provider AND e.provider_envelope_id = p_envelope FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_source = 'POLL' THEN UPDATE signature_envelopes SET checked_at = now() WHERE id = v_env.id; END IF;
  -- Forward only: a settled envelope stays settled; DELIVERED only follows SENT.
  IF p_status = 'SENT' OR v_env.status NOT IN ('SENT', 'DELIVERED') OR (p_status = 'DELIVERED' AND v_env.status <> 'SENT') THEN RETURN; END IF;
  INSERT INTO signing_envelope_events (id, organization_id, deal_id, envelope_id, status, reason, source, provider_event_id)
  VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, v_env.id, p_status, v_reason, p_source, left(p_event, 200))
  ON CONFLICT ("envelope_id", "provider_event_id") DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN; END IF;
  UPDATE signature_envelopes SET status = p_status, status_reason = v_reason, status_changed_at = now(),
         completed_at = CASE WHEN p_status = 'COMPLETED' THEN now() END
   WHERE id = v_env.id;
  IF p_status <> 'DELIVERED' AND v_env.loi_id IS NOT NULL THEN
    SELECT * INTO v_loi FROM loi_versions l WHERE l.id = v_env.loi_id FOR UPDATE;
    IF v_loi.status = 'SENT' AND p_status = 'COMPLETED' THEN
      INSERT INTO loi_signoffs (id, organization_id, deal_id, loi_id, side, user_id, method, envelope_id)
      VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, v_loi.id, 'BUYER', v_env.buyer_signatory, 'ESIGN', v_env.id),
             (uuidv7(), v_env.organization_id, v_env.deal_id, v_loi.id, 'SELLER', v_env.seller_signatory, 'ESIGN', v_env.id)
      ON CONFLICT DO NOTHING;
      UPDATE loi_versions SET status = 'COUNTERSIGNED', countersigned_at = now(),
             exclusivity_ends_at = now() + make_interval(days => coalesce((v_loi.fields->>'exclusivityDays')::int, 0))
       WHERE id = v_loi.id;
    ELSIF v_loi.status = 'SENT' AND p_status = 'EXPIRED' THEN
      UPDATE loi_versions SET status = 'EXPIRED' WHERE id = v_loi.id;
    ELSIF v_loi.status = 'SENT' THEN
      UPDATE loi_versions SET status = 'DECLINED', declined_at = now() WHERE id = v_loi.id;
    END IF;
  ELSIF p_status = 'COMPLETED' AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = v_env.batch_id AND b.agreed_at IS NOT NULL AND b.declined_at IS NULL) THEN
    INSERT INTO term_signoffs (id, organization_id, deal_id, batch_id, side, user_id, method, envelope_id)
    VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, v_env.batch_id, 'BUYER', v_env.buyer_signatory, 'ESIGN', v_env.id),
           (uuidv7(), v_env.organization_id, v_env.deal_id, v_env.batch_id, 'SELLER', v_env.seller_signatory, 'ESIGN', v_env.id)
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, NULL, CASE WHEN v_env.loi_id IS NULL THEN 'terms' ELSE 'loi' END || '.esign_' || lower(p_status), 'signature_envelope', v_env.id::text, 'SUCCEEDED');
  RETURN QUERY SELECT v_env.id, v_env.organization_id, v_env.deal_id, v_env.batch_id, v_env.loi_id, p_status;
END
$$;
ALTER FUNCTION app_signing_event(text, text, text, text, text, text) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_signing_event(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_signing_event(text, text, text, text, text, text) TO pactlab_app;

-- A completed envelope's signed PDF or certificate, recorded once (the bytes are already stored
-- under the pact's signing prefix). True when this call recorded it.
CREATE FUNCTION app_signing_artifact(p_envelope uuid, p_kind text, p_key text, p_sha text, p_size int)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_env signature_envelopes%ROWTYPE;
  v_inserted int;
BEGIN
  SELECT * INTO v_env FROM signature_envelopes e WHERE e.id = p_envelope;
  IF NOT FOUND OR v_env.status <> 'COMPLETED' OR p_sha !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  INSERT INTO signing_artifacts (id, organization_id, deal_id, envelope_id, kind, object_key, sha256, size_bytes)
  VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, v_env.id, p_kind, p_key, p_sha, p_size)
  ON CONFLICT ("envelope_id", "kind") DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 AND p_kind = 'CERTIFICATE' THEN
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, NULL, CASE WHEN v_env.loi_id IS NULL THEN 'terms' ELSE 'loi' END || '.esign_artifacts_stored', 'signature_envelope', v_env.id::text, 'SUCCEEDED');
  END IF;
  RETURN v_inserted = 1;
END
$$;
ALTER FUNCTION app_signing_artifact(uuid, text, text, text, int) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_signing_artifact(uuid, text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_signing_artifact(uuid, text, text, text, int) TO pactlab_app;
