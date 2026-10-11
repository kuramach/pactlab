import { Briefcase, Home, Plus, Scale, ScrollText, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { NavIcon } from '../../../lib/navigation';

export const NAV_ICONS: Readonly<Record<NavIcon, LucideIcon>> = {
  home: Home,
  deals: Briefcase,
  start: Plus,
  comparables: Scale,
  audit: ScrollText,
  controls: ShieldCheck,
  settings: Settings,
};
