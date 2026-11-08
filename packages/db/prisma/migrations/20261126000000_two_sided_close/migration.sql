-- T-107 (ADR 0022): two-sided agreement and close. Expand-only.
--   1. the headline price as a term; either side may propose a version; an agreed version may be declined;
--   2. a named signatory per side; sign-off by both (in app, or by e-signature);
--   3. a closing checklist both sides tick, with a funds-transfer item (buyer marks paid, seller confirms);
--   4. e-signature envelopes, recorded by a webhook through a definer function;
--   5. the close itself, and an organization's own DocuSign connection.
-- Rollback: drop the new tables, functions and columns; restore the policies and trigger
-- function from 20261124000000 and 20261125000000.

-- A seller contributor on this pact (the seller's side of a buyer-led pact).
CREATE FUNCTION app_is_seller_contributor(target_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id() AND m.deal_id = target_deal
         AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role = 'TARGET_CONTRIBUTOR')
  $$;

-- 1. Terms: the headline price, either side proposing, declining an agreed version.
ALTER TABLE "term_proposals" DROP CONSTRAINT "term_proposals_lever_check",
  ADD CONSTRAINT "term_proposals_lever_check" CHECK ("lever" IN ('PURCHASE_PRICE', 'PRICE_REDUCTION', 'REMEDIATION_COST', 'ESCROW', 'INDEMNITY', 'RETENTION', 'EARNOUT', 'SELLER_FINANCING'));
ALTER TABLE "term_proposal_batches"
  ADD COLUMN "initiated_by_side" TEXT NOT NULL DEFAULT 'BUYER',
  ADD COLUMN "declined_at" TIMESTAMPTZ(3),
  ADD COLUMN "declined_by" UUID,
  ADD CONSTRAINT "term_proposal_batches_side_check" CHECK ("initiated_by_side" IN ('BUYER', 'SELLER')),
  ADD CONSTRAINT "term_proposal_batches_declined_check" CHECK (("declined_at" IS NULL) = ("declined_by" IS NULL) AND ("declined_at" IS NULL OR "agreed_at" IS NOT NULL));
-- A seller-initiated version is evaluated by the seller, not priced from a buyer evaluation.
ALTER TABLE "term_proposal_batches" ALTER COLUMN "evaluation_id" DROP NOT NULL,
  ADD CONSTRAINT "term_proposal_batches_evaluation_check" CHECK ("initiated_by_side" = 'SELLER' OR "evaluation_id" IS NOT NULL);

-- The buyer sees the seller's versions only once proposed; each side drafts its own.
DROP POLICY term_proposal_batches_buyer_side ON term_proposal_batches;
CREATE POLICY term_proposal_batches_buyer_side ON term_proposal_batches FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
         AND (initiated_by_side = 'BUYER' OR proposed_at IS NOT NULL))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
         AND (initiated_by_side = 'BUYER' OR proposed_at IS NOT NULL));
CREATE POLICY term_proposal_batches_seller_side ON term_proposal_batches FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_seller_contributor(deal_id) AND initiated_by_side = 'SELLER')
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_seller_contributor(deal_id) AND initiated_by_side = 'SELLER');
DROP POLICY term_proposals_buyer_side ON term_proposals;
CREATE POLICY term_proposals_buyer_side ON term_proposals FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
         AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = term_proposals.batch_id AND (b.initiated_by_side = 'BUYER' OR b.proposed_at IS NOT NULL)))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
         AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = term_proposals.batch_id AND b.initiated_by_side = 'BUYER'));
CREATE POLICY term_proposals_seller_side ON term_proposals FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_seller_contributor(deal_id)
         AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = term_proposals.batch_id AND b.initiated_by_side = 'SELLER'))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_seller_contributor(deal_id)
         AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = term_proposals.batch_id AND b.initiated_by_side = 'SELLER'));

