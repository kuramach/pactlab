import { CtaBand } from '../components/cta';
import { PageHero, Section } from '../components/page-hero';
import { RelatedLinks } from '../components/related-links';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import type { Locale } from '../lib/i18n/locales';
import { pageMetadata } from '../lib/seo';

export const compareParams = () => site('en').comparisons.map((comparison) => ({ slug: comparison.slug }));
const findComparison = (locale: Locale, slug: string) => site(locale).comparisons.find((comparison) => comparison.slug === slug);

export function compareMetadata(locale: Locale, slug: string) {
  const comparison = findComparison(locale, slug);
  return comparison ? pageMetadata({ title: comparison.title, description: comparison.description, path: `/compare/${comparison.slug}`, locale }) : {};
}

export function ComparePage({ locale, slug }: { locale: Locale; slug: string }) {
  const comparison = findComparison(locale, slug);
  if (!comparison) return null;
  const { content, ui } = site(locale);
  const words = ui.compare;
  return (
    <>
      <PageHero
        eyebrow={words.eyebrow}
        title={comparison.title}
        body={comparison.intro}
        icon="Scale"
        locale={locale}
        crumbs={[
          { label: ui.crumbs.home, href: '/' },
          { label: comparison.title, href: `/compare/${comparison.slug}` },
        ]}
      />
      <Section title={fill(words.sideBySide, { them: comparison.them })}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-navy/20">
                <th scope="col" className="py-3 pr-4 font-bold">
                  {words.topic}
                </th>
                <th scope="col" className="py-3 pr-4 font-bold">
                  {comparison.them}
                </th>
                <th scope="col" className="py-3 font-bold">
                  Pactlab
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.topic} className="border-b border-navy/10 align-top">
                  <th scope="row" className="py-3 pr-4 font-semibold">
                    {row.topic}
                  </th>
                  <td className="py-3 pr-4 text-slate-text">{row.them}</td>
                  <td className="py-3 text-slate-text">{row.pactlab}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-8 max-w-3xl text-lg leading-relaxed">{comparison.conclusion}</p>
        <p className="mt-6 text-sm text-slate-text">
          {fill(words.sources, { them: comparison.them })}{' '}
          {comparison.sources.map((source) => (
            <a key={source.href} href={source.href} rel="noopener" className="underline underline-offset-4">
              {source.label}
            </a>
          ))}
          . {words.checked}
        </p>
      </Section>
      <Section title={ui.guides.readNext} tone="mist">
        <RelatedLinks links={words.related} locale={locale} />
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}
