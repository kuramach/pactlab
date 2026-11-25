-- Import prompting (T-152): what the person told the mapping assistant about a file (free text and
-- notes on numbered rows). Expand only: nullable, nothing existing changes meaning. It steers mapping
-- and is sent only to the mapping job; it never holds a value from the file. Rollback is dropping the column.
ALTER TABLE source_uploads ADD COLUMN guidance jsonb NULL;
GRANT UPDATE (guidance) ON source_uploads TO pactlab_app;
