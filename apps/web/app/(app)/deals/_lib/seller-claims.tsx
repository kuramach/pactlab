import { isHandSourcedOrigin, type ClaimView } from '@pactlab/contracts';
import { Badge } from '@pactlab/ui';
import { EN, type I18n } from '../../../../lib/i18n';

/** How a claim's state looks (T-094 B7); its words are in the catalog (`common.claims.verdicts`). */
export const CLAIM_VERDICT = {
  UNVERIFIED: { label: EN.m.common.claims.verdicts.UNVERIFIED.label, short: EN.m.common.claims.verdicts.UNVERIFIED.short, variant: 'draft' },
  VERIFIED: { label: EN.m.common.claims.verdicts.VERIFIED.label, short: EN.m.common.claims.verdicts.VERIFIED.short, variant: 'calculation' },
  CONTRADICTED: { label: EN.m.common.claims.verdicts.CONTRADICTED.label, short: EN.m.common.claims.verdicts.CONTRADICTED.short, variant: 'danger' },
} as const;

/** The seller statements a finding bears on. */
export const claimsFor = (claims: readonly ClaimView[], findingId: string) => claims.filter((claim) => claim.findings.some((finding) => finding.id === findingId));

/** One badge for a finding in a list: the strongest verdict among its linked claims. */
export function ClaimVerdictBadge({ claims, t = EN }: { claims: readonly ClaimView[]; t?: I18n }) {
  if (claims.length === 0) return null;
  const status = claims.some((claim) => claim.status === 'CONTRADICTED') ? 'CONTRADICTED' : claims.some((claim) => claim.status === 'VERIFIED') ? 'VERIFIED' : 'UNVERIFIED';
  return <Badge variant={CLAIM_VERDICT[status].variant}>{t.m.common.claims.verdicts[status].short}</Badge>;
}

/** What a hand-sourced claim is, wherever it is used (T-178d): the seller's word, entered by hand. */
export const HAND_SOURCED_HELP = EN.m.common.claims.handSourcedHelp;

/** Whether a finding rests on anything the seller entered by hand rather than a document. */
export const restsOnHandSourced = (claims: readonly ClaimView[]) => claims.some((claim) => isHandSourcedOrigin(claim.origin));

/** Shown on a finding (or a Deal Critical, T-179) that rests on a hand-sourced claim. */
export function HandSourcedBadge({ claims, t = EN }: { claims: readonly ClaimView[]; t?: I18n }) {
  if (!restsOnHandSourced(claims)) return null;
  return (
    <Badge variant="draft" title={t.m.common.claims.handSourcedHelp}>
      {t.m.common.claims.restsOnHandSourced}
    </Badge>
  );
}

/** On a finding: each thing the seller said that it supports or contradicts, in plain words. */
export function SellerClaims({ claims, t = EN }: { claims: readonly ClaimView[]; t?: I18n }) {
  const words = t.m.common.claims;
  if (claims.length === 0) return <p className="text-sm text-muted-foreground">{words.none}</p>;
  return (
    <ul className="flex flex-col gap-3 text-sm" aria-label={words.listLabel}>
      {claims.map((claim) => (
        <li key={claim.id} className="flex flex-col gap-1">
          <span>
            <span className="text-muted-foreground">{words.sellerSaid}</span> “{claim.statement}”{claim.source ? <span className="text-muted-foreground"> ({claim.source})</span> : null}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={CLAIM_VERDICT[claim.status].variant}>{words.verdicts[claim.status].label}</Badge>
            {isHandSourcedOrigin(claim.origin) ? (
              <Badge variant="draft" title={words.handSourcedHelp}>
                {words.handSourced}
              </Badge>
            ) : null}
            {claim.rationale ? <span className="text-muted-foreground">{claim.rationale}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
