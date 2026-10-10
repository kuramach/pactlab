/** One-line result of the last action, carried in the `outcome` query parameter. */
export function OutcomeBanner({ outcome, messages }: { outcome: string | undefined; messages: Readonly<Record<string, string>> }) {
  if (!outcome) return null;
  const text = messages[outcome] ?? COMMON[outcome];
  if (!text) return null;
  const ok = outcome.startsWith('ok');
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={`rounded-md border px-3 py-2 text-sm ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}
    >
      {text}
    </p>
  );
}

const COMMON: Readonly<Record<string, string>> = {
  forbidden: 'Your role on this deal does not allow that.',
  conflict: 'Someone changed this in the meantime. Reload and try again.',
  invalid: 'Some details were not accepted. Check them and try again.',
  unavailable: 'That service is not available right now.',
  'signed-out': 'Your session ended. Log in again.',
  'not-found': 'That item no longer exists.',
  error: 'Something went wrong. Try again.',
};
