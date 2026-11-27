import { CtaBand } from '../components/cta';
import { FeatureGrid } from '../components/features';
import { Icon, IconTile } from '../components/icon';
import { PageHero, Section } from '../components/page-hero';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import type { Locale } from '../lib/i18n/locales';
import { formatMegabytes, latestByPlatform, loadRinseReleases, type RinsePlatform, type RinseRelease } from '../lib/rinse';
import { pageMetadata } from '../lib/seo';

const FEATURE_ICONS = ['Lock', 'ScanSearch', 'ListChecks', 'Stamp', 'FileCheck'] as const;
const STEP_ICONS = ['FileStack', 'Sparkles', 'ClipboardCheck'] as const;
const PLATFORM_ORDER = ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'] as const satisfies readonly RinsePlatform[];
const PLATFORM_WORD = { 'macos-arm64': 'macosArm', 'macos-x64': 'macosIntel', 'windows-x64': 'windows', 'linux-x64': 'linux' } as const;

export function rinseMetadata(locale: Locale) {
  const words = site(locale).ui.rinse;
  return pageMetadata({ title: words.metaTitle, description: words.metaDescription, path: '/rinse', locale });
}

export async function RinsePage({ locale, releases }: { locale: Locale; releases?: readonly RinseRelease[] }) {
  const { content, ui } = site(locale);
  const words = ui.rinse;
  const feed = releases ?? (await loadRinseReleases());
  const latest = latestByPlatform(feed);
  const newest = feed[0];
  const features = words.features.map((feature, index) => ({ ...feature, icon: FEATURE_ICONS[index] ?? 'FileCheck' }));
  const requirements = words.requirements.map((item) => ({ ...item, icon: 'AppWindow' as const }));
  return (
    <>
      <PageHero eyebrow={words.eyebrow} title={words.title} body={words.body} icon="Sparkles" locale={locale} />
      <Section title={words.howTitle} body={words.howBody}>
        <ol className="grid gap-4 md:grid-cols-3">
          {words.steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3 rounded-2xl border border-navy/10 bg-white p-6">
              <div className="flex items-center gap-3">
                <IconTile name={STEP_ICONS[index] ?? 'Sparkles'} />
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-ink">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <h3 className="text-lg font-bold text-navy">{step.title}</h3>
              <p className="text-sm leading-relaxed text-slate-text">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section title={words.featuresTitle} tone="mist">
        <FeatureGrid features={features} />
      </Section>
      <Section id="download" title={words.downloadTitle} body={words.downloadBody}>
        {newest ? (
          <div className="flex flex-col gap-8">
            <ul className="grid gap-4 md:grid-cols-2">
              {PLATFORM_ORDER.flatMap((platform) => {
                const found = latest[platform];
                if (!found) return [];
                const { asset, release } = found;
                return [
                  <li key={platform} className="flex flex-col gap-3 rounded-2xl border border-navy/10 bg-white p-6">
                    <h3 className="text-lg font-bold text-navy">{words.platforms[PLATFORM_WORD[platform]]}</h3>
                    <p className="text-sm text-slate-text">
                      {fill(words.version, { version: release.version })} · {fill(words.released, { date: release.publishedAt.slice(0, 10) })}
                      {asset.sizeBytes ? ` · ${formatMegabytes(asset.sizeBytes)}` : ''}
                    </p>
                    {release.version !== newest.version ? <p className="text-sm text-slate-text">{fill(words.olderRelease, { version: release.version })}</p> : null}
                    <p className="text-sm font-semibold text-navy">{asset.signed ? words.signed : words.unsigned}</p>
                    {asset.minimumOs ? <p className="text-sm text-slate-text">{fill(words.minimumOs, { os: asset.minimumOs })}</p> : null}
                    <p className="text-xs text-slate-text">
                      {words.checksum}: <code className="break-all font-mono">{asset.sha256}</code>
                    </p>
                    <a
                      href={asset.url}
                      className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-navy px-5 py-3 font-bold text-white hover:bg-navy/90"
                      aria-label={`${words.download}: ${words.platforms[PLATFORM_WORD[platform]]}`}
                    >
                      <Icon name="Download" className="h-4 w-4" />
                      {words.download}
                    </a>
                  </li>,
                ];
              })}
            </ul>
            <p className="text-sm text-slate-text">{words.verify}</p>
            <div>
              <h3 className="text-xl font-bold text-navy">{words.notesTitle}</h3>
              <p className="mt-1 text-sm text-slate-text">{fill(words.version, { version: newest.version })}</p>
              <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-slate-text">
                {newest.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl rounded-2xl border border-navy/10 bg-white p-6">
            <h3 className="text-lg font-bold text-navy">{words.notYetTitle}</h3>
            <p className="mt-2 text-slate-text">{words.notYetBody}</p>
          </div>
        )}
      </Section>
      <Section title={words.privacyTitle} body={words.privacyBody} tone="navy" />
      <Section title={words.requirementsTitle} tone="mist">
        <FeatureGrid features={requirements} columns={2} />
      </Section>
      <Section title={words.faqTitle}>
        <div className="flex max-w-3xl flex-col divide-y divide-navy/10 rounded-2xl border border-navy/10">
          {words.faqs.map((item) => (
            <details key={item.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold">
                {item.q}
                <span aria-hidden className="text-indigo-ink transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-slate-text">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}
