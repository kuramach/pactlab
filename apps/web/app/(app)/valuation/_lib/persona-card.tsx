import { Gem, LifeBuoy, Tag, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PersonaOption } from './pricing';

const ICONS: Readonly<Record<PersonaOption['icon'], LucideIcon>> = { Gem, Tag, LifeBuoy };

/** A persona's icon on its own, e.g. in a compare header. */
export function PersonaIcon({ icon, className = 'h-5 w-5' }: { icon: PersonaOption['icon']; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden className={className} strokeWidth={1.75} />;
}

/**
 * A buyer persona at a glance (batch 1): a large icon, the name, two words,
 * and the one-liner in small print. `control` is the radio or button that
 * picks it; the whole card is its label.
 */
export function PersonaCard({ option, selected, control, footer }: { option: PersonaOption; selected: boolean; control?: ReactNode; footer?: ReactNode }) {
  return (
    <div className={`flex h-full flex-col gap-2 rounded-xl border p-4 text-sm transition-colors ${selected ? 'border-indigo-ink bg-indigo/10' : 'border-border hover:border-navy/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${selected ? 'bg-navy text-indigo' : 'bg-muted text-navy'}`}>
          <PersonaIcon icon={option.icon} className="h-6 w-6" />
        </span>
        {control}
      </div>
      <span className="text-base font-bold">{option.label}</span>
      <span className="text-xs font-bold uppercase tracking-widest text-indigo-ink">{option.caption}</span>
      <span className="text-muted-foreground">{option.descriptor}</span>
      {footer ? <div className="mt-auto pt-1">{footer}</div> : null}
    </div>
  );
}
