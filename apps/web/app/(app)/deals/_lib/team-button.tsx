import Link from 'next/link';

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** The pact's people at a glance (T-094 B12): up to four initials and the count; opens the Team page. */
export function TeamButton({ dealId, members }: { dealId: string; members: readonly { userId: string; displayName: string; role: string }[] }) {
  const shown = members.slice(0, 4);
  return (
    <Link
      href={`/deals/${dealId}/team`}
      aria-label={`Team: ${members.length} ${members.length === 1 ? 'person' : 'people'} on this pact`}
      className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 py-1 pl-1 pr-3 text-sm text-white hover:bg-white/20"
    >
      <span className="flex -space-x-2">
        {shown.map((member) => (
          <span
            key={member.userId}
            title={`${member.displayName} · ${member.role.toLowerCase().replaceAll('_', ' ')}`}
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-navy text-xs font-bold ${member.role === 'TARGET_CONTRIBUTOR' ? 'bg-amber-200 text-navy' : 'bg-indigo text-navy'}`}
          >
            {initials(member.displayName)}
          </span>
        ))}
      </span>
      <span>{members.length}</span>
    </Link>
  );
}