-- The other side answers: the seller answers the buyer's versions, the buyer the seller's.
DROP POLICY term_responses_seller_insert ON term_responses;
CREATE POLICY term_responses_insert ON term_responses FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND responded_by = app_current_user_id()
    AND app_terms_open_for_response(batch_id)
    AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = term_responses.batch_id
                  AND ((b.initiated_by_side = 'BUYER' AND app_is_seller_contributor(term_responses.deal_id))
                    OR (b.initiated_by_side = 'SELLER' AND app_is_buyer_side(term_responses.deal_id)))));

-- Proposed versions freeze; an agreed one may be marked agreed once, and declined once.
CREATE OR REPLACE FUNCTION app_term_proposals_frozen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'term_proposal_batches' THEN
    IF OLD.proposed_at IS NOT NULL THEN
      IF OLD.agreed_at IS NULL AND NEW.agreed_at IS NOT NULL
         AND (to_jsonb(NEW) - 'agreed_at') = (to_jsonb(OLD) - 'agreed_at') AND app_terms_all_accepted(OLD.id) THEN
        RETURN NEW;
      END IF;
      IF OLD.agreed_at IS NOT NULL AND OLD.declined_at IS NULL AND NEW.declined_at IS NOT NULL
         AND (to_jsonb(NEW) - 'declined_at' - 'declined_by') = (to_jsonb(OLD) - 'declined_at' - 'declined_by')
         AND NOT EXISTS (SELECT 1 FROM term_signoffs s WHERE s.batch_id = OLD.id) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'term proposal batch % is already proposed', OLD.id;
    END IF;
    IF NEW.proposed_at IS NULL OR NEW.agreed_at IS NOT NULL OR NEW.declined_at IS NOT NULL
       OR (to_jsonb(NEW) - 'proposed_at' - 'proposed_by') <> (to_jsonb(OLD) - 'proposed_at' - 'proposed_by') THEN
      RAISE EXCEPTION 'a term proposal batch only changes by being proposed';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = OLD.batch_id AND b.proposed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'terms of proposed batch % are frozen', OLD.batch_id;
    END IF;
    IF (to_jsonb(NEW) - 'seller_note') <> (to_jsonb(OLD) - 'seller_note') THEN
      RAISE EXCEPTION 'only the note of a draft term changes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
GRANT UPDATE ("declined_at", "declined_by") ON term_proposal_batches TO pactlab_app;

-- 2. Signatories (append-only; the latest per side counts) and sign-offs (insert-only).
CREATE TABLE "pact_signatories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "named_by" UUID NOT NULL,
    "named_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pact_signatories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pact_signatories_side_check" CHECK ("side" IN ('BUYER', 'SELLER'))
);
CREATE INDEX "pact_signatories_deal_idx" ON "pact_signatories"("organization_id", "deal_id", "side", "named_at");
ALTER TABLE "pact_signatories" ADD CONSTRAINT "pact_signatories_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The current signatory of a side on a deal, or null.
CREATE FUNCTION app_current_signatory(target_deal uuid, target_side text) RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT s.user_id FROM pact_signatories s
     WHERE s.deal_id = target_deal AND s.side = target_side
     ORDER BY s.named_at DESC, s.id DESC LIMIT 1
  $$;

