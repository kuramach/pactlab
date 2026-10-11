-- Accept PDF and Word (.docx) documents alongside text and Markdown.
-- Expand-only: the allowed set grows; every existing row still satisfies it.
ALTER TABLE documents DROP CONSTRAINT documents_content_type;
ALTER TABLE documents ADD CONSTRAINT documents_content_type
  CHECK (content_type IN (
    'text/plain',
    'text/markdown',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ));
