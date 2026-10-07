import { siteConfig } from '../lib/config';
import { ARCS, CLOSING, HERO, LOOP, PILLAR, PRINCIPLES } from '../lib/content';
import { IconTile } from '../components/icon';
import { Demos } from './demos';

const { contactHref } = siteConfig();

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
      <section className="bg-navy text-white">
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
      </section>

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

      <Demos />

      <section id="product" aria-labelledby="product-title" className="bg-mist">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 id="product-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            What Pactlab does
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-slate-text">
            Sixteen capabilities across four arcs — one evidence loop underneath them all.
          </p>

          {ARCS.map((arc) => (
            <div key={arc.id} className="mt-14">
              <p className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{arc.eyebrow}</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight">{arc.title}</h3>
              <p className="mt-2 max-w-2xl text-slate-text">{arc.body}</p>
              <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {arc.features.map((feature) => (
                  <article key={feature.title} className="rounded-2xl border border-indigo/10 bg-white p-7">
                    <IconTile name={feature.icon} />
                    <h4 className="mt-4 text-lg font-bold">{feature.title}</h4>
                    <p className="mt-2 leading-relaxed text-slate-text">{feature.body}</p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="principles" aria-labelledby="principles-title" className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 id="principles-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {PRINCIPLES.title}
            </h2>
            <p className="mt-4 text-lg text-white/80">{PRINCIPLES.body}</p>
          </div>
          <ul className="flex flex-col gap-4">
            {PRINCIPLES.items.map((item) => (
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
    </>
  );
}
