import Link from 'next/link';
import { CtaBand } from '../components/cta';
import { PageHero, Section } from '../components/page-hero';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import type { Locale } from '../lib/i18n/locales';
import { pageMetadata } from '../lib/seo';

export function caseStudiesMetadata(locale: Locale) {
  const words = site(locale).ui.cases;
  return pageMetadata({ title: words.metaTitle, description: words.metaDescription, path: '/case-studies', locale });
}

/** The case-studies index. Each study is told in English, every fact cited to its source, so the cards link to the English page. */
export function CaseStudiesIndexPage({ locale }: { locale: Locale }) {
  const { content, ui, cases } = site(locale);
  const words = ui.cases;
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
          { label: ui.crumbs.caseStudies, href: '/case-studies' },
        ]}
      />
      <Section title={words.all} {...(locale === 'en' ? {} : { body: words.inEnglish })}>
        <ul className="grid gap-4 md:grid-cols-2">
          {cases.map((study) => (
            <li key={study.slug}>
              <Link
                href={`/case-studies/${study.slug}`}
                {...(locale === 'en' ? {} : { hrefLang: 'en' })}
                className="flex h-full flex-col gap-2 rounded-2xl border border-navy/10 p-6 hover:border-indigo hover:bg-mist"
              >
                <span className="text-sm font-bold uppercase tracking-widest text-slate-text">{fill(words.case, { number: study.number, outcome: study.outcome.label })}</span>
                <span className="text-lg font-bold">{study.title}</span>
                <span className="text-sm text-slate-text">{study.line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}
