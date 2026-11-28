import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import type { I18n } from '../../../lib/i18n';
import { APP_LOCALE_NAMES, OFFERED_LOCALES } from '../../../lib/i18n/locales';
import { setLanguage } from './language-actions';

/** Settings → Language (T-172): each language named in itself; the pilot note while German covers part of the app. */
export function LanguageCard({ t, outcome }: { t: I18n; outcome: string | undefined }) {
  const words = t.m.settings.language;
  return (
    <Card id="language">
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {outcome === 'language-saved' ? (
          <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
            {words.saved}
          </p>
        ) : null}
        <form action={setLanguage} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 font-medium">
            {words.label}
            <select name="locale" defaultValue={t.locale} className="rounded-md border border-border bg-background px-2 py-1">
              {OFFERED_LOCALES.map((locale) => (
                <option key={locale} value={locale} lang={locale}>
                  {APP_LOCALE_NAMES[locale]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="outline">
            {words.save}
          </Button>
        </form>
        <p className="text-muted-foreground">{words.pilot}</p>
      </CardContent>
    </Card>
  );
}
