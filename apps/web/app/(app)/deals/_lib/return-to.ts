/**
 * Origin-aware return navigation for detail pages. A link that drills into a
 * record carries `from` — the page it came from (path, query and anchor). The
 * detail page renders its back link and breadcrumb from it, after checking it
 * is a path inside the same deal; anything else (another site, another deal,
 * a path walk, garbage) is ignored and the page's own fallback applies.
 * The label is derived from the validated path, never read from the URL.
 */
export const RETURN_PARAM = 'from';

const MAX_LENGTH = 2000;
const BASE = 'https://pactlab.invalid';

/** Deal sections a record can be reached from, and what the back link calls them. */
const SECTION_LABELS: Readonly<Record<string, string>> = {
  '': 'Overview',
  finances: 'Finances',
  findings: 'Findings',
  evidence: 'Evidence',
  valuation: 'Valuation',
  documents: 'Documents',
  sources: 'Sources',
  engineering: 'Engineering',
};

export interface ReturnTarget {
  readonly href: string;
  readonly label: string;
}

/** `href` with `from` appended, keeping any query it already has. */
export function withReturn(href: string, from: string): string {
  const [path = '', hash] = href.split('#');
  const joined = `${path}${path.includes('?') ? '&' : '?'}${RETURN_PARAM}=${encodeURIComponent(from)}`;
  return hash === undefined ? joined : `${joined}#${hash}`;
}

/** The return target, or null when `value` is not a path inside this deal. */
export function parseReturn(value: unknown, dealId: string): ReturnTarget | null {
  const raw = Array.isArray(value) ? undefined : value;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  // Printable ASCII only: no control characters, no backslashes, no protocol-relative or absolute URLs.
  if (!/^[\x20-\x7e]+$/.test(raw) || raw.includes('\\') || !raw.startsWith('/') || raw.startsWith('//')) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const prefix = `/deals/${dealId}`;
  // Checked on the normalized path, so `..` and encoded dot segments cannot climb out of the deal.
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  const segments = url.pathname.slice(prefix.length).split('/').filter(Boolean);
  const section = segments[0] ?? '';
  const label = section === 'findings' && segments.length > 1 ? 'Finding' : SECTION_LABELS[section];
  if (!label) return null;
  return { href: `${url.pathname}${url.search}${url.hash}`, label };
}