CREATE TABLE "term_signoffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "envelope_id" UUID,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "term_signoffs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "term_signoffs_side_check" CHECK ("side" IN ('BUYER', 'SELLER')),
    CONSTRAINT "term_signoffs_method_check" CHECK ("method" IN ('IN_APP', 'ESIGN') AND (("method" = 'ESIGN') = ("envelope_id" IS NOT NULL)))
);
CREATE UNIQUE INDEX "term_signoffs_batch_side_key" ON "term_signoffs"("batch_id", "side");
ALTER TABLE "term_signoffs" ADD CONSTRAINT "term_signoffs_batch_fkey" FOREIGN KEY ("organization_id", "deal_id", "batch_id") REFERENCES "term_proposal_batches"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. The closing checklist. A CONDITION is ticked once by its owning side. FUNDS: the buyer
--    records the payment (amount, reference, date, optional proof), the seller confirms receipt
--    (done) or disputes it, which sends it back to the buyer. Pactlab never moves money.
CREATE TABLE "closing_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONDITION',
    "title" TEXT NOT NULL,
    "owner_side" TEXT NOT NULL,
    "amount" DECIMAL(20,2),
    "currency" CHAR(3),
    "paid_at" TIMESTAMPTZ(3),
    "paid_by" UUID,
    "paid_on" DATE,
    "paid_reference" TEXT,
    "proof_document_id" UUID,
    "disputed_at" TIMESTAMPTZ(3),
    "dispute_note" TEXT,
    "done_at" TIMESTAMPTZ(3),
    "done_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "closing_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "closing_items_kind_check" CHECK ("kind" IN ('CONDITION', 'FUNDS')),
    CONSTRAINT "closing_items_side_check" CHECK ("owner_side" IN ('BUYER', 'SELLER')),
    -- Funds are confirmed by the side that receives them.
    CONSTRAINT "closing_items_funds_check" CHECK ("kind" = 'CONDITION' OR ("owner_side" = 'SELLER' AND "amount" > 0 AND "currency" ~ '^[A-Z]{3}$')),
    CONSTRAINT "closing_items_text_check" CHECK (length(btrim("title")) BETWEEN 2 AND 200 AND ("paid_reference" IS NULL OR length("paid_reference") <= 120) AND ("dispute_note" IS NULL OR length("dispute_note") <= 1000)),
    CONSTRAINT "closing_items_done_check" CHECK (("done_at" IS NULL) = ("done_by" IS NULL) AND ("kind" = 'CONDITION' OR "done_at" IS NULL OR "paid_at" IS NOT NULL))
);
CREATE INDEX "closing_items_deal_idx" ON "closing_items"("organization_id", "deal_id", "created_at");
ALTER TABLE "closing_items" ADD CONSTRAINT "closing_items_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION app_closing_items_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_buyer boolean := app_is_buyer_side(OLD.deal_id);
  v_seller boolean := app_is_seller_contributor(OLD.deal_id);
BEGIN
  IF OLD.done_at IS NOT NULL THEN RAISE EXCEPTION 'closing item % is done', OLD.id; END IF;
  IF (NEW.id, NEW.organization_id, NEW.deal_id, NEW.kind, NEW.title, NEW.owner_side, NEW.amount, NEW.currency, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.deal_id, OLD.kind, OLD.title, OLD.owner_side, OLD.amount, OLD.currency, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a closing item''s description is fixed once added';
  END IF;
  -- Ticking (or confirming funds) belongs to the owning side, as itself.
  IF NEW.done_at IS NOT NULL THEN
    IF NOT ((OLD.owner_side = 'BUYER' AND v_buyer) OR (OLD.owner_side = 'SELLER' AND v_seller)) OR NEW.done_by <> app_current_user_id() THEN
      RAISE EXCEPTION 'only the owning side ticks this item';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.kind = 'FUNDS' THEN
    -- The buyer records the payment; the seller disputes it.
    IF (NEW.paid_at, NEW.paid_by, NEW.paid_on, NEW.paid_reference, NEW.proof_document_id) IS DISTINCT FROM (OLD.paid_at, OLD.paid_by, OLD.paid_on, OLD.paid_reference, OLD.proof_document_id) THEN
      IF NEW.paid_at IS NOT NULL AND (NOT v_buyer OR NEW.paid_by <> app_current_user_id()) THEN RAISE EXCEPTION 'only the buyer records a payment'; END IF;
      IF NEW.paid_at IS NULL AND NOT v_seller THEN RAISE EXCEPTION 'only the seller disputes a payment'; END IF;
    END IF;
    IF (NEW.disputed_at, NEW.dispute_note) IS DISTINCT FROM (OLD.disputed_at, OLD.dispute_note) AND NEW.disputed_at IS NOT NULL AND NOT v_seller THEN
      RAISE EXCEPTION 'only the seller disputes a payment';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a condition only changes by being ticked';
END;
$$;
CREATE TRIGGER closing_items_guard BEFORE UPDATE ON closing_items FOR EACH ROW EXECUTE FUNCTION app_closing_items_guard();

-- 4. E-signature envelopes. Sent by the buyer side; completed by the provider's webhook only.
CREATE TABLE "signature_envelopes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_envelope_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "term_sheet_sha256" CHAR(64) NOT NULL,
    "agreement_document_id" UUID,
    "buyer_signatory" UUID NOT NULL,
    "seller_signatory" UUID NOT NULL,
    "sent_by" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "signature_envelopes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "signature_envelopes_provider_check" CHECK ("provider" IN ('FIXTURE', 'DOCUSIGN')),
    CONSTRAINT "signature_envelopes_status_check" CHECK ("status" IN ('SENT', 'COMPLETED', 'DECLINED', 'VOIDED'))
);
CREATE UNIQUE INDEX "signature_envelopes_provider_key" ON "signature_envelopes"("provider", "provider_envelope_id");
CREATE INDEX "signature_envelopes_batch_idx" ON "signature_envelopes"("batch_id", "sent_at");
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_batch_fkey" FOREIGN KEY ("organization_id", "deal_id", "batch_id") REFERENCES "term_proposal_batches"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "term_signoffs" ADD CONSTRAINT "term_signoffs_envelope_fkey" FOREIGN KEY ("envelope_id") REFERENCES "signature_envelopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. The close, recorded once; and an organization's own DocuSign connection.
ALTER TABLE "deals" ADD COLUMN "closed_at" TIMESTAMPTZ(3), ADD COLUMN "closed_by_buyer" UUID, ADD COLUMN "closed_by_seller" UUID;

