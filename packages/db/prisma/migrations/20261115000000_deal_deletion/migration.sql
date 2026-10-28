-- Deleting a deal (Kumar, 2026-10-28): the deal lead removes a deal from
-- everyone's view. Evidence, findings and the audit trail are append-only by
-- design, so a deleted deal is not erased: its stored files are purged (except
-- legal hold), every membership is revoked so nobody can reach it, and it is
-- marked DELETED. Deletion is one-way.
--
-- Expand only. Rollback: drop the trigger, function, constraint and columns.

ALTER TABLE deals ADD COLUMN deleted_at timestamptz(3), ADD COLUMN deleted_by uuid;
ALTER TABLE deals ADD CONSTRAINT deals_deleted_check
  CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL) AND (deleted_at IS NULL OR deleted_by IS NOT NULL));

CREATE FUNCTION deals_deletion_is_one_way() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.status = 'DELETED' AND (NEW.status IS DISTINCT FROM 'DELETED' OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
      RAISE EXCEPTION 'a deleted deal cannot be restored' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER deals_deletion_one_way BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_deletion_is_one_way();
