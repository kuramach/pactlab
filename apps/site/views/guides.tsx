import Link from 'next/link';
import { CtaBand } from '../components/cta';
import { PageHero, Section } from '../components/page-hero';
import { RelatedLinks } from '../components/related-links';
import { site } from '../lib/i18n/catalog';
import { localeHref, type Locale } from '../lib/i18n/locales';
import { absolute, jsonLdScript, pageMetadata } from '../lib/seo';

export function guidesMetadata(locale: Locale) {
  const words = site(locale).ui.guides;
  return pageMetadata({ title: words.metaTitle, description: words.metaDescription, path: '/guides', locale });
}

export function GuidesIndexPage({ locale }: { locale: Locale }) {
  const { content, ui, guides } = site(locale);
  const words = ui.guides;
  return (
    <>
      <PageHero
        eyebrow={words.eyebrow}
        title={words.title}
        body={words.body}
        icon="ListChecks"
        locale={locale}
        crumbs={[
          { label: ui.crumbs.home, href: '/' },
          { label: ui.crumbs.guides, href: '/guides' },
        ]}
      />
      <Section title={words.all}>
        <ul className="grid gap-4 md:grid-cols-3">
          {guides.map((guide) => (
            <li key={guide.slug}>
              <Link href={localeHref(locale, `/guides/${guide.slug}`)} className="flex h-full flex-col gap-2 rounded-2xl border border-navy/10 p-6 hover:border-indigo hover:bg-mist">
                <span className="text-lg font-bold">{guide.title}</span>
                <span className="text-sm text-slate-text">{guide.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}

export const guideParams = () => site('en').guides.map((guide) => ({ slug: guide.slug }));
const findGuide = (locale: Locale, slug: string) => site(locale).guides.find((guide) => guide.slug === slug);

export function guideMetadata(locale: Locale, slug: string) {
  const guide = findGuide(locale, slug);
  return guide ? pageMetadata({ title: guide.title, description: guide.description, path: `/guides/${guide.slug}`, locale }) : {};
}

export function GuidePage({ locale, slug }: { locale: Locale; slug: string }) {
  const guide = findGuide(locale, slug);
  if (!guide) return null;
  const { content, ui } = site(locale);
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    inLanguage: locale,
    url: absolute(localeHref(locale, `/guides/${guide.slug}`)),
    publisher: { '@type': 'Organization', name: 'Pactlab', url: absolute('/') },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(article) }} />
      <PageHero
        eyebrow={ui.guides.guide}
        title={guide.title}
        body={guide.intro}
        icon="ListChecks"
        locale={locale}
        crumbs={[
          { label: ui.crumbs.home, href: '/' },
          { label: ui.crumbs.guides, href: '/guides' },
          { label: guide.title, href: `/guides/${guide.slug}` },
        ]}
      />
      <section className="bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
          {guide.sections.map((section) => (
            <div key={section.heading} className="flex flex-col gap-3">
              <h2 className="text-2xl font-extrabold tracking-tight">{section.heading}</h2>
              {section.body ? <p className="leading-relaxed text-slate-text">{section.body}</p> : null}
              {section.points ? (
                <ul className="flex list-disc flex-col gap-2 pl-5 text-slate-text">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <Section title={ui.guides.readNext} tone="mist">
        <RelatedLinks links={guide.related} locale={locale} />
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}
