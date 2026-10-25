/**
 * Cross-links between code and delivery (T-082): commit messages and pull
 * request titles name Jira issues by key (`KAFKA-1234`). The connector emits
 * one link per (commit or pull request, key); these helpers resolve links in
 * both directions over normalized data.
 */
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9})-([1-9]\d{0,7})\b/g;
/** Standards and encodings that look like issue keys (`UTF-8`, `SHA-256`, `RFC-7231`); never projects here. */
const NOT_PROJECTS = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'CVE', 'CWE', 'GPL', 'LGPL', 'AGPL', 'TLS', 'SSL', 'AES', 'RSA', 'HTTP', 'IPV', 'MD', 'X', 'PEP', 'JSR', 'JEP', 'ES']);

/** Distinct issue keys in a text, in order of first appearance. */
export function issueKeysIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const keys = [...text.matchAll(ISSUE_KEY)].filter((match) => !NOT_PROJECTS.has(match[1] ?? '')).map((match) => `${match[1]}-${match[2]}`);
  return [...new Set(keys)];
}

export interface IssueLink {
  readonly repository: string;
  readonly kind: 'COMMIT' | 'PULL_REQUEST';
  /** Commit SHA, or pull-request number as a string. */
  readonly id: string;
  readonly issueKey: string;
}

/** Links whose text names this issue: from a Jira issue to the commits and pull requests that reference it. */
export function linksForIssue(links: readonly IssueLink[], issueKey: string): IssueLink[] {
  return links.filter((link) => link.issueKey === issueKey);
}

/** The issue a link names, or null when the key resolves to no known issue. */
export function issueForLink<T extends { readonly key: string }>(issues: readonly T[], link: IssueLink): T | null {
  return issues.find((issue) => issue.key === link.issueKey) ?? null;
}
