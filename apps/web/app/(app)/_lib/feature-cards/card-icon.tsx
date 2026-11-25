import { Cloud, Palette, Table2, type LucideIcon } from 'lucide-react';
import type { FeatureCardView } from './types';

const ICONS: Record<FeatureCardView['icon'], LucideIcon> = { table: Table2, cloud: Cloud, palette: Palette };

export function CardIcon({ name, className }: { name: FeatureCardView['icon']; className?: string }) {
  const Icon = ICONS[name] ?? Table2;
  return <Icon aria-hidden className={className ?? 'h-5 w-5'} />;
}
