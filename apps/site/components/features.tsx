import type { Feature } from '../lib/content';
import { IconTile } from './icon';

export function FeatureGrid({
  features,
  columns = 3,
  tone = 'light',
}: {
  features: readonly Feature[];
  columns?: 2 | 3;
  tone?: 'light' | 'dark';
}) {
  const dark = tone === 'dark';
  return (
    <ul className={`grid gap-4 sm:grid-cols-2 ${columns === 3 ? 'lg:grid-cols-3' : ''}`}>
      {features.map((feature) => (
        <li
          key={feature.title}
          className={`flex gap-4 rounded-2xl p-6 ${dark ? 'border border-white/10 bg-white/5' : 'border border-navy/10 bg-white'}`}
        >
          <IconTile name={feature.icon} tone={tone} />
          <div>
            <h3 className={`font-bold ${dark ? 'text-white' : 'text-navy'}`}>{feature.title}</h3>
            <p className={`mt-1 text-sm leading-relaxed ${dark ? 'text-white/75' : 'text-slate-text'}`}>{feature.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
