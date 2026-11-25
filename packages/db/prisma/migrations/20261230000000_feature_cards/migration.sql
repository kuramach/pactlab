-- Feature cards (T-155): which "what's new" cards a person dismissed and read. Per user, never per
-- organization: one colleague dismissing a card never hides it from another. The cards themselves
-- live in code (apps/api feature-cards registry); this table keeps only the versions a user has
-- dismissed and read, so a new version of a card comes back by itself.
-- Expand-only: a new table. Rollback: drop table user_feature_cards.

CREATE TABLE "user_feature_cards" (
    "user_id" UUID NOT NULL,
    "card_id" TEXT NOT NULL,
    "dismissed_version" INTEGER NOT NULL DEFAULT 0,
    "read_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_feature_cards_pkey" PRIMARY KEY ("user_id", "card_id"),
    CONSTRAINT "user_feature_cards_card_id_check" CHECK ("card_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    CONSTRAINT "user_feature_cards_versions_check" CHECK ("dismissed_version" >= 0 AND "read_version" >= 0),
    CONSTRAINT "user_feature_cards_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- A person reads and writes only their own rows.
ALTER TABLE user_feature_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feature_cards FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON user_feature_cards TO pactlab_app;
CREATE POLICY user_feature_cards_own_read ON user_feature_cards FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id());
CREATE POLICY user_feature_cards_own_insert ON user_feature_cards FOR INSERT TO pactlab_app
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY user_feature_cards_own_update ON user_feature_cards FOR UPDATE TO pactlab_app
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
