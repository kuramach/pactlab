import type { LineAllowanceView } from '@pactlab/contracts';
import type { I18n } from '../../lib/i18n';

/**
 * Operators (T-182): this month's LINE allowance, LINE's count beside Pactlab's. At the cap the console says
 * "LINE monthly allowance reached": sends are held, the email still goes. Counts only; never a person.
 */
export function LineAllowanceNotice({ t, view }: { t: I18n; view: LineAllowanceView }) {
  if (!view.configured) return null;
  const words = t.m.settings.line.admin;
  const values = { used: t.number(view.used ?? 0), allowance: t.number(view.allowance), sent: t.number(view.sent), heldBack: t.number(view.heldBack), failed: t.number(view.failed) };
  return (
    <div className="flex flex-col gap-1" aria-label={t.m.settings.line.title} data-numeric>
      {view.reached ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span className="font-semibold">{words.reached}.</span> {words.reachedBody}
        </p>
      ) : null}
      <p className="text-sm">{t.fill(view.used === null ? words.unreadable : words.summary, values)}</p>
    </div>
  );
}
