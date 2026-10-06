import type { ReactNode } from 'react';
import type { IconName } from '../lib/content';
import { Icon } from './icon';

/** Navy page header shared by inner pages. */
export function PageHero({
  eyebrow,
  title,
  body,
  icon,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <section className="bg-navy text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-16 md:py-20">
        <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-indigo">
          {icon ? <Icon name={icon} className="h-4 w-4" /> : null}
          {eyebrow}
        </p>
        <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">{title}</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-white/80">{body}</p>
        {children}
      </div>
    </section>
  );
}

export function Section({
  id,
  title,
  body,
  tone = 'white',
  children,
}: {
  id?: string;
  title: string;
  body?: string;
  tone?: 'white' | 'mist' | 'cloud' | 'navy';
  children: ReactNode;
}) {
  const background = { white: 'bg-white', mist: 'bg-mist', cloud: 'bg-cloud', navy: 'bg-navy text-white' }[tone];
  return (
    <section id={id} className={background}>
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <h2 className="max-w-3xl text-3xl font-extrabold tracking-tight">{title}</h2>
        {body ? (
          <p className={`mt-3 max-w-2xl text-lg leading-relaxed ${tone === 'navy' ? 'text-white/80' : 'text-slate-text'}`}>{body}</p>
        ) : null}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
