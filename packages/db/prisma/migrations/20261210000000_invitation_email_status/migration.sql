-- No silent email failures (T-125). Whether a pact invitation's email went out, so the inviter sees
-- it; and a request for access whose confirmation email could not be sent is withdrawn, so the
-- visitor can simply try again (a pending request would otherwise block the retry).
-- Expand-only: two nullable columns and a function. One transaction, every statement safe to repeat.
-- Rollback: drop the function and the two columns.
BEGIN;
ALTER TABLE "deal_invitations" ADD COLUMN IF NOT EXISTS "email_status" TEXT;
ALTER TABLE "deal_invitations" ADD COLUMN IF NOT EXISTS "email_problem" TEXT;
ALTER TABLE "deal_invitations" DROP CONSTRAINT IF EXISTS "deal_invitations_email_status_check";
ALTER TABLE "deal_invitations" ADD CONSTRAINT "deal_invitations_email_status_check"
  CHECK (("email_status" IS NULL OR "email_status" IN ('SENT', 'FAILED')) AND ("email_problem" IS NULL OR "email_problem" IN ('SUPPRESSED', 'UNAVAILABLE')));

-- Withdraw a request still waiting for its email, by its confirmation token (the email never left).
CREATE OR REPLACE FUNCTION app_listing_interest_withdraw(p_token_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM listing_interests WHERE token_hash = p_token_hash AND status = 'PENDING_EMAIL';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END
$$;
ALTER FUNCTION app_listing_interest_withdraw(text) OWNER TO pactlab_public;
REVOKE ALL ON FUNCTION app_listing_interest_withdraw(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_listing_interest_withdraw(text) TO pactlab_app;
COMMIT;
