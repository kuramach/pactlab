export type ContributorTag = 'CRITICAL_OWNER' | 'COORDINATOR' | 'BUILDER' | 'CROSS_AREA' | 'RECENTLY_QUIET';

export interface ProfileView {
  contributorKey: string;
  label: string;
  name: string | null;
  status: 'CURRENT' | 'DEPARTED' | 'UNKNOWN';
  commits: number;
  linesChanged: number;
  areasActive: string[];
  areasOwned: string[];
  areasSolelyOwned: string[];
  issuesResolved: number;
  pointsResolved: number;
  issuesCreated: number;
  comments: number;
  reopenRatio: string | null;
  firstActiveMonth: string;
  lastActiveMonth: string;
  trend: 'UP' | 'DOWN' | 'STEADY';
  tags: ContributorTag[];
  summary: string;
}

export interface PeopleAccessView {
  enabled: boolean;
  basis: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface EngineeringView {
  window: { from: string; to: string };
  months: { month: string; commits: number; codeContributors: number; deliveryContributors: number; issuesResolved: number; pointsResolved: number; reopenRate: string | null }[];
  areas: { area: string; commits: number; contributors: number; busFactor: number }[];
  contributors: number;
  busFactor: number;
  unmatchedOrDepartedShare: string | null;
  suppressed: boolean;
  profiles: ProfileView[];
  keepList: { contributorKey: string; label: string; name: string | null; reason: string }[];
  people: PeopleAccessView;
  canManageNames: boolean;
  sources: { id: string; provider: string; displayName: string; mode: 'FIXTURE' | 'LIVE' }[];
  keyPersonFindings: { id: string; title: string; status: string; direction: number | null }[];
}

/** Plain-language tags: descriptions of activity, never a verdict on a person. */
export const TAG_LABELS: Readonly<Record<ContributorTag, { label: string; help: string; variant: 'danger' | 'reviewed' | 'calculation' | 'evidence' | 'neutral' }>> = {
  CRITICAL_OWNER: { label: 'Critical owner', help: 'The only regular maintainer of at least one area of the code.', variant: 'danger' },
  COORDINATOR: { label: 'Coordinator', help: 'Few commits, but creates and discusses much of the delivery work in Jira — often a lead, architect or product role.', variant: 'reviewed' },
  BUILDER: { label: 'Builder', help: 'Among the most active committers in the last 12 months.', variant: 'calculation' },
  CROSS_AREA: { label: 'Cross-area', help: 'Works across three or more areas of the code.', variant: 'evidence' },
  RECENTLY_QUIET: { label: 'Recently quiet', help: 'No recorded activity in the last three months — could be leave, a role change or work outside these tools.', variant: 'neutral' },
};

/** "Contributor 07" or "Grace Okafor (synthetic) · Contributor 07" when names are shown. */
export function displayName(profile: { label: string; name: string | null }): string {
  return profile.name ? `${profile.name} · ${profile.label}` : profile.label;
}

/** '0.0909' → '9.1%'. Display only. */
export function percentLabel(ratio: string | null): string {
  if (ratio === null) return '—';
  const [whole = '0', fraction = ''] = ratio.split('.');
  const basisPoints = Number(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
  return `${(basisPoints / 100).toFixed(1).replace(/\.0$/, '')}%`;
}
