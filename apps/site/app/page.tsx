import { siteConfig } from '../lib/config';
import { CAPABILITIES, CLOSING, HERO, LOOP, PILLAR, PRINCIPLES, STORY, TAGLINE } from '../lib/content';

const { signInUrl, contactHref } = siteConfig();

function PrimaryCta({ className = '' }: { className?: string }) {
  if (!contactHref) return null;
  return (
    <a
      href={contactHref}
      className={`inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy transition-colors hover:bg-white ${className}`}
    >
      Request a pilot
    </a>
  );
}

export default function HomePage() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="bg-navy text-white">
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <a href="/" className="shrink-0">
            <img src="/brand/pactlab-logo-light.png" alt="Pactlab" width={800} height={228} className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-6 text-sm font-semibold">
            <a href="#how" className="hidden text-white/80 hover:text-white sm:inline">
              How it works
            </a>
            <a href="#product" className="hidden text-white/80 hover:text-white sm:inline">
              Product
            </a>
            <a href="#principles" className="hidden text-white/80 hover:text-white sm:inline">
              Principles
            </a>
            {signInUrl ? (
              <a href={signInUrl} className="rounded-lg border border-white/30 px-4 py-2 hover:border-white">
                Sign in
              </a>
            ) : null}
          </div>
        </nav>

        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 pt-12 md:grid-cols-[1.4fr_1fr] md:pt-20">
          <div className="flex flex-col gap-6">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo">{HERO.eyebrow}</p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl md:text-6xl">{HERO.title}</h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/85">{HERO.body}</p>
            <div className="flex flex-wrap items-center gap-4">
              <PrimaryCta />
              <a href="#how" className="font-semibold text-white underline-offset-4 hover:underline">
                See how it works →
              </a>
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-4">
            <div className="rounded-3xl bg-white p-8 shadow-2xl shadow-black/30">
              <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className="h-auto w-full" />
            </div>
            <p className="text-center text-sm font-semibold text-white/80">{PILLAR}</p>
          </div>
        </div>
      </header>

      <main id="main">
        <section id="how" aria-labelledby="how-title" className="bg-mist">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 id="how-title" className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
              {LOOP.title}
            </h2>
            <p className="mt-4 max-w-2xl text-lg text-slate-text">{LOOP.body}</p>
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {LOOP.steps.map((step, index) => (
                <li key={step.name} className="rounded-2xl border border-indigo/20 bg-white p-6">
                  <span className="text-sm font-bold text-indigo-ink">{String(index + 1).padStart(2, '0')}</span>
                  <h3 className="mt-2 text-xl font-bold">{step.name}</h3>
                  <p className="mt-2 text-slate-text">{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="product" aria-labelledby="product-title" className="bg-white">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 id="product-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              What Pactlab does
            </h2>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {CAPABILITIES.map((capability) => (
                <article key={capability.title} className="rounded-2xl bg-cloud p-8">
                  <h3 className="text-xl font-bold">{capability.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-text">{capability.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="principles" aria-labelledby="principles-title" className="bg-navy text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 id="principles-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                {PRINCIPLES.title}
              </h2>
              <p className="mt-4 text-lg text-white/80">{STORY}</p>
            </div>
            <ul className="flex flex-col gap-4">
              {PRINCIPLES.items.map((item) => (
                <li key={item} className="flex gap-4 rounded-xl border border-white/10 bg-white/5 p-5">
                  <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="closing-title" className="bg-mist">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 id="closing-title" className="text-3xl font-extrabold tracking-tight">
                {CLOSING.title}
              </h2>
              <p className="mt-3 text-lg text-slate-text">{CLOSING.body}</p>
            </div>
            <PrimaryCta className="hover:bg-navy hover:text-white" />
          </div>
        </section>
      </main>

      <footer className="bg-navy text-white/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
          <img src="/brand/pactlab-logo-light.png" alt="Pactlab" width={800} height={228} className="h-6 w-auto self-start" />
          <p>{TAGLINE}</p>
          <p>© {new Date().getFullYear()} Pactlab</p>
        </div>
      </footer>
    </>
  );
}