CREATE TABLE "organization_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "credential_ref" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "base_uri" TEXT NOT NULL,
    "connected_by" UUID NOT NULL,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMPTZ(3),

    CONSTRAINT "organization_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_connections_provider_check" CHECK ("provider" IN ('docusign')),
    CONSTRAINT "organization_connections_ref_check" CHECK ("credential_ref" ~ '^secretref:'),
    CONSTRAINT "organization_connections_uri_check" CHECK ("base_uri" ~ '^https://')
);
CREATE UNIQUE INDEX "organization_connections_active_key" ON "organization_connections"("organization_id", "provider") WHERE "disconnected_at" IS NULL;
ALTER TABLE "organization_connections" ADD CONSTRAINT "organization_connections_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants and row security.
GRANT SELECT, INSERT ON pact_signatories, term_signoffs, closing_items, signature_envelopes, organization_connections TO pactlab_app;
GRANT UPDATE ("paid_at", "paid_by", "paid_on", "paid_reference", "proof_document_id", "disputed_at", "dispute_note", "done_at", "done_by") ON closing_items TO pactlab_app;
GRANT UPDATE ("disconnected_at") ON organization_connections TO pactlab_app;
GRANT UPDATE ("closed_at", "closed_by_buyer", "closed_by_seller") ON deals TO pactlab_app;
ALTER TABLE pact_signatories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pact_signatories FORCE ROW LEVEL SECURITY;
ALTER TABLE term_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_signoffs FORCE ROW LEVEL SECURITY;
ALTER TABLE closing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE closing_items FORCE ROW LEVEL SECURITY;
ALTER TABLE signature_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_envelopes FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_connections FORCE ROW LEVEL SECURITY;

