import { FLOW } from '../lib/content';
import { Icon } from './icon';

/**
 * The decision loop as a connected sequence: a row on wide screens, a
 * vertical timeline on small ones. `highlight` marks steps a page is about.
 */
export function Flow({ tone = 'light', highlight = [] }: { tone?: 'light' | 'dark'; highlight?: readonly string[] }) {
  const dark = tone === 'dark';
  return (
    <ol className="grid gap-0 lg:grid-cols-6 lg:gap-3">
      {FLOW.map((step, index) => {
        const on = highlight.length === 0 || highlight.includes(step.step);
        return (
          <li key={step.step} className="relative flex gap-4 pb-8 lg:flex-col lg:gap-3 lg:pb-0">
            {index < FLOW.length - 1 ? (
              <span
                aria-hidden
                className={`absolute left-[1.375rem] top-12 h-[calc(100%-3rem)] w-px lg:left-[3.25rem] lg:top-[1.375rem] lg:h-px lg:w-[calc(100%-2.5rem)] ${dark ? 'bg-white/20' : 'bg-indigo/30'}`}
              />
            ) : null}
            <span
              className={`relative z-10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 ${
                on
                  ? dark
                    ? 'border-indigo bg-indigo text-navy'
                    : 'border-indigo bg-indigo text-navy'
                  : dark
                    ? 'border-white/25 bg-navy text-white/60'
                    : 'border-indigo/30 bg-white text-indigo-ink'
              }`}
            >
              <Icon name={step.icon} className="h-5 w-5" />
            </span>
            <div>
              <p className={`text-xs font-bold uppercase tracking-widest ${dark ? 'text-indigo' : 'text-indigo-ink'}`}>
                {String(index + 1).padStart(2, '0')} · {step.step}
              </p>
              <h3 className={`mt-1 font-bold ${dark ? 'text-white' : 'text-navy'}`}>{step.title}</h3>
              <p className={`mt-1 text-sm leading-relaxed ${dark ? 'text-white/75' : 'text-slate-text'}`}>{step.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
