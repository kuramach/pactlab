import type { LineUsageView } from '@pactlab/contracts';
import { apiGet } from '../(app)/deals/_lib/api';
import { getI18n } from '../../lib/i18n/server';

/**
 * Operator console → Health (T-182): LINE pushes this month against the free allowance. Once reached, the API's
 * notice ("LINE monthly allowance reached") is shown as it is; sends have stopped and people still get email.
 */
export async function LineUsage() {
  const [usage, t] = await Promise.all([apiGet<LineUsageView>('/v1/admin/line/usage'), getI18n()]);
  if (usage.kind !== 'ok') return null;
  const words = t.m.settings.lineUsage;
  const view = usage.data;
  if (!view.available) return <p className="text-sm text-muted-foreground">{words.off}</p>;
  return (
    <div className="flex flex-col gap-1 text-sm" data-numeric>
      <p>{t.fill(words.summary, { month: view.month, sent: t.number(view.sent), allowance: t.number(view.allowance) })}</p>
      {view.notice ? (
        <div role="alert" className="text-red-800">
          <p className="font-semibold">{view.notice}</p>
          <p>{words.reached}</p>
        </div>
      ) : null}
    </div>
  );
}
