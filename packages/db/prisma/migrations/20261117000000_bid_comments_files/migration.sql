-- T-097 (ADR 0015): a bidder comments on a document the seller shared, and
-- attaches files to their bid (a marked-up agreement, a letter of intent).
-- Both are bid-scoped rows — never documents in the shared library — so the
-- same isolation applies as for questions and offers: the seller's side and
-- that bidder's firm see them; no other bidder does.
--
-- Expand only. Rollback: drop the two tables.

CREATE TABLE "bid_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "bid_id" UUID NOT NULL,
    -- The shared document commented on.
    "document_id" UUID NOT NULL,
    "page_number" INTEGER,
    -- The passage commented on, copied from the page (optional).
    "quote" TEXT,
    "body" TEXT NOT NULL,
    -- A reply in the thread (the seller answering, or the bidder following up).
    "parent_id" UUID,
    -- BIDDER or SELLER: who wrote it.
    "author_side" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_comments_side_check" CHECK ("author_side" IN ('BIDDER', 'SELLER')),
    CONSTRAINT "bid_comments_body_check" CHECK (length("body") BETWEEN 1 AND 8000),
    CONSTRAINT "bid_comments_quote_check" CHECK ("quote" IS NULL OR length("quote") <= 2000),
    CONSTRAINT "bid_comments_page_check" CHECK ("page_number" IS NULL OR "page_number" >= 1)
);
CREATE UNIQUE INDEX "bid_comments_org_deal_id_key" ON "bid_comments"("organization_id", "deal_id", "id");
CREATE INDEX "bid_comments_bid_idx" ON "bid_comments"("organization_id", "deal_id", "bid_id", "created_at");
ALTER TABLE "bid_comments" ADD CONSTRAINT "bid_comments_bid_fkey" FOREIGN KEY ("organization_id", "deal_id", "bid_id") REFERENCES "bids"("organization_id", "deal_id", "id") ON DELETE RESTRICT;
ALTER TABLE "bid_comments" ADD CONSTRAINT "bid_comments_document_fkey" FOREIGN KEY ("organization_id", "deal_id", "document_id") REFERENCES "documents"("organization_id", "deal_id", "id") ON DELETE RESTRICT;
ALTER TABLE "bid_comments" ADD CONSTRAINT "bid_comments_parent_fkey" FOREIGN KEY ("organization_id", "deal_id", "parent_id") REFERENCES "bid_comments"("organization_id", "deal_id", "id") ON DELETE RESTRICT;

CREATE TABLE "bid_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "bid_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "object_key" TEXT NOT NULL,
    "malware_scanner" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_files_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "bid_files_key_check" CHECK (starts_with("object_key", "organization_id"::text || '/' || "deal_id"::text || '/bids/'))
);
CREATE UNIQUE INDEX "bid_files_object_key_key" ON "bid_files"("object_key");
CREATE INDEX "bid_files_bid_idx" ON "bid_files"("organization_id", "deal_id", "bid_id", "created_at");
ALTER TABLE "bid_files" ADD CONSTRAINT "bid_files_bid_fkey" FOREIGN KEY ("organization_id", "deal_id", "bid_id") REFERENCES "bids"("organization_id", "deal_id", "id") ON DELETE RESTRICT;

-- Append-only: no UPDATE or DELETE for the app.
GRANT SELECT, INSERT ON bid_comments, bid_files TO pactlab_app;
ALTER TABLE bid_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE bid_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_files FORCE ROW LEVEL SECURITY;

-- The seller's side reads every bid's comments and files, and replies as the seller.
CREATE POLICY bid_comments_own_side_read ON bid_comments FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY bid_comments_own_side_reply ON bid_comments FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id)
              AND author_side = 'SELLER' AND author_id = app_current_user_id() AND parent_id IS NOT NULL);
-- A bidder reads and writes only their own bid's thread, as themselves.
CREATE POLICY bid_comments_bidder_read ON bid_comments FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id));
CREATE POLICY bid_comments_bidder_write ON bid_comments FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id) AND author_side = 'BIDDER' AND author_id = app_current_user_id());

CREATE POLICY bid_files_own_side_read ON bid_files FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY bid_files_bidder_read ON bid_files FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id));
CREATE POLICY bid_files_bidder_write ON bid_files FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id) AND uploaded_by = app_current_user_id());
