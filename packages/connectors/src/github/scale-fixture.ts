import { createHash } from 'node:crypto';
import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';

/**
 * ScaleCo (T-055): a synthetic 3,000-engineer monorepo across 40 areas, so the
 * Engineering tab can be checked at size. Deterministic (no Math.random) and
 * generated on first use only. Invented people; no source contents.
 */
export const SCALECO_REPOSITORY = 'scaleco/monorepo';
export const SCALECO_ENGINEERS = 3000;
const AREAS = Array.from({ length: 40 }, (_, index) => `service-${String(index + 1).padStart(2, '0')}`);
const MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

/** `sc-eng-0001` … `sc-eng-3000`: shared with the ScaleCo Jira site so code and delivery join. */
export const scalecoIdentity = (index: number) => `sc-eng-${String(index + 1).padStart(4, '0')}`;
export const scalecoName = (index: number) => `ScaleCo engineer ${String(index + 1).padStart(4, '0')} (synthetic)`;

function lcg(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % max;
  };
}

/**
 * Home areas: the first five areas each have one maintainer (sole owners,
 * the key-person signal); the rest are shared. A few people work across
 * areas; one in twenty has departed.
 */
function generate(): { commits: CommitMetadata[]; identityMap: ContributorIdentity[] } {
  const next = lcg(55);
  const commits: CommitMetadata[] = [];
  for (let person = 0; person < SCALECO_ENGINEERS; person += 1) {
    const home = person < 5 ? (AREAS[person] as string) : (AREAS[5 + (person % (AREAS.length - 5))] as string);
    const identity = scalecoIdentity(person);
    MONTHS.forEach((month, monthIndex) => {
      const count = person < 5 ? 6 : next(10) < 7 ? 1 + next(2) : 0;
      for (let i = 0; i < count; i += 1) {
        const area = person >= 5 && next(10) === 0 ? (AREAS[5 + next(AREAS.length - 5)] as string) : home;
        const day = String(1 + ((person + i * 7) % 27)).padStart(2, '0');
        const at = `${month}-${day}T10:00:00.000Z`;
        commits.push({
          sha: createHash('sha1').update(`${SCALECO_REPOSITORY}:${identity}:${monthIndex}:${i}`).digest('hex'),
          authorIdentity: identity,
          authorName: scalecoName(person),
          authoredAt: at,
          committedAt: at,
          additions: 5 + next(80),
          deletions: next(30),
          paths: [`${area}/src/file-${i % 5}.ts`],
        });
      }
    });
  }
  commits.sort((a, b) => b.authoredAt.localeCompare(a.authoredAt) || a.sha.localeCompare(b.sha));
  const identityMap: ContributorIdentity[] = Array.from({ length: SCALECO_ENGINEERS }, (_, person) =>
    person % 20 === 19 ? { identity: scalecoIdentity(person), status: 'DEPARTED', departedOn: '2026-03-31' } : { identity: scalecoIdentity(person), status: 'CURRENT', departedOn: null },
  );
  return { commits, identityMap };
}

let cached: ReturnType<typeof generate> | null = null;

/** The ScaleCo repository, generated once on first use. */
export function scalecoRepository() {
  cached ??= generate();
  return {
    repository: SCALECO_REPOSITORY,
    defaultBranch: 'main',
    grantedPermissions: ['metadata:read', 'contents:read', 'pull_requests:read', 'checks:read'] as readonly string[],
    commits: cached.commits,
    identityMap: cached.identityMap,
    // Engineering at scale is about commits and delivery; ScaleCo has no pull requests (T-082 shape).
    pullRequests: [],
    reviews: {},
    checks: {},
  };
}
