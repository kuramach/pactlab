import { EN, type I18n } from '../../../../lib/i18n';

/** One-line result of the last action, carried in the `outcome` query parameter; the shared outcomes come from the catalog. */
export function OutcomeBanner({ outcome, messages, t = EN }: { outcome: string | undefined; messages: Readonly<Record<string, string>>; t?: I18n }) {
  if (!outcome) return null;
  const common: Readonly<Record<string, string>> = t.m.common.outcomes;
  const text = messages[outcome] ?? common[outcome];
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

