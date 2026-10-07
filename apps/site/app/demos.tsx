import { DEMOS } from '../lib/content';

/**
 * Animated product demos. The GIF plays by default; under
 * `prefers-reduced-motion` the static poster frame shows instead.
 */
export function Demos() {
  return (
    <section id="demos" aria-labelledby="demos-title" className="bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 id="demos-title" className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
          Watch it work
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-slate-text">
          Four flows, end to end. No mockups of mockups — this is the shape of the real thing.
        </p>
        <div className="mt-12 flex flex-col gap-14">
          {DEMOS.map((demo, index) => (
            <article
              key={demo.id}
              className={`grid items-center gap-8 md:grid-cols-2 ${index % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}`}
            >
              <div>
                <img
                  src={demo.gif}
                  alt=""
                  width={800}
                  height={450}
                  loading="lazy"
                  className="rounded-2xl border border-indigo/20 bg-white shadow-lg shadow-indigo/5 motion-reduce:hidden"
                />
                <img
                  src={demo.poster}
                  alt=""
                  width={800}
                  height={450}
                  loading="lazy"
                  className="hidden rounded-2xl border border-indigo/20 bg-white shadow-lg shadow-indigo/5 motion-reduce:block"
                />
              </div>
              <div>
                <h3 className="text-2xl font-bold tracking-tight">{demo.title}</h3>
                <p className="mt-3 text-lg leading-relaxed text-slate-text">{demo.body}</p>
                <p className="sr-only">{demo.alt}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
