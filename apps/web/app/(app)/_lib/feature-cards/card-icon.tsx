import { BadgeCheck, Cloud, Compass, Fingerprint, KeyRound, Layers, LockKeyhole, MessagesSquare, Palette, ShieldCheck, Table2, type LucideIcon } from 'lucide-react';
import type { FeatureCardView } from './types';

const ICONS: Record<FeatureCardView['icon'], LucideIcon> = {
  table: Table2,
  cloud: Cloud,
  palette: Palette,
  shield: ShieldCheck,
  lock: LockKeyhole,
  fingerprint: Fingerprint,
  key: KeyRound,
  check: BadgeCheck,
  layers: Layers,
  compass: Compass,
  message: MessagesSquare,
};

export function CardIcon({ name, className }: { name: FeatureCardView['icon']; className?: string }) {
  const Icon = ICONS[name] ?? Table2;
  return <Icon aria-hidden className={className ?? 'h-5 w-5'} />;
}
