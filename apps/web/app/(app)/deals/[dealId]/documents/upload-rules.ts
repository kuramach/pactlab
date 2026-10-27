/**
 * What the Documents uploader accepts, checked in the browser before any
 * bytes move and again in the server action (the API enforces the same
 * limits). Shared so a file is never accepted in one place and refused in
 * the other.
 */
export const TEXT_MAX_BYTES = 512 * 1024;
export const BINARY_MAX_BYTES = 10 * 1024 * 1024;

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt,.md';

export const UPLOAD_PROBLEMS = {
  'no-file': 'Choose a file to upload.',
  type: 'Upload a PDF, Word (.docx), Excel (.xlsx), CSV, text or Markdown file. Older .xls workbooks: save as .xlsx first.',
  'too-large': 'PDF, Word and Excel files can be up to 10 MB; CSV, text and Markdown up to 512 KB.',
  rejected:
    'The file was rejected — it may be empty, unreadable, password-protected, a scanned PDF with no text (OCR is not available yet) or flagged by the virus scan.',
  unavailable: 'Uploads are not available in this environment.',
  failed: 'The upload did not reach Pactlab. Nothing was saved — try this file again.',
} as const;

export type UploadProblem = keyof typeof UPLOAD_PROBLEMS;

/** The content type to send, or why the file cannot be uploaded. */
export function checkFile(name: string, size: number): { contentType: string } | { problem: UploadProblem } {
  if (size === 0) return { problem: 'no-file' };
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return { problem: 'type' };
  if (size > (contentType.startsWith('text/') ? TEXT_MAX_BYTES : BINARY_MAX_BYTES)) return { problem: 'too-large' };
  return { contentType };
}

/** A sensible default data class from the file name; the user can change it before uploading. */
export function guessDataClass(name: string): 'BUSINESS' | 'FINANCIAL' {
  return /balance|financ|ledger|p&l|pnl|income|cash|extract|accounts|t-?12|budget/i.test(name) ? 'FINANCIAL' : 'BUSINESS';
}
