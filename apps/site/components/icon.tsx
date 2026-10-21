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

/**
 * A module's or industry's mark: a white line icon on a navy-to-indigo tile.
 * One treatment everywhere a module or industry is introduced, so the set
 * reads as designed rather than default. Decorative; the name sits beside it.
 */
export function ModuleMark({ name, size = 'md' }: { name: IconName; size?: 'md' | 'lg' }) {
  return (
    <span
      data-mark={name}
      className={
        (size === 'lg' ? 'h-16 w-16 rounded-2xl [&_svg]:h-8 [&_svg]:w-8' : 'h-12 w-12 rounded-xl [&_svg]:h-6 [&_svg]:w-6') +
        ' inline-flex shrink-0 items-center justify-center bg-linear-to-br from-navy to-indigo-ink text-white shadow-md shadow-navy/20 ring-1 ring-inset ring-white/15'
      }
    >
      <Icon name={name} className="" />
    </span>
  );
}
