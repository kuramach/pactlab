/**
 * Evidence types read through MCP servers (T-084c). Kept apart from the profiles so the
 * valuation direction map can import them without a cycle; every type here must have a
 * `VALUATION_DIRECTION_MAP` entry before a profile may emit it.
 */

/** One open-source dependency vulnerability alert on a repository (GitHub Dependabot, read through GitHub's MCP server). */
export const DEPENDENCY_ALERT_EVIDENCE_TYPE = 'security.dependency_alert';
