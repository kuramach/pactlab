/**
 * Bug reports (T-072, spec §28): scrub secrets out of context before it is
 * stored, and fingerprint failures so the same one dedups across users.
 */
export const BUG_TRIGGERS = ['USER_REPORT', 'FRONTEND_EXCEPTION', 'BACKEND_EXCEPTION', 'JOB_EXHAUSTED'] as const;
export type BugTrigger = (typeof BUG_TRIGGERS)[number];
export const BUG_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export const BUG_STATUSES = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

/** The human-readable reference shown to users and in handoffs: PLB-0042. */
export const bugReference = (number: number) => `PLB-${String(number).padStart(4, '0')}`;

const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authori[sz]ation|cookie|session|credential|private[-_]?key|signature|code)/i;
/** People data never enters a bug (rule 7): these keys are dropped with their values. */
const PEOPLE_KEY = /(salary|compensation|bonus|payroll|performance|rating|review_score|ssn|national_id|date_of_birth|dob)/i;
const SECRET_VALUE = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key id
  /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g,
  /\bsk-[A-Za-z0-9-_]{16,}\b/g,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, // Stripe
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // email addresses (minimal PII)
  /([?&](token|code|key|signature|password|secret)=)[^&\s]+/gi,
];
const REDACTED = '[redacted]';
const MAX_STRING = 4_000;
const MAX_DEPTH = 6;
const MAX_KEYS = 100;

function scrubString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE) out = out.replace(pattern, (match, prefix: unknown) => (typeof prefix === 'string' && match.startsWith(prefix) && /[?&]/.test(prefix) ? `${prefix}${REDACTED}` : REDACTED));
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

/**
 * A copy of `value` safe to store: secret-looking keys and values redacted,
 * people-data keys dropped, emails removed, and size bounded. Runs at
 * capture time, never at display time.
 */
export function scrubContext(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((item) => scrubContext(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (PEOPLE_KEY.test(key)) continue;
      out[key] = SECRET_KEY.test(key) ? REDACTED : scrubContext(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Same failure, same fingerprint: error class, the top stack frames and the
 * route, with ids, numbers and hex hashes normalized away so the same bug
 * dedups across deals and users.
 */
export function bugFingerprint(input: { errorName: string; stack?: string | null; route?: string | null }): string {
  const normalize = (text: string) =>
    text
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\b[0-9a-f]{16,}\b/gi, ':hash')
      .replace(/:\d+:\d+/g, '')
      .replace(/\d+/g, 'n');
  const frames = (input.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, 3)
    .map(normalize);
  return [input.errorName, normalize(input.route ?? ''), ...frames].join('|').slice(0, 500);
}
