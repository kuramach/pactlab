import { PageHero, Section } from '../components/page-hero';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import { HTML_LANG, type Locale } from '../lib/i18n/locales';
import { currentRinseRelease, installersInOrder, type RinsePlatform } from '../lib/rinse';
import { pageMetadata } from '../lib/seo';

const PLATFORM_WORDS = { 'macos-arm64': 'macosArm64', 'macos-x64': 'macosX64', 'windows-x64': 'windowsX64', 'linux-x64': 'linuxX64' } as const satisfies Record<RinsePlatform, string>;

export function rinseMetadata(locale: Locale) {
  const words = site(locale).ui.rinse;
  return pageMetadata({ title: words.metaTitle, description: words.metaDescription, path: '/rinse', locale });
}

/** The download page. The release is read from the feed at build time (lib/rinse.ts). */
export async function RinsePage({ locale }: { locale: Locale }) {
  const words = site(locale).ui.rinse;
  const release = await currentRinseRelease();
  const installers = release ? installersInOrder(release) : [];
  const date = release ? new Intl.DateTimeFormat(HTML_LANG[locale], { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(release.publishedAt)) : '';
  return (
    <>
      <PageHero eyebrow={words.eyebrow} title={words.title} body={words.body} icon="Download" locale={locale} />
      <Section id="download" title={words.downloadTitle} body={words.free}>
        {release ? (
          <>
            <p className="mb-6 text-slate-text">
              {fill(words.version, { version: release.version })} · {fill(words.released, { date })}
            </p>
            <ul className="grid gap-4 md:grid-cols-2">
              {installers.map((installer) => {
                const platform = words.platforms[PLATFORM_WORDS[installer.platform]];
                return (
                  <li key={installer.platform} className="flex flex-col gap-3 rounded-xl border border-navy/10 bg-white p-6">
                    <h3 className="text-lg font-bold">{platform}</h3>
                    <a href={installer.url} className="inline-flex w-fit rounded-lg bg-indigo px-5 py-3 font-bold text-white hover:opacity-90">
                      {fill(words.download, { platform })}
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div role="status" className="rounded-xl border border-navy/10 bg-mist p-6">
            <h3 className="text-lg font-bold">{words.unavailableTitle}</h3>
            <p className="mt-2 text-slate-text">{words.unavailableBody}</p>
          </div>
        )}
      </Section>
      {release ? (
        <>
          <Section title={words.notesTitle} tone="mist">
            <ul className="list-disc space-y-2 pl-6 text-slate-text">
              {release.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Section>
          <Section title={words.checksumsTitle} body={words.checksumsBody}>
            <dl className="grid gap-4">
              {installers.map((installer) => (
                <div key={installer.platform}>
                  <dt className="font-bold">{words.platforms[PLATFORM_WORDS[installer.platform]]}</dt>
                  <dd className="mt-1 break-all font-mono text-sm text-slate-text">{installer.sha256}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </>
      ) : null}
      <Section title={words.prepTitle} body={words.prepBody} tone={release ? 'mist' : 'white'} />
    </>
  );
}
