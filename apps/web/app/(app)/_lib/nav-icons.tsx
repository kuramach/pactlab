import { Briefcase, FileText, Home, Plus, Scale, ScrollText, Settings, ShieldCheck, Wrench, type LucideIcon } from 'lucide-react';
import type { NavIcon } from '../../../lib/navigation';

export const NAV_ICONS: Readonly<Record<NavIcon, LucideIcon>> = {
  home: Home,
  deals: Briefcase,
  start: Plus,
  comparables: Scale,
  reports: FileText,
  audit: ScrollText,
  controls: ShieldCheck,
  settings: Settings,
  admin: Wrench,
};
