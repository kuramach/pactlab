-- T-098 (ADR 0016): document intake. Every file is read by the AI and filed
-- under one category; a person is asked only when the AI is unsure.
--
-- Expand only: new nullable columns (intake_state defaults to UNCLASSIFIED,
-- so existing documents keep working and simply show as not yet sorted).
-- Rollback: drop the columns; nothing else reads them.

ALTER TABLE documents
  ADD COLUMN category            text,
  ADD COLUMN category_source     text,
  ADD COLUMN category_confidence numeric(4, 3),
  ADD COLUMN category_reason     text,
  ADD COLUMN intake_state        text NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN intake_question     text,
  ADD COLUMN entity_name         text,
  ADD COLUMN counterparty_name   text,
  ADD COLUMN source_path         text,
  ADD COLUMN classified_run_id   uuid,
  ADD COLUMN categorized_by      uuid,
  ADD COLUMN categorized_at      timestamptz(3);

ALTER TABLE documents
  ADD CONSTRAINT documents_intake_state_check
    CHECK (intake_state IN ('UNCLASSIFIED', 'FILED', 'NEEDS_YOU', 'NOT_READ')),
  ADD CONSTRAINT documents_category_source_check
    CHECK (category_source IS NULL OR category_source IN ('AI', 'PERSON')),
  ADD CONSTRAINT documents_category_confidence_check
    CHECK (category_confidence IS NULL OR (category_confidence >= 0 AND category_confidence <= 1)),
  -- A filed document always says what it is and who decided.
  ADD CONSTRAINT documents_filed_has_category_check
    CHECK (intake_state <> 'FILED' OR (category IS NOT NULL AND category_source IS NOT NULL)),
  -- A person's decision names the person.
  ADD CONSTRAINT documents_person_category_check
    CHECK (category_source IS DISTINCT FROM 'PERSON' OR categorized_by IS NOT NULL);

-- Buyer side files documents (the documents_update policy is unchanged:
-- buyer-side members of the deal only).
GRANT UPDATE (
  category, category_source, category_confidence, category_reason,
  intake_state, intake_question, entity_name, counterparty_name,
  classified_run_id, categorized_by, categorized_at, ai_excluded
) ON documents TO pactlab_app;

CREATE INDEX documents_intake_state_idx ON documents (organization_id, deal_id, intake_state);

-- Filing a file as named people data (rule 7) excludes it from AI; nothing
-- may lift an exclusion once set.
CREATE FUNCTION documents_ai_exclusion_is_one_way() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.ai_excluded AND NOT NEW.ai_excluded THEN
      RAISE EXCEPTION 'ai_excluded cannot be lifted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER documents_ai_exclusion_one_way
  BEFORE UPDATE OF ai_excluded ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_ai_exclusion_is_one_way();
