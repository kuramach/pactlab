import { ICONS, type IconName } from '../lib/icons';

/** Decorative line icon; the adjacent text always carries the meaning. */
export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  const Component = ICONS[name];
  return <Component aria-hidden className={className} strokeWidth={1.75} />;
}

/** Icon on a soft indigo tile, used for features and steps. */
export function IconTile({ name, tone = 'light' }: { name: IconName; tone?: 'light' | 'dark' }) {
  return (
    <span
      className={
        tone === 'dark'
          ? 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo/15 text-indigo'
          : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo/10 text-indigo-ink'
      }
    >
      <Icon name={name} className="h-5 w-5" />
    </span>
  );
}
