import Link from 'next/link';
import { CtaBand } from '../components/cta';
import { Icon, IconTile } from '../components/icon';
import { PageHero } from '../components/page-hero';
import type { IconName } from '../lib/content';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import { localeHref, type Locale } from '../lib/i18n/locales';
import { pageMetadata } from '../lib/seo';

export function aboutMetadata(locale: Locale) {
  const { content, ui } = site(locale);
  return pageMetadata({ title: ui.about.metaTitle, description: content.nameStory.teaser, path: '/about', locale });
}

export function AboutPage({ locale }: { locale: Locale }) {
  const { content, ui } = site(locale);
  const { nameStory } = content;
  return (
    <>
      <PageHero eyebrow={ui.about.eyebrow} title={nameStory.title} body={nameStory.teaser} icon="Handshake" locale={locale} />
      <section className="bg-mist">
        <ul className="mx-auto grid max-w-6xl gap-5 px-6 py-20 md:grid-cols-3">
          {content.aboutPages.map((page) => (
            <li key={page.href}>
              <Link
                href={localeHref(locale, page.href)}
                className="flex h-full flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-7 transition hover:-translate-y-0.5 hover:border-indigo hover:shadow-lg hover:shadow-indigo/10"
              >
                <IconTile name={page.icon} />
                <h2 className="text-xl font-bold">{page.label}</h2>
                <p className="text-slate-text">{page.detail}</p>
                <span className="mt-auto text-sm font-bold text-indigo-ink">{ui.about.read}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function storyMetadata(locale: Locale) {
  const words = site(locale).ui.about;
  return pageMetadata({ title: words.storyMetaTitle, description: words.storyMetaDescription, path: '/about/story', locale });
}

/** Where the name comes from: the Roman pact, the clasped hands of Fides, and the lab that tests the promise. */
export function StoryPage({ locale }: { locale: Locale }) {
  const { content, ui } = site(locale);
  const { nameStory } = content;
  return (
    <>
      <PageHero eyebrow={nameStory.eyebrow} title={nameStory.title} body={nameStory.teaser} icon="Handshake" locale={locale} />
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-20 md:grid-cols-[1fr_1.3fr]">
          <div className="md:sticky md:top-28 md:self-start">
            <img src="/illustrations/fides-coin.svg" alt={ui.home.coinAlt} width={480} height={480} className="mx-auto h-auto w-full max-w-sm" />
            <p className="mt-6 text-center text-sm text-slate-text">{ui.about.coinCaption}</p>
          </div>
          <ol className="relative flex flex-col gap-12 border-l-2 border-indigo/30 pl-8">
            {nameStory.chapters.map((chapter, index) => (
              <li key={chapter.title} className="relative">
                <span className="absolute -left-[2.85rem] top-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
                  {['I', 'II', 'III', 'IV'][index]}
                </span>
                <h2 className="text-2xl font-extrabold tracking-tight">{chapter.title}</h2>
                <p className="mt-3 text-lg leading-relaxed text-slate-text">{chapter.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
          <img src="/brand/pactlab-symbol-light.svg" alt="" width={120} height={120} className="h-24 w-24" />
          <p className="max-w-2xl text-3xl font-extrabold tracking-tight">{nameStory.closing}</p>
        </div>
      </section>
      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}

export function visionMetadata(locale: Locale) {
  const { content, ui } = site(locale);
  return pageMetadata({ title: ui.about.visionMetaTitle, description: content.founder.title, path: '/about/vision', locale });
}

/** The founder's vision for Pactlab, in his own voice. */
export function VisionPage({ locale }: { locale: Locale }) {
  const { content, ui } = site(locale);
  const founder = content.founder;
  const portrait = fill(ui.home.portrait, { name: founder.name });
  return (
    <>
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div className="flex flex-col gap-5">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo">{ui.about.visionEyebrow}</p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">{founder.title}</h1>
            <p className="max-w-2xl text-lg leading-relaxed text-white/85">{founder.intro}</p>
          </div>
          <figure className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <img src={founder.photo} alt={portrait} width={380} height={380} className="h-44 w-44 rounded-full object-cover ring-4 ring-indigo/60" />
            <figcaption>
              <p className="text-lg font-bold">{founder.name}</p>
              <p className="text-sm text-white/70">{founder.role}</p>
              <a
                href={founder.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold hover:border-indigo hover:text-indigo"
              >
                {ui.about.connect}
              </a>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="max-w-3xl text-xl font-semibold leading-relaxed">{founder.dealsIntro}</p>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {founder.deals.map((deal) => (
              <li key={deal.title} className="flex flex-col gap-3 rounded-2xl border border-navy/10 bg-mist p-6">
                <IconTile name={deal.icon as IconName} />
                <h2 className="text-lg font-bold">{deal.title}</h2>
                <p className="text-slate-text">{deal.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-5">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{founder.artTitle}</h2>
            {founder.art.map((paragraph) => (
              <p key={paragraph} className="text-lg leading-relaxed text-white/85">
                {paragraph}
              </p>
            ))}
          </div>
          <figure className="flex flex-col justify-center gap-5 border-l-4 border-indigo pl-8">
            <blockquote className="text-2xl font-extrabold leading-snug tracking-tight">“{founder.principle.quote}”</blockquote>
            <figcaption className="text-sm text-white/70">{founder.principle.attribution}</figcaption>
            <p className="leading-relaxed text-white/85">{founder.principle.body}</p>
          </figure>
        </div>
      </section>

      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{founder.problemTitle}</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {founder.problems.map((problem, index) => (
              <article key={problem.title} className="flex flex-col gap-3 rounded-2xl bg-white p-7 shadow-sm">
                <span className="text-sm font-bold text-indigo-ink">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="text-xl font-bold">{problem.title}</h3>
                <p className="leading-relaxed text-slate-text">{problem.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{founder.visionTitle}</h2>
            <p className="mt-5 text-xl leading-relaxed text-slate-text">{founder.vision}</p>
          </div>
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {founder.phases.map((phase, index) => (
              <li key={phase.phase} className="relative flex flex-col gap-3 rounded-2xl border border-indigo/20 p-7">
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-navy text-indigo">
                    <Icon name={phase.icon as IconName} className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{phase.phase}</span>
                </span>
                <h3 className="text-xl font-bold">{phase.title}</h3>
                <p className="leading-relaxed text-slate-text">{phase.body}</p>
                {index < founder.phases.length - 1 ? <span aria-hidden className="absolute -right-4 top-1/2 hidden h-0.5 w-3 bg-indigo/40 md:block" /> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-navy text-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-20">
          <blockquote className="text-3xl font-extrabold leading-snug tracking-tight sm:text-4xl">“{founder.signoff}”</blockquote>
          <p className="font-semibold text-white/80">
            —{' '}
            <a href={founder.linkedin} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
              {founder.name}
            </a>
          </p>
          <Link href={localeHref(locale, '/about/story')} className="font-semibold text-indigo underline-offset-4 hover:underline">
            {ui.about.whyName}
          </Link>
        </div>
      </section>

      <CtaBand title={content.pilot.title} body={content.pilot.body} locale={locale} />
    </>
  );
}
