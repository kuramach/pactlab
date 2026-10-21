import { Briefcase, Database, Plug, type LucideIcon } from 'lucide-react';

/**
 * Line icons for the empty states that introduce a workspace, drawn as the
 * website's module mark (`EmptyState` `icon`). Evidence uses the site's
 * Evidence step icon. Error and access states stay plain.
 */
export const EMPTY_MARKS = {
  deals: Briefcase,
  sources: Plug,
  evidence: Database,
} as const satisfies Record<string, LucideIcon>;

export type EmptyMark = keyof typeof EMPTY_MARKS;

export function EmptyMarkIcon({ name }: { name: EmptyMark }) {
  const Component = EMPTY_MARKS[name];
  return <Component strokeWidth={1.75} />;
}
