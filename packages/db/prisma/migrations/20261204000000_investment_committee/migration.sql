-- Investment committee (T-118, ADR 0029): the committee decides the deal. An IC pack (a versioned
-- report, T-110) is submitted; an IC member records APPROVE, APPROVE_WITH_CONDITIONS or DECLINE;
-- when the pact requires it, signing waits for approval. Buyer-side only: the seller and bidders
-- never see any of it.
-- Also fixes report visibility (found here): a report version was readable by anyone on its pact
-- in its organization, which let a seller (a guest there) read the buyer's reports. Now a report
-- is readable by the person who generated it and, for a pact report made by the pact's own side,
-- by the rest of that side only.
-- Expand-only: an enum value, nullable or defaulted columns, new tables, replaced policies.
-- Rollback: drop the ic_* tables, the new columns and functions; restore report_versions_tenant
-- and report_versions_scope from 20261201000000_reports. (The enum value stays; unused.)

-- 1. The committee: a deal role, and an organization-wide list.
ALTER TYPE "deal_role" ADD VALUE IF NOT EXISTS 'INVESTMENT_COMMITTEE';
ALTER TABLE "organization_memberships" ADD COLUMN "investment_committee" BOOLEAN NOT NULL DEFAULT false;

-- 2. The gate: off unless the organization switches it on; a pact may override either way.
ALTER TABLE "organizations"
  ADD COLUMN "ic_approval_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ic_clears_conditions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deals" ADD COLUMN "ic_approval_required" BOOLEAN;
GRANT UPDATE ("ic_approval_required", "ic_clears_conditions", "updated_at") ON organizations TO pactlab_app;

-- 3. IC packs are report versions of their own scope; each version records whose side made it.
ALTER TABLE "report_versions" DROP CONSTRAINT "report_versions_scope";
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_scope"
  CHECK (("scope" = 'EXECUTIVE' AND "deal_id" IS NULL) OR ("scope" IN ('PACT', 'IC') AND "deal_id" IS NOT NULL));
ALTER TABLE "report_versions" ADD COLUMN "own_side" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "report_versions" ADD COLUMN "series" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
-- The backfill below rewrites finished versions, which the immutability trigger refuses, and it runs
-- as the table owner, whom FORCE ROW LEVEL SECURITY limits like anyone else (deployed databases do
-- not migrate as a superuser). Both are lifted for this transaction only and restored right after.
ALTER TABLE report_versions DISABLE TRIGGER report_versions_immutable;
ALTER TABLE report_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_memberships NO FORCE ROW LEVEL SECURITY;
-- Versions so far: made by the pact's own side when the generator holds a non-counterparty role on it.
UPDATE report_versions r SET own_side = true
 WHERE r.deal_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM deal_memberships m
    WHERE m.deal_id = r.deal_id AND m.user_id = r.generated_by AND m.role::text NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER'));

-- Version numbers run per series: the pact's own side shares one; anyone else (the seller's people,
-- and executive reports, which stay with their author) numbers their own. So nobody can read
-- another side's activity from a gap in the numbers, and numbers never collide.
UPDATE report_versions SET series = CASE WHEN own_side THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE generated_by END;
ALTER TABLE report_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE report_versions ENABLE TRIGGER report_versions_immutable;
DROP INDEX "report_versions_scope_version_key";
CREATE UNIQUE INDEX "report_versions_scope_version_key" ON "report_versions"("organization_id", "scope", COALESCE("deal_id", '00000000-0000-0000-0000-000000000000'::uuid), "series", "version");

-- Set on insert from the generator's own session, never by the caller.
CREATE FUNCTION report_versions_own_side() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.own_side := NEW.deal_id IS NOT NULL AND app_is_buyer_side(NEW.deal_id);
  NEW.series := CASE WHEN NEW.own_side THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE NEW.generated_by END;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_versions_own_side BEFORE INSERT ON report_versions FOR EACH ROW EXECUTE FUNCTION report_versions_own_side();

-- The generator always; a pact report made by the own side, the rest of the own side. An executive
-- report covers pacts others may not be on, so it stays with whoever generated it.
DROP POLICY report_versions_tenant ON report_versions;
CREATE POLICY report_versions_tenant ON report_versions FOR ALL TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids()))
    AND (generated_by = app_current_user_id() OR (deal_id IS NOT NULL AND own_side AND app_is_buyer_side(deal_id)))
  )
  WITH CHECK (
    organization_id = app_current_organization_id()
    AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids()))
    AND generated_by = app_current_user_id()
    -- Only the pact's own side makes IC packs.
    AND (scope <> 'IC' OR app_is_buyer_side(deal_id))
  );

