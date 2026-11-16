import { existsSync, readFileSync } from 'node:fs';
import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import type { CheckSummary, PullRequestMetadata, ReviewSummary } from './github/types';
import type { JiraIssue, JiraSprint } from './jira/types';

/**
 * The Kafka demo snapshot (T-127): a bounded slice of the real apache/kafka repository and the
 * KAFKA project on Apache Jira, recorded once by `scripts/record-kafka-snapshot.ts` and replayed
 * by the fixture adapters, so the demo shows a real integration and never calls GitHub or Jira.
 * People are pseudonymous (`kafka-dev-…`, `kafka-jira-…`); the activity is real. Nothing
 * refreshes it: re-recording is a deliberate, reviewed change to `fixtures/recorded/kafka/`.
 */
export const KAFKA_SNAPSHOT_REPOSITORY = 'apache/kafka';
export const KAFKA_SNAPSHOT_SITE = 'issues.apache.org';
export const KAFKA_SNAPSHOT_PROJECT = 'KAFKA';
/** How much is recorded: enough to show the engineering view at real scale, small enough to load fast and review. */
export const KAFKA_SNAPSHOT_LIMITS = { commits: 500, pullRequests: 200 } as const;

export interface KafkaSnapshot {
  readonly recordedAt: string;
  readonly source: { readonly repository: string; readonly headSha: string; readonly defaultBranch: string; readonly jira: string; readonly project: string };
  readonly github: {
    readonly commits: readonly CommitMetadata[];
    readonly identityMap: readonly ContributorIdentity[];
    readonly pullRequests: readonly PullRequestMetadata[];
    readonly reviews: Readonly<Record<number, ReviewSummary>>;
    readonly checks: Readonly<Record<string, CheckSummary>>;
  };
  readonly jira: { readonly issues: readonly JiraIssue[]; readonly sprints: readonly JiraSprint[] };
}

/**
 * Java annotations and Javadoc tags: code, not people, so they stay in messages and titles. An
 * annotation is CamelCase with a second capital (`@ClusterTest`), or a known one-word annotation;
 * anything else after an `@` may be a GitHub handle, so it is masked.
 */
const ONE_WORD_ANNOTATIONS = new Set(['Override', 'Test', 'Timeout', 'Deprecated', 'Flaky', 'Disabled', 'Tag', 'Nested', 'Inherited', 'Documented', 'Retention', 'Target', 'Before', 'After', 'Ignore', 'Rule', 'Mock', 'Spy', 'Nullable', 'Nonnull', 'Evolving', 'Stable', 'Unstable', 'Public']);
const JAVADOC_TAGS = new Set(['param', 'link', 'linkplain', 'throws', 'return', 'returns', 'see', 'since', 'code', 'value', 'inheritDoc', 'nowarn', 'deprecated', 'exception', 'literal']);
const isCode = (word: string) => JAVADOC_TAGS.has(word) || ONE_WORD_ANNOTATIONS.has(word) || /^[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+$/.test(word);

/** Masks GitHub @-mentions of people in a commit message or pull-request title (`@someone` → `@[person]`). */
export function maskMentions(text: string | null): string | null {
  if (text === null) return null;
  return text.replace(/(?<![\w.])@([A-Za-z0-9][\w-]*)/g, (whole, word: string) => (isCode(word) ? whole : '@[person]'));
}

const FILE = new URL('../../../fixtures/recorded/kafka/snapshot.json', import.meta.url);
let loaded: KafkaSnapshot | null = null;

/** Whether the snapshot has been recorded into this checkout (and image). */
export function hasKafkaSnapshot(): boolean {
  return existsSync(FILE);
}

/** The recorded snapshot, read once. Throws when it was never recorded. */
export function kafkaSnapshot(): KafkaSnapshot {
  if (!loaded) {
    if (!hasKafkaSnapshot()) throw new Error('The Kafka demo snapshot is not recorded (fixtures/recorded/kafka/snapshot.json).');
    loaded = JSON.parse(readFileSync(FILE, 'utf8')) as KafkaSnapshot;
  }
  return loaded;
}
