import type { FindingConfidence, FindingDomain, FindingSeverity, ProposedFinding } from './types';

export const SCAN_CATEGORIES = ['CODE', 'LICENSE', 'VULNERABLE_DEPENDENCY'] as const;
export type ScanCategory = (typeof SCAN_CATEGORIES)[number];

/**
 * Scanner output after normalization on the runner. Carries locations,
 * hashes and versions only — never source text.
 */
export interface NormalizedScanFinding {
  readonly category: ScanCategory;
  readonly ruleId: string;
  readonly title: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly path: string | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  /** Stable hash of rule, path and component; identical across re-runs. */
  readonly fingerprint: string;
  readonly scanner: string;
  readonly scannerVersion: string;
  readonly rulesetVersion: string | null;
  readonly commitSha: string;
  readonly remediation: string | null;
  /** SPDX license id for LICENSE findings. */
  readonly license: string | null;
  /** Package URL for dependency and license findings. */
  readonly component: string | null;
  readonly cve: string | null;
}

const DOMAIN_BY_CATEGORY: Readonly<Record<ScanCategory, FindingDomain>> = {
  CODE: 'SECURITY',
  LICENSE: 'OSS_LICENSE',
  VULNERABLE_DEPENDENCY: 'SECURITY',
};

/** Map one normalized scan result to a draft finding citing the stored scan evidence item. */
export function scanFindingToProposal(
  scan: NormalizedScanFinding,
  evidenceItemId: string,
): ProposedFinding {
  const subject = scan.component ?? scan.path ?? 'repository';
  const details = [
    `${scan.scanner} ${scan.scannerVersion} rule ${scan.ruleId} reported this at ${subject}` +
      (scan.lineStart ? ` line ${scan.lineStart}` : '') +
      ` in commit ${scan.commitSha.slice(0, 12)}.`,
    scan.license ? `License: ${scan.license}.` : null,
    scan.cve ? `Reference: ${scan.cve}.` : null,
    scan.remediation ? `Remediation: ${scan.remediation}` : null,
  ].filter((line): line is string => line !== null);
  return {
    domain: DOMAIN_BY_CATEGORY[scan.category],
    title: scan.title,
    description: details.join(' '),
    severity: scan.severity,
    confidence: scan.confidence,
    origin: 'SCANNER',
    fingerprint: `scan:${scan.fingerprint}`,
    evidence: [
      {
        evidenceItemId,
        commitSha: scan.commitSha,
        toolName: scan.scanner,
        toolVersion: scan.scannerVersion,
        rulesetVersion: scan.rulesetVersion,
        path: scan.path,
        lineStart: scan.lineStart,
        lineEnd: scan.lineEnd,
      },
    ],
    pricedRisk: null,
  };
}
