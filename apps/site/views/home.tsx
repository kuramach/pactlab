import Link from 'next/link';
import { FeatureGrid } from '../components/features';
import { Demos } from '../components/demos';
import { HeroCarousel } from '../components/hero-carousel';
import { IconTile, ModuleMark } from '../components/icon';
import { Lockup } from '../components/lockup';
import { siteConfig } from '../lib/config';
import { FEATURED_PACTS, heroSlides, INDUSTRIES, MAX_FEATURED_PACTS, PACT_CARDS, type Slide } from '../lib/content';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import { HTML_LANG, localeHref, type Locale } from '../lib/i18n/locales';
import { isPublishedHref } from '../lib/industry-stories';
import { jsonLdScript, pageMetadata, softwareApplicationJsonLd } from '../lib/seo';

export const homeMetadata = (locale: Locale) => pageMetadata({ description: site(locale).content.home.body, path: '/', locale });

/** The top slider in one language (T-086): platform messages and the featured pacts, alternating. */
function slides(locale: Locale) {
  const { content, ui } = site(locale);
  const href = (path: string) => localeHref(locale, path);
  const published = PACT_CARDS.filter((card) => isPublishedHref(card.href)).map((card) => ({ ...card, ...content.pactCards[card.id] }));
  const featured = FEATURED_PACTS.map((id) => published.find((card) => card.id === id))
    .filter((card) => card !== undefined)
    .slice(0, MAX_FEATURED_PACTS);
  const pacts = featured.map((card): Slide => {
    const copy = content.pactSlides[card.id];
    const industry = INDUSTRIES.find((entry) => entry.slug === card.id);
    return {
      id: `pact-${card.id}`,
      group: 'pact',
      short: copy?.short ?? card.name,
      icon: copy?.icon ?? industry?.icon,
      eyebrow: fill(ui.carousel.pactEyebrow, { name: card.name }),
      title: copy?.title ?? card.name,
      body: copy?.body ?? card.line,
      points: copy?.points ?? [],
      image: card.image,
      imageAlt: copy?.imageAlt ?? fill(ui.carousel.pactIllustration, { name: card.name }),
      link: { href: href(card.href), label: copy?.linkLabel ?? fill(ui.carousel.runPact, { name: card.name }) },
    };
  });
  const platforms = content.carousel.map((slide) => ({ ...slide, link: { ...slide.link, href: href(slide.link.href) } }));
  return {
    slides: heroSlides(pacts, platforms),
    allPacts: {
      href: href('/industries'),
      label: published.length > featured.length ? fill(ui.home.allPacts, { count: published.length }) : ui.home.allPactsShort,
    },
  };
}

function PrimaryCta({ label }: { label: string }) {
  const { contactHref } = siteConfig();
  if (!contactHref) return null;
  return (
    <a href={contactHref} className="inline-flex items-center rounded-lg bg-navy px-5 py-3 font-bold text-white transition-colors hover:bg-indigo hover:text-navy">
      {label}
    </a>
  );
}

