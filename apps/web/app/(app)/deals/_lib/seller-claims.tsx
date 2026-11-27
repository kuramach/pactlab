import { isHandSourcedOrigin, type ClaimView } from '@pactlab/contracts';
import { Badge } from '@pactlab/ui';

/** Plain words for a claim's state (T-094 B7): what the seller said, against what the evidence shows. */
export const CLAIM_VERDICT = {
  UNVERIFIED: { label: 'Not checked yet', short: 'Seller claim not checked', variant: 'draft' },
  VERIFIED: { label: 'Confirmed by the evidence', short: 'Confirms what the seller said', variant: 'calculation' },
  CONTRADICTED: { label: 'Contradicted by the evidence', short: 'Contradicts what the seller said', variant: 'danger' },
} as const;

/** The seller statements a finding bears on. */
export const claimsFor = (claims: readonly ClaimView[], findingId: string) => claims.filter((claim) => claim.findings.some((finding) => finding.id === findingId));

/** One badge for a finding in a list: the strongest verdict among its linked claims. */
export function ClaimVerdictBadge({ claims }: { claims: readonly ClaimView[] }) {
  if (claims.length === 0) return null;
  const status = claims.some((claim) => claim.status === 'CONTRADICTED') ? 'CONTRADICTED' : claims.some((claim) => claim.status === 'VERIFIED') ? 'VERIFIED' : 'UNVERIFIED';
  return <Badge variant={CLAIM_VERDICT[status].variant}>{CLAIM_VERDICT[status].short}</Badge>;
}

/** What a hand-sourced claim is, wherever it is used (T-178d): the seller's word, entered by hand. */
export const HAND_SOURCED_HELP = 'Entered by hand in Pactlab Rinse: the seller’s word, not documentary evidence.';

/** Whether a finding rests on anything the seller entered by hand rather than a document. */
export const restsOnHandSourced = (claims: readonly ClaimView[]) => claims.some((claim) => isHandSourcedOrigin(claim.origin));

/** Shown on a finding (or a Deal Critical, T-179) that rests on a hand-sourced claim. */
export function HandSourcedBadge({ claims }: { claims: readonly ClaimView[] }) {
  if (!restsOnHandSourced(claims)) return null;
  return (
    <Badge variant="draft" title={HAND_SOURCED_HELP}>
      Rests on a hand-sourced claim
    </Badge>
  );
}

/** On a finding: each thing the seller said that it supports or contradicts, in plain words. */
export function SellerClaims({ claims }: { claims: readonly ClaimView[] }) {
  if (claims.length === 0) return <p className="text-sm text-muted-foreground">This finding is not linked to anything the seller said.</p>;
  return (
    <ul className="flex flex-col gap-3 text-sm" aria-label="What the seller said">
      {claims.map((claim) => (
        <li key={claim.id} className="flex flex-col gap-1">
          <span>
            <span className="text-muted-foreground">The seller said:</span> “{claim.statement}”{claim.source ? <span className="text-muted-foreground"> ({claim.source})</span> : null}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={CLAIM_VERDICT[claim.status].variant}>{CLAIM_VERDICT[claim.status].label}</Badge>
            {isHandSourcedOrigin(claim.origin) ? (
              <Badge variant="draft" title={HAND_SOURCED_HELP}>
                Hand-sourced
              </Badge>
            ) : null}
            {claim.rationale ? <span className="text-muted-foreground">{claim.rationale}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