-- 4. Submissions, decisions and conditions.
CREATE TABLE "ic_submissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "report_version_id" UUID NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ic_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ic_submissions_report_version_id_key" UNIQUE ("report_version_id"),
    CONSTRAINT "ic_submissions_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ic_submissions_report_fkey" FOREIGN KEY ("report_version_id") REFERENCES "report_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ic_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ic_submissions_deal_idx" ON "ic_submissions"("organization_id", "deal_id", "submitted_at" DESC);

CREATE TABLE "ic_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ic_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ic_decisions_submission_id_key" UNIQUE ("submission_id"),
    CONSTRAINT "ic_decisions_decision_check" CHECK ("decision" IN ('APPROVE', 'APPROVE_WITH_CONDITIONS', 'DECLINE')),
    CONSTRAINT "ic_decisions_note_check" CHECK (char_length(btrim("note")) BETWEEN 3 AND 4000),
    CONSTRAINT "ic_decisions_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ic_decisions_submission_fkey" FOREIGN KEY ("submission_id") REFERENCES "ic_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ic_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ic_conditions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "addressed_by" UUID,
    "addressed_at" TIMESTAMPTZ(3),
    "addressed_note" TEXT,
    "cleared_by" UUID,
    "cleared_at" TIMESTAMPTZ(3),
    CONSTRAINT "ic_conditions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ic_conditions_ordinal_key" UNIQUE ("decision_id", "ordinal"),
    CONSTRAINT "ic_conditions_status_check" CHECK ("status" IN ('OPEN', 'ADDRESSED', 'CLEARED')),
    CONSTRAINT "ic_conditions_text_check" CHECK (char_length(btrim("text")) BETWEEN 3 AND 1000),
    CONSTRAINT "ic_conditions_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ic_conditions_decision_fkey" FOREIGN KEY ("decision_id") REFERENCES "ic_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 5. The record is kept: submissions and decisions never change; a condition only moves forward.
CREATE FUNCTION ic_record_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'investment committee records are append-only' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER ic_submissions_immutable BEFORE UPDATE OR DELETE ON ic_submissions FOR EACH ROW EXECUTE FUNCTION ic_record_immutable();
CREATE TRIGGER ic_decisions_immutable BEFORE UPDATE OR DELETE ON ic_decisions FOR EACH ROW EXECUTE FUNCTION ic_record_immutable();

CREATE FUNCTION ic_conditions_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'investment committee records are append-only' USING ERRCODE = '42501'; END IF;
  IF NEW.id <> OLD.id OR NEW.decision_id <> OLD.decision_id OR NEW.text <> OLD.text OR NEW.ordinal <> OLD.ordinal
     OR NOT ((OLD.status = 'OPEN' AND NEW.status IN ('ADDRESSED', 'CLEARED')) OR (OLD.status = 'ADDRESSED' AND NEW.status = 'CLEARED')) THEN
    RAISE EXCEPTION 'a condition only moves from open to addressed to cleared' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER ic_conditions_forward BEFORE UPDATE OR DELETE ON ic_conditions FOR EACH ROW EXECUTE FUNCTION ic_conditions_forward();

-- 6. Buyer-side only, on the caller's pacts. Decisions only by a committee member, as themselves.
CREATE FUNCTION app_is_ic_member(target_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id() AND m.deal_id = target_deal
         AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role::text = 'INVESTMENT_COMMITTEE'
    )
  $$;
GRANT EXECUTE ON FUNCTION app_is_ic_member(uuid) TO pactlab_app;

ALTER TABLE ic_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ic_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ic_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ic_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE ic_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE ic_conditions FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON ic_submissions, ic_decisions, ic_conditions TO pactlab_app;
GRANT UPDATE ("status", "addressed_by", "addressed_at", "addressed_note", "cleared_by", "cleared_at") ON ic_conditions TO pactlab_app;

CREATE POLICY ic_submissions_own_side ON ic_submissions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND submitted_by = app_current_user_id());
CREATE POLICY ic_decisions_own_side ON ic_decisions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_ic_member(deal_id) AND decided_by = app_current_user_id());
CREATE POLICY ic_conditions_own_side ON ic_conditions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
