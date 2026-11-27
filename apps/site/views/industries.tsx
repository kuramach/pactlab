import Link from 'next/link';
import { Breadcrumbs } from '../components/breadcrumbs';
import { CtaBand, PilotButton, SignUpLink } from '../components/cta';
import { FeatureGrid } from '../components/features';
import { Icon, ModuleMark } from '../components/icon';
import { PageHero, Section } from '../components/page-hero';
import { StatusBadge } from '../components/status-badge';
import { FLOW, industryArt } from '../lib/content';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import { localeHref, type Locale } from '../lib/i18n/locales';
import { faqPageJsonLd, jsonLdScript, pageMetadata } from '../lib/seo';

export function industriesMetadata(locale: Locale) {
  const words = site(locale).ui.industries;
  return pageMetadata({ title: words.metaTitle, description: words.metaDescription, path: '/industries', locale });
}

export function IndustriesPage({ locale }: { locale: Locale }) {
  const { content, ui, industries, stories } = site(locale);
  const words = ui.industries;
  return (
    <>
      <PageHero eyebrow={words.eyebrow} title={words.title} body={words.body} locale={locale} />
      <Section title={content.industryCore.title} body={content.industryCore.body} tone="mist">
        <FeatureGrid features={content.industryCore.parts} />
      </Section>
      <Section title={words.where}>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {industries.map((industry) => (
            <li key={industry.slug}>
              <Link
                href={localeHref(locale, `/industries/${industry.slug}`)}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white transition-colors hover:border-indigo"
              >
                <img
                  src={industryArt(industry.slug)}
                  alt={fill(words.illustration, { name: industry.name })}
                  width={640}
                  height={420}
                  loading="lazy"
                  className="aspect-[640/420] h-auto w-full object-cover"
                />
                <div className="flex flex-1 flex-col gap-3 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <ModuleMark name={industry.icon} />
                    <StatusBadge industry={industry} locale={locale} />
                  </div>
                  <h3 className="text-lg font-bold">{industry.name}</h3>
                  <p className="text-sm font-semibold text-indigo-ink">{stories[industry.slug]?.headline}</p>
                  <p className="text-sm leading-relaxed text-slate-text">{industry.summary}</p>
                  <span className="mt-auto text-sm font-semibold text-indigo-ink group-hover:underline">{words.seeDetail}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}

export const industryParams = () => site('en').industries.map((industry) => ({ slug: industry.slug }));
const findIndustry = (locale: Locale, slug: string) => {
  const { industries, stories } = site(locale);
  const industry = industries.find((entry) => entry.slug === slug);
  const story = industry ? stories[industry.slug] : undefined;
  return industry && story ? { industry, story } : undefined;
};

export function industryMetadata(locale: Locale, slug: string) {
  const found = findIndustry(locale, slug);
  if (!found) return {};
  const { ui } = site(locale);
  const { industry, story } = found;
  return pageMetadata({
    title: fill(ui.industry.metaTitle, { name: industry.name }),
    description: story.subhead,
    path: `/industries/${industry.slug}`,
    image: { url: industryArt(industry.slug), alt: fill(ui.industries.illustration, { name: industry.name }) },
    locale,
  });
}

const stepIcon = (step: string) => FLOW.find((entry) => entry.step === step)?.icon ?? 'Database';

export function IndustryPage({ locale, slug }: { locale: Locale; slug: string }) {
  const found = findIndustry(locale, slug);
  if (!found) return null;
  const { content, ui, industries } = site(locale);
  const words = ui.industry;
  const { industry, story } = found;
  const href = (path: string) => localeHref(locale, path);
  const planned = industry.status === 'PLANNED';
  const others = industries.filter((other) => other.slug !== industry.slug);
  const illustration = (name: string) => fill(ui.industries.illustration, { name });

  return (
    <>
      {/* Hero: headline and illustration */}
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-[1.15fr_1fr] md:py-20">
          <div className="flex flex-col gap-6">
            <Breadcrumbs
              tone="dark"
              locale={locale}
              crumbs={[
                { label: ui.crumbs.home, href: '/' },
                { label: ui.crumbs.industries, href: '/industries' },
                { label: industry.name, href: `/industries/${industry.slug}` },
              ]}
            />
            <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-indigo">
              <Icon name={industry.icon} className="h-4 w-4" />
              {fill(words.eyebrow, { name: industry.name })}
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight md:text-5xl">{story.headline}</h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/85">{story.subhead}</p>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge industry={industry} tone="dark" locale={locale} />
              {planned ? <p className="max-w-md text-sm text-white/70">{content.plannedNote}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <PilotButton locale={locale} label={planned ? ui.cta.designPartner : ui.cta.requestPilot} />
              {planned ? null : <SignUpLink tone="dark" locale={locale} />}
            </div>
          </div>
          <div className="rounded-3xl bg-white p-3 shadow-2xl shadow-black/30">
            <img
              src={industryArt(industry.slug)}
              alt={illustration(industry.name)}
              width={640}
              height={420}
              className="aspect-[640/420] h-auto w-full object-cover rounded-2xl"
            />
          </div>
        </div>
      </section>

      {/* The problem */}
      <Section title={words.goWrong} body={industry.dealShape}>
        <FeatureGrid features={story.pains} />
      </Section>

      <Section title={words.questions} tone="mist">
        <ul className="grid gap-3 md:grid-cols-2">
          {industry.questions.map((question) => (
            <li key={question} className="flex items-start gap-3 rounded-xl bg-white p-5">
              <span className="mt-0.5 text-indigo-ink">
                <Icon name="FileSearch" />
              </span>
              <span className="font-semibold">{question}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* How a deal runs */}
      <Section
        title={planned ? fill(words.howWouldRun, { name: industry.name }) : words.howRuns}
        body={planned ? words.howWouldRunBody : words.howRunsBody}
        tone="navy"
      >
        <ol className="relative flex flex-col gap-6 border-l border-white/15 pl-8">
          {story.walkthrough.map((entry, index) => (
            <li key={entry.step} className="relative">
              <span className="absolute -left-[3.05rem] top-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo text-navy">
                <Icon name={stepIcon(entry.step)} className="h-5 w-5" />
              </span>
              <p className="text-xs font-bold uppercase tracking-widest text-indigo">
                {String(index + 1).padStart(2, '0')} · {ui.steps[entry.step as keyof typeof ui.steps]}
              </p>
              <p className="mt-1 max-w-3xl text-lg leading-relaxed text-white/90">{entry.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Example findings */}
      <Section title={words.findsTitle} body={words.findsBody}>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {story.findings.map((finding) => (
            <li key={finding.title} className="flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${finding.severity === 'High' ? 'bg-navy text-white' : 'bg-indigo/15 text-indigo-ink'}`}>
                  {words.severityLabel[finding.severity]}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-text">{words.example}</span>
              </div>
              <h3 className="text-lg font-bold leading-snug">{finding.title}</h3>
              <p className="flex items-start gap-2 text-sm text-slate-text">
                <Icon name="Link2" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-ink" />
                {finding.evidence}
              </p>
              <p className="mt-auto flex items-start gap-2 rounded-xl bg-mist p-3 text-sm font-semibold">
                <Icon name="Handshake" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-ink" />
                {finding.term}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {industry.vocabulary ? (
        <Section title={words.language} body={words.languageBody} tone="mist">
          <table className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white text-left">
            <thead className="bg-navy text-white">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">
                  {fill(words.theirs, { name: industry.name })}
                </th>
                <th scope="col" className="px-5 py-3 font-bold">
                  {words.ours}
                </th>
              </tr>
            </thead>
            <tbody>
              {industry.vocabulary.map((row) => (
                <tr key={row.theirs} className="border-t border-navy/10">
                  <td className="px-5 py-3 font-semibold">{row.theirs}</td>
                  <td className="px-5 py-3 text-slate-text">{row.ours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {/* Coverage */}
      <Section
        title={planned ? words.carries : words.covers}
        body={planned ? words.carriesBody : words.coversBody}
        tone={industry.vocabulary ? 'white' : 'mist'}
      >
        <FeatureGrid features={industry.transfers} columns={industry.transfers.length === 4 ? 2 : 3} />
      </Section>

      {industry.adds.length > 0 ? (
        <Section title={words.adds} body={words.addsBody} tone="navy">
          <FeatureGrid features={industry.adds} columns={industry.adds.length === 4 ? 2 : 3} tone="dark" />
        </Section>
      ) : null}

      <Section title={words.walkAway} tone="cloud">
        <FeatureGrid features={story.deliverables} />
      </Section>

      {/* FAQ */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqPageJsonLd(story.faq)) }} />
      <Section title={words.buyersAsk}>
        <div className="flex max-w-3xl flex-col divide-y divide-navy/10 rounded-2xl border border-navy/10">
          {story.faq.map((item) => (
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

      {/* Other industries */}
      <Section title={words.others} tone="mist">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((other) => (
            <li key={other.slug}>
              <Link
                href={href(`/industries/${other.slug}`)}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white transition-colors hover:border-indigo"
              >
                <img
                  src={industryArt(other.slug)}
                  alt={illustration(other.name)}
                  width={640}
                  height={420}
                  loading="lazy"
                  className="aspect-[640/420] h-auto w-full object-cover"
                />
                <div className="flex items-center justify-between gap-3 p-4">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <ModuleMark name={other.icon} />
                    {other.name}
                  </span>
                  <StatusBadge industry={other} locale={locale} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-slate-text">
          {words.sameCore}{' '}
          <Link href="/product" className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
            {words.seeModules}
          </Link>
        </p>
      </Section>

      <CtaBand
        title={planned ? fill(words.buyingIn, { name: industry.name }) : content.pilot.title}
        body={planned ? words.designPartners : content.pilot.body}
        locale={locale}
        {...(planned ? { label: ui.shell.talkToUs } : {})}
      />
    </>
  );
}