export function HomePage({ locale }: { locale: Locale }) {
  const { contactHref, signUpUrl } = siteConfig();
  const { content, ui, modules } = site(locale);
  const words = ui.home;
  const href = (path: string) => localeHref(locale, path);
  const { slides: rotation, allPacts } = slides(locale);
  const { nameStory, modelRouting, principles, founder, closing } = content;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(softwareApplicationJsonLd(locale)) }} />
      <HeroCarousel
        slides={rotation}
        allPacts={allPacts}
        positioning={{ eyebrow: content.home.eyebrow, line: content.positioning }}
        cta={contactHref ? { href: contactHref, label: ui.cta.requestPilot, countryLabel: ui.cta.country, language: HTML_LANG[locale] } : null}
        words={ui.carousel}
      />

      {/* Value proposition */}
      <section aria-labelledby="value-title" className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-5">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{content.pillar}</p>
            <h2 id="value-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {words.valueTitle}
            </h2>
            <p className="text-lg leading-relaxed text-slate-text">{fill(words.valueBody, { story: content.story })}</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href={href('/how-it-works')} className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-navy hover:text-white">
                {words.seeHow}
              </Link>
              {signUpUrl ? (
                <a href={signUpUrl} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
                  {words.createOrg}
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-center gap-5 rounded-3xl bg-mist p-10">
            <img src="/brand/pactlab-symbol.svg" alt="" width={120} height={120} className="h-auto w-24" />
            <Lockup />
            <p className="text-center text-sm font-semibold text-slate-text">{content.tagline}</p>
          </div>
        </div>
      </section>

      {/* The name */}
      <section aria-labelledby="name-title" className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[1fr_1.3fr]">
          <img src="/illustrations/fides-coin.svg" alt={words.coinAlt} width={480} height={480} className="mx-auto h-auto w-full max-w-xs" />
          <div className="flex flex-col gap-5">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo">{nameStory.eyebrow}</p>
            <h2 id="name-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {nameStory.title}
            </h2>
            <p className="text-lg leading-relaxed text-white/85">{nameStory.teaser}</p>
            <p className="text-lg font-bold text-indigo">{nameStory.closing}</p>
            <Link href={href('/about/story')} className="font-semibold text-white underline-offset-4 hover:underline">
              {words.readStory}
            </Link>
          </div>
        </div>
      </section>

      {/* Solutions grid */}
      <section aria-labelledby="solutions-title" className="bg-mist">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h2 id="solutions-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                {words.solutionsTitle}
              </h2>
              <p className="mt-4 text-lg text-slate-text">{words.solutionsBody}</p>
            </div>
            <Link href="/product" className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
              {words.allModules}
            </Link>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <Link
                key={module.slug}
                href={`/product/${module.slug}`}
                className="group flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo hover:shadow-lg hover:shadow-indigo/10"
              >
                <ModuleMark name={module.icon} />
                <h3 className="text-xl font-bold">{module.name}</h3>
                <p className="leading-relaxed text-slate-text">{module.summary}</p>
                <span className="mt-auto text-sm font-bold text-indigo-ink">{words.explore}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Best-of-breed model routing (T-133) */}
      <section aria-labelledby="routing-title" className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{modelRouting.eyebrow}</p>
            <h2 id="routing-title" className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              {modelRouting.title}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-text">{modelRouting.body}</p>
            <p className="mt-3 text-sm text-slate-text">{modelRouting.providers}</p>
          </div>
          <div className="mt-10">
            <FeatureGrid features={modelRouting.items} />
          </div>
        </div>
      </section>

      {/* Band */}
      <section aria-labelledby="band-title" className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 id="band-title" className="text-3xl font-extrabold tracking-tight">
              {words.bandTitle}
            </h2>
            <p className="mt-3 text-lg text-white/80">{words.bandBody}</p>
          </div>
          <Link href={href('/how-it-works')} className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-white">
            {words.bandLink}
          </Link>
        </div>
      </section>

      <Demos locale={locale} />

      <section id="principles" aria-labelledby="principles-title" className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 id="principles-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {principles.title}
            </h2>
            <p className="mt-4 text-lg text-white/80">{principles.body}</p>
          </div>
          <ul className="flex flex-col gap-4">
            {principles.items.map((item) => (
              <li key={item.title} className="flex gap-4 rounded-xl border border-white/10 bg-white/5 p-5">
                <IconTile name={item.icon} tone="dark" />
                <div>
                  <h3 className="font-bold text-white">{item.title}</h3>
                  <p className="mt-1 leading-relaxed text-white/80">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* From the founder */}
      <section aria-labelledby="founder-title" className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 md:grid-cols-[auto_1fr]">
          <img
            src={founder.photo}
            alt={fill(words.portrait, { name: founder.name })}
            width={380}
            height={380}
            loading="lazy"
            className="h-28 w-28 rounded-full object-cover ring-4 ring-indigo/30"
          />
          <div className="flex flex-col gap-4">
            <p id="founder-title" className="text-sm font-bold uppercase tracking-widest text-indigo-ink">
              {words.fromFounder}
            </p>
            <blockquote className="text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">“{founder.signoff}”</blockquote>
            <p className="text-slate-text">
              {founder.name}, {founder.role}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Link href={href('/about/vision')} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
                {words.readVision}
              </Link>
              <a href={founder.linkedin} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
                LinkedIn ↗
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section aria-labelledby="closing-title" className="bg-mist">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 id="closing-title" className="text-3xl font-extrabold tracking-tight">
              {closing.title}
            </h2>
            <p className="mt-3 text-lg text-slate-text">{closing.body}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <PrimaryCta label={ui.shell.talkToUs} />
            <Link href={href('/pilot')} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
              {ui.cta.pilotIncludes}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
