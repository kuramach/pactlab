-- T-075: import formats (CSV, TSV, Excel). Background-import progress lives
-- on the BullMQ job (counts only), not in the database.
-- Expand only: new nullable/defaulted columns; nothing is
-- dropped or rewritten. Existing uploads read as CSV, exactly as before.

-- How an upload's stored original is read, and which workbook sheet.
ALTER TABLE "source_uploads" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'CSV';
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_format_check" CHECK ("format" IN ('CSV', 'TSV', 'XLSX'));
ALTER TABLE "source_uploads" ADD COLUMN "sheet" TEXT;
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_sheet_check" CHECK ("sheet" IS NULL OR ("format" = 'XLSX' AND length("sheet") BETWEEN 1 AND 100));
-- The sheet can be switched before import, which re-reads the header.
GRANT UPDATE ("sheet", "header", "row_count") ON source_uploads TO pactlab_app;

-- Data-room documents may also be CSV or Excel (.xlsx). Expand-only: the
-- allowed set grows; every existing row still satisfies it.
ALTER TABLE documents DROP CONSTRAINT documents_content_type;
ALTER TABLE documents ADD CONSTRAINT documents_content_type
  CHECK (content_type IN (
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ));
