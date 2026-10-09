import { Briefcase, Home, Plus, ScrollText, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { NavIcon } from '../../../lib/navigation';

export const NAV_ICONS: Readonly<Record<NavIcon, LucideIcon>> = {
  home: Home,
  deals: Briefcase,
  start: Plus,
  audit: ScrollText,
  controls: ShieldCheck,
  settings: Settings,
};
