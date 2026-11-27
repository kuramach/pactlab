import Link from 'next/link';
import { CtaBand } from '../components/cta';
import { PageHero, Section } from '../components/page-hero';
import { RelatedLinks } from '../components/related-links';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import { localeHref, type Locale } from '../lib/i18n/locales';
import { faqPageJsonLd, jsonLdScript, pageMetadata } from '../lib/seo';

export function faqIndexMetadata(locale: Locale) {
  const words = site(locale).ui.faq;
  return pageMetadata({ title: words.metaTitle, description: words.metaDescription, path: '/faq', locale });
}

export function FaqIndexPage({ locale }: { locale: Locale }) {
  const { content, ui, faqs } = site(locale);
  const words = ui.faq;
  return (
    <>
      <PageHero
        eyebrow={words.eyebrow}
        title={words.title}
        body={words.body}
        icon="MessageSquareQuote"
        locale={locale}
        crumbs={[
          { label: ui.crumbs.home, href: '/' },
          { label: ui.crumbs.faq, href: '/faq' },
        ]}
      />
      <Section title={words.choose}>
        <ul className="grid gap-4 md:grid-cols-3">
          {faqs.map((page) => (
            <li key={page.slug}>
              <Link href={localeHref(locale, `/faq/${page.slug}`)} className="flex h-full flex-col gap-2 rounded-2xl border border-navy/10 p-6 hover:border-indigo hover:bg-mist">
                <span className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{page.audience}</span>
                <span className="text-lg font-bold">{page.title}</span>
                <span className="text-sm text-slate-text">{page.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}

export const faqParams = () => site('en').faqs.map((page) => ({ slug: page.slug }));
const findFaq = (locale: Locale, slug: string) => site(locale).faqs.find((page) => page.slug === slug);

export function faqMetadata(locale: Locale, slug: string) {
  const page = findFaq(locale, slug);
  return page ? pageMetadata({ title: page.title, description: page.description, path: `/faq/${page.slug}`, locale }) : {};
}

export function FaqPage({ locale, slug }: { locale: Locale; slug: string }) {
  const page = findFaq(locale, slug);
  if (!page) return null;
  const { content, ui } = site(locale);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqPageJsonLd(page.items)) }} />
      <PageHero
        eyebrow={fill(ui.faq.forAudience, { audience: page.audience })}
        title={page.title}
        body={page.description}
        icon="MessageSquareQuote"
        locale={locale}
        crumbs={[
          { label: ui.crumbs.home, href: '/' },
          { label: ui.crumbs.faq, href: '/faq' },
          { label: page.audience, href: `/faq/${page.slug}` },
        ]}
      />
      <Section title={ui.faq.qa}>
        <div className="flex max-w-3xl flex-col gap-8">
          {page.items.map((item) => (
            <div key={item.q} className="flex flex-col gap-2">
              <h3 className="text-lg font-bold">{item.q}</h3>
              <p className="leading-relaxed text-slate-text">{item.a}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title={ui.guides.readNext} tone="mist">
        <RelatedLinks links={page.related} locale={locale} />
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}