-- Everyone on the pact reads who signs, what was signed, the checklist and the envelopes.
CREATE POLICY pact_signatories_read ON pact_signatories FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY term_signoffs_read ON term_signoffs FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY closing_items_read ON closing_items FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY signature_envelopes_read ON signature_envelopes FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
-- Each side names its own signatory, from its own side.
CREATE POLICY pact_signatories_insert ON pact_signatories FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND named_by = app_current_user_id()
    AND ((side = 'BUYER' AND app_is_buyer_side(deal_id)
          AND EXISTS (SELECT 1 FROM deal_memberships m WHERE m.organization_id = pact_signatories.organization_id AND m.deal_id = pact_signatories.deal_id
                        AND m.user_id = pact_signatories.user_id AND m.status = 'ACTIVE' AND m.role NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER', 'VIEWER')))
      OR (side = 'SELLER' AND app_is_seller_contributor(deal_id)
          AND EXISTS (SELECT 1 FROM deal_memberships m WHERE m.organization_id = pact_signatories.organization_id AND m.deal_id = pact_signatories.deal_id
                        AND m.user_id = pact_signatories.user_id AND m.status = 'ACTIVE' AND m.role = 'TARGET_CONTRIBUTOR'))));
-- In-app sign-off: only the side's current signatory, as themselves, on an agreed and undeclined version.
CREATE POLICY term_signoffs_in_app ON term_signoffs FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND method = 'IN_APP' AND user_id = app_current_user_id() AND app_current_signatory(deal_id, side) = app_current_user_id()
    AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = term_signoffs.batch_id AND b.agreed_at IS NOT NULL AND b.declined_at IS NULL));
-- Either side adds checklist items; updates are policed by the trigger.
CREATE POLICY closing_items_insert ON closing_items FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND created_by = app_current_user_id()
              AND (app_is_buyer_side(deal_id) OR app_is_seller_contributor(deal_id)) AND done_at IS NULL AND paid_at IS NULL);
CREATE POLICY closing_items_update ON closing_items FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND (app_is_buyer_side(deal_id) OR app_is_seller_contributor(deal_id)))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
-- The buyer side sends envelopes, from its own organization's account.
CREATE POLICY signature_envelopes_insert ON signature_envelopes FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND sent_by = app_current_user_id() AND status = 'SENT');
-- Organization connections: members read; owners and admins connect and disconnect.
CREATE POLICY organization_connections_read ON organization_connections FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id());
CREATE POLICY organization_connections_admin ON organization_connections FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND EXISTS (
    SELECT 1 FROM organization_memberships m WHERE m.organization_id = organization_connections.organization_id AND m.user_id = app_current_user_id() AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')))
  WITH CHECK (organization_id = app_current_organization_id() AND connected_by = app_current_user_id() AND EXISTS (
    SELECT 1 FROM organization_memberships m WHERE m.organization_id = organization_connections.organization_id AND m.user_id = app_current_user_id() AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')));

-- The provider's webhook (no user session) records an envelope's outcome through this
-- definer function, owned by the sign-in role: on completion, both sign-offs as e-signed.
GRANT SELECT, UPDATE ("status", "completed_at") ON signature_envelopes TO pactlab_auth;
GRANT SELECT, INSERT ON term_signoffs TO pactlab_auth;
GRANT SELECT ("id", "agreed_at", "declined_at") ON term_proposal_batches TO pactlab_auth;
CREATE POLICY signature_envelopes_webhook ON signature_envelopes FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY term_signoffs_webhook ON term_signoffs FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY term_proposal_batches_webhook ON term_proposal_batches FOR SELECT TO pactlab_auth USING (true);
CREATE FUNCTION app_signing_record(p_provider text, p_envelope text, p_status text)
  RETURNS TABLE (organization_id uuid, deal_id uuid, batch_id uuid, status text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_env signature_envelopes%ROWTYPE;
BEGIN
  IF p_status NOT IN ('COMPLETED', 'DECLINED', 'VOIDED') THEN RETURN; END IF;
  SELECT * INTO v_env FROM signature_envelopes e WHERE e.provider = p_provider AND e.provider_envelope_id = p_envelope FOR UPDATE;
  -- Unknown, or already settled: nothing to do (webhooks retry).
  IF NOT FOUND OR v_env.status <> 'SENT' THEN RETURN; END IF;
  UPDATE signature_envelopes SET status = p_status, completed_at = CASE WHEN p_status = 'COMPLETED' THEN now() END WHERE id = v_env.id;
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
ALTER FUNCTION app_signing_record(text, text, text) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_signing_record(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_signing_record(text, text, text) TO pactlab_app;
REVOKE ALL ON FUNCTION app_is_seller_contributor(uuid), app_current_signatory(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_seller_contributor(uuid), app_current_signatory(uuid, text) TO pactlab_app, pactlab_auth;
