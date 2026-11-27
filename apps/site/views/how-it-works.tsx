import { CtaBand } from '../components/cta';
import { FeatureGrid } from '../components/features';
import { Flow } from '../components/flow';
import { PageHero, Section } from '../components/page-hero';
import { site } from '../lib/i18n/catalog';
import type { Locale } from '../lib/i18n/locales';
import { pageMetadata } from '../lib/seo';

const OUTPUT_ICONS = ['ArrowLeftRight', 'ClipboardList', 'Snowflake', 'Handshake'] as const;

export function howItWorksMetadata(locale: Locale) {
  const words = site(locale).ui.howItWorks;
  return pageMetadata({ title: words.metaTitle, description: words.metaDescription, path: '/how-it-works', locale });
}

export function HowItWorksPage({ locale }: { locale: Locale }) {
  const { content, ui } = site(locale);
  const words = ui.howItWorks;
  const outputs = words.outputs.map((output, index) => ({ ...output, icon: OUTPUT_ICONS[index] ?? 'Handshake' }));
  return (
    <>
      <PageHero eyebrow={words.eyebrow} title={words.title} body={words.body} locale={locale} />
      <Section title={words.connect} body={content.sources.body}>
        <FeatureGrid features={content.sources.items} />
      </Section>
      <Section title={words.loop} body={words.loopBody} tone="mist">
        <Flow locale={locale} />
      </Section>
      {/* T-133: best-of-breed model routing, in one short block. */}
      <Section title={content.modelRouting.howItWorks.title} body={content.modelRouting.howItWorks.body} />
      <Section title={words.decide} body={content.principles.body} tone="navy">
        <FeatureGrid features={content.principles.items} columns={2} tone="dark" />
      </Section>
      <Section title={words.leave}>
        <FeatureGrid features={outputs} columns={2} />
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}
