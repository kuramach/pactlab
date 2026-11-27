-- T-188 (ADR 0062): the multifamily property profile. One row per pact: the address, the public record's
-- proposed fields (third-party reference data, each with its provenance), the values a person reviewed and
-- accepted, and the photo references shown in the gallery (reference material, never evidence).
-- Buyer-confidential: the seller side never sees a profile. Expand only.
-- Rollback: DROP TABLE deal_property_profiles.
CREATE TABLE "deal_property_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EMPTY',
    -- The record as proposed: [{ key, label, value, status, provenance }].
    "proposed" JSONB NOT NULL DEFAULT '[]',
    "record_source" TEXT,
    "record_version" TEXT,
    "record_fetched_at" TIMESTAMPTZ(3),
    -- What a person accepted: { key: { value, status, edited, provenance } }. Edited values keep the record's provenance and say so.
    "accepted" JSONB NOT NULL DEFAULT '{}',
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    -- Photo references (never image bytes): [{ ref, kind, source, capturedOn, attribution, attributionUri, alt }].
    "photos" JSONB NOT NULL DEFAULT '[]',
    "photos_source" TEXT,
    "photos_place_name" TEXT,
    "photos_fetched_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_property_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_property_profiles_status_check" CHECK ("status" IN ('EMPTY', 'PROPOSED', 'ACCEPTED')),
    CONSTRAINT "deal_property_profiles_address_check" CHECK (length(btrim("address")) BETWEEN 5 AND 200),
    CONSTRAINT "deal_property_profiles_json_check" CHECK (
      jsonb_typeof("proposed") = 'array' AND jsonb_typeof("accepted") = 'object' AND jsonb_typeof("photos") = 'array'
      AND jsonb_array_length("photos") <= 12 AND jsonb_array_length("proposed") <= 40)
);
CREATE UNIQUE INDEX "deal_property_profiles_org_deal_key" ON "deal_property_profiles"("organization_id", "deal_id");
ALTER TABLE "deal_property_profiles" ADD CONSTRAINT "deal_property_profiles_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON deal_property_profiles TO pactlab_app;
ALTER TABLE deal_property_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_property_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY deal_property_profiles_buyer_side ON deal_property_profiles FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
