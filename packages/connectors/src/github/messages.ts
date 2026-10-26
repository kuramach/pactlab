/** Longest commit message or pull-request title kept as evidence. */
export const MAX_MESSAGE_LENGTH = 2_000;

/** Git trailer lines that name people (`Signed-off-by: Name <email>` and the like). */
const PEOPLE_TRAILER = /^\s*(signed-off-by|co-authored-by|reviewed-by|acked-by|tested-by|reported-by|suggested-by|helped-by|cc)\s*:/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * A commit message or pull-request title as Pactlab keeps it: trailer lines
 * naming people dropped, email addresses redacted, length capped (rule 7).
 * The text that remains carries issue keys for cross-links.
 */
export function sanitizeMessage(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const kept = text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => !PEOPLE_TRAILER.test(line))
    .join('\n')
    .replace(EMAIL, '[email removed]')
    .trim();
  if (kept === '') return null;
  return kept.length > MAX_MESSAGE_LENGTH ? `${kept.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : kept;
}
