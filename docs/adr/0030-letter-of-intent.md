# ADR 0030: The letter of intent: generated from agreed terms, binding and non-binding parts, signed by both sides (T-119)

**Status:** accepted (Kumar, 2026-11-13)

## Context
- **The gap** (a PE reviewer): "Intent letter — binding and non-binding." Pactlab went straight from agreed terms to the definitive agreement (T-107). The LOI is the bridge:
  - the economics are stated as intent;
  - exclusivity, confidentiality, law and expenses bind;
  - both sides sign on that basis.
- **Kumar's choices:**
  - optional and tracked, with a per-pact "required" switch;
  - signed in Pactlab or through the buyer's DocuSign;
  - generated from an **agreed** terms version.

## Decision
- **Its place in the flow:** agreed terms (T-105, T-107) → **letter of intent** (optional) → investment committee where required (T-118) → definitive agreement signed (T-107) → close.
  - **When required:** the definitive terms can't be signed (`LOI_REQUIRED`) until a letter is countersigned. Both sides see this, because the letter is two-sided.
- **One maintained template, with named fields:**
  - exclusivity days;
  - governing law (blank, and required before sending);
  - expenses;
  - diligence days;
  - target date;
  - days to countersign;
  - closing conditions.

  **Quoted verbatim:** the agreed terms (stored decimals and currency) and the parties. Nothing else enters: no persona, confirmed value or IC content, and no AI-drafted legal prose.
- **Two labelled parts,** in the review screen and the PDF:
  - *Non-binding provisions:* price and consideration, other agreed terms, diligence, timeline, conditions, and an explicit "no obligation to close".
  - *Binding provisions:* exclusivity, confidentiality, governing law, expenses, counterparts and electronic signature, and termination.

  The signature block says only the binding part binds. Every page carries "Not legal advice; have your counsel review."
- **Lifecycle:** DRAFT → SENT → COUNTERSIGNED, DECLINED or EXPIRED.
  - **A draft** is visible to the pact's own side only (RLS).
  - **A sent letter** is frozen, by snapshot plus PDF digest, and a trigger refuses any change except the status moving forward.
  - **In the app:** the buyer's named signatory signs, then the seller's countersigns.
  - **By e-signature:** an envelope through the T-107 signing path carries `loi_id`, and `app_signing_record` completes the letter instead of the terms.
  - **Expiry:** a letter not countersigned by its answer date expires, applied when the letter is next read or acted on, and audited.
  - **Exclusivity** runs from countersignature and shows its end date and days left.
- **Shared demos:** e-signature sending is refused (`DEMO_NOT_AVAILABLE`); in-app signing works.

## Consequences
- **A new LOI version** follows only a newer agreed terms version, or a letter that was declined or expired. Earlier versions and their PDFs stay on the pact.
- **Not in v1:** financing references (T-117) join the non-binding part when that lands.
- **Rollback:** migration `20261205000000_letters_of_intent` is expand-only. Drop `loi_signoffs`, `loi_versions`, `signature_envelopes.loi_id` and `deals.loi_required`, and restore `app_signing_record` from `20261126000100_signing_audit`.
