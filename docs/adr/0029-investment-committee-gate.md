# ADR 0029: The investment committee decides the deal: IC pack, recorded decision, gate before signing (T-118)

**Status:** accepted (Kumar, 2026-11-13)

## Context
- **The gap:** a PE reviewer: "Investment committee decides the deal." Pactlab had the IC only as a reader in the spec, with no pack, no decision and no gate.
- **Kumar's choices:**
  - **Committee membership:**
    - an **organization-wide committee list** for organizations (typically SSO companies);
    - **committee members named on a pact** otherwise;
    - a pact's committee is both.
  - **The gate sits before signing and is off by default:** organizations switch it on, and each pact can override.

## Decision
- **Role:** a new deal role `INVESTMENT_COMMITTEE` reads the buyer's analysis (`BUYER_ANALYSIS_READ`) and decides IC packs. It changes nothing else.
  - **Own side:** it is not a counterparty, so every own-side-only table and RLS policy covers it with no new rule.
  - **The organization list:** `organization_memberships.investment_committee`, set by owners and admins. Submitting a pack seats the list on the pact with this role.
- **The IC pack is a report** (T-110) of scope `IC`: immutable, versioned, stamped with what it captured.
  - **First page:** what the committee is asked to decide, the largest priced risks and the open blockers.
  - **The rest:** the pact report, built from the submitter's own view.
- **The record:** `ic_submissions`, `ic_decisions` (one per submission, append-only) and `ic_conditions` (OPEN → ADDRESSED → CLEARED, forward only).
  - **One decision per pack,** by a committee member, as themselves (RLS `WITH CHECK app_is_ic_member`).
  - **After a decline,** a revised pack is submitted, and earlier packs and decisions stay.
  - **Conditions** are addressed by the deal team. They need the committee's clearing only when the organization switches that on.
- **State** (NONE, SUBMITTED, APPROVED, CONDITIONS_OPEN or DECLINED) is derived from the record, never stored.
- **The gate:** when `deals.ic_approval_required ?? organizations.ic_approval_required` is on and the state isn't APPROVED, the buyer's sign-off, e-signature sending and the close are refused (422 `IC_APPROVAL_REQUIRED`). The close view lists it as missing for the buyer.
  - **Still allowed:** negotiating terms and naming signatories.
  - **The seller** is never told: their close view and errors don't mention a committee.
- **Confidentiality:**
  - every `ic_*` table is readable only by the pact's own side (`app_is_buyer_side`);
  - the seller doesn't even see the tab;
  - the committee section of the pact report appears only in reports made by the own side.
- **Report visibility, fixed here:**
  - **The problem:** a report version was readable by anyone on its pact in its organization, which included a seller (a guest). They could read the buyer's pact and executive reports.
  - **Now:** a report version is readable by its author and, for a pact report made by the pact's own side, by that side.
  - **Executive reports** stay with their author.
  - **Version numbers** run per series (the own side shares one; anyone else numbers their own), so nobody reads another side's activity from a gap.

## Consequences
- **Not yet in the pack:** T-117 (financing posture) is not built, so the pack has no financing section yet. It belongs on the first page when T-117 lands.
- **Visible change:** organization members no longer see each other's executive reports, which matches what each person may see.
- **Rollback:** migration `20261204000000_investment_committee` is expand-only. Drop the `ic_*` tables, the new columns and functions, and restore `report_versions_tenant`, `report_versions_scope` and the version index from `20261201000000_reports`.
