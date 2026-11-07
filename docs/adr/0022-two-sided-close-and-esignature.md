# ADR 0022: Two-sided agreement and close, with e-signature from the customer's own account

Status: accepted (2026-11-07, T-107)

## Context

T-105 and batch 1 let the buyer propose versioned terms and the seller accept, reject or counter each one. That is a negotiation, not an agreement:
- the headline price wasn't a term;
- nobody signed for either side;
- only the buyer could propose;
- closing was a buyer-side stage change.

Kumar asked for the deal to be agreed and approved from both sides once it is done, with DocuSign "as the pact creator's accounts. We should just integrate." He also asked for a funds-transfer check: the buyer pays through another channel, records it, and the seller reviews and confirms.

## Decision

1. **The headline price is a term.**
   - **Buyer versions:** every buyer version leads with `PURCHASE_PRICE` (the adopted evaluation's weighted price).
   - **Seller versions:** a seller version must lead with it.
   - **Countering:** it is countered like any other term.
2. **Either side proposes; the other answers.**
   - **Versions:** `term_proposal_batches.initiated_by_side`. A seller's draft is visible only to the seller side until proposed.
   - **RLS:** the answering side is the opposite of the proposing side.
   - **Counters:** the proposing side takes counters into its own next version.
3. **Named signatories.**
   - **Who names them:** the buyer's deal lead names the buyer signatory from the buyer side; any seller contributor names the seller signatory from the seller side.
   - **Storage:** `pact_signatories` is append-only, and the latest per side counts.
   - **Lock:** a signatory is fixed once their side has signed the current version.
4. **Sign-off.** An agreed version needs one `term_signoffs` row per side. It can come from either:
   - **In Pactlab:** RLS admits only the side's current signatory, on an agreed, undeclined version.
   - **By e-signature:** both rows are written when the envelope completes.

   A signatory may decline an agreed version before anyone signs; a new version then follows.
5. **E-signature from the customer's own DocuSign.**
   - **The connection:** an organization's owner or admin connects its DocuSign account (OAuth Authorization Code Grant; tokens in the `SecretStore`; `organization_connections` holds the account id, name and base URI). Envelopes are sent from that account.
   - **Pactlab's part:** Pactlab holds only its app registration (an integration key and secret, `DOCUSIGN_*`). That registration is not a sending account.
   - **What is signed:** the term sheet Pactlab generates from the agreed version (deterministic; its SHA-256 is recorded), plus an optional shared PDF agreement.
   - **Signing provider:** behind the `SigningProvider` adapter.
     - **DocuSign:** eSignature REST v2.1, written from DocuSign's documentation.
     - **Fixture:** used outside production.
   - **The webhook:** Connect events arrive at `POST /v1/webhooks/signing/docusign`.
     - **Verification:** HMAC-SHA256 over the raw body. They carry no session.
     - **Recording:** `app_signing_record`, a SECURITY DEFINER function owned by `pactlab_auth`, settles a SENT envelope once and records both sign-offs.
     - **Audit:** the sign-in role may append only the three e-signature outcome events. To continue the hash chain, it may read audit rows only on deals that use e-signature.
6. **The closing checklist** (`closing_items`). A trigger polices it on top of RLS.
   - **Conditions:** either side adds one, naming the side that ticks it.
   - **Funds transfer:** the buyer records the payment (date, reference, optional shared proof), and the seller confirms receipt or disputes it with a note, which sends it back.
   - **No money moves:** Pactlab never moves money or stores bank details.
7. **The close.**
   - **Who:** the buyer's deal lead.
   - **When:** only when the latest agreed version has both sign-offs and every checklist item is done.
   - **What it records:** the date and both signatories; then Post-Close is generated.
   - **The old path:** once any version has been proposed on the pact, the one-sided `stage: CLOSED` is refused. A pact never negotiated on Pactlab (buyer-only diligence) still closes as before.

## Consequences

- **Agreement on record:** a deal now has, for each step, who did it and when: price, terms, signatures, payment, close.
- **Buyer-confidential data stays put:** term sheets, envelopes and seller views carry no persona, finding or pricing parameter, and tests scan for them.
- **DocuSign on deployed environments:** it needs `T-007` (Secrets Manager) for token storage, plus Pactlab's DocuSign app registration and DocuSign's go-live review (`docs/runbooks/docusign.md`). Until then, deployed environments sign off in Pactlab, and only non-production environments offer the fixture e-signature.
- **Rollback:** both migrations only add things. Drop the new tables, functions, policies and columns, and restore the term policies and trigger from `20261124000000` and `20261125000000`.
