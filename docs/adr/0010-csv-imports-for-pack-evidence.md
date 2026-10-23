# ADR 0010 — CSV imports for industry-pack evidence

- **Status:** Accepted (2026-10-22)
- **Amends:** ADR 0004 (decision 1, "CSV import is for billing only")

## Context

Pack evidence — rent rolls, T-12s, loan tapes, AML alerts, census and payer
mix, STR benchmarks — lives in property-management, banking, hospital and
hotel systems that sellers rarely open to a buyer before signing. The founder
decided every pack starts with file imports and direct connections come
later. ADR 0004 already provides an import pipeline built around a target
definition (`TargetDefinition`), with billing as its only target.

## Decision

1. **A pack may declare CSV import targets** for its extracts. They use the
   same pipeline as billing: upload → malware scan → preview a confirmed
   column mapping → idempotent import through the sync engine → evidence
   with a cited source row. No values are inferred; unreadable rows are
   reported and skipped; money stays a decimal string.
2. **Source control and delivery tools stay API-only**, as ADR 0004 says.
3. **Direct connections to industry systems come later**, as adapters that
   produce the same target records, so pack logic never changes when a
   source moves from file to API.
4. **People data (rule 7).** Each target declares whether it carries no
   people data, aggregates, or pseudonymous references. Preview refuses
   columns that look like names, contact details, identity numbers or
   compensation, other than the target's declared pseudonymous reference.
   Imported pack evidence is never sent to a model.
5. Each non-billing target has one Pactlab standard template, generated from
   its field list and downloadable from Sources; vendor templates come only
   when verified, as for billing.

## Consequences

- One code path for every file import; a new pack adds a target definition,
  not upload code.
- New targets are added as `import_target` enum values in each pack's
  migration (expand-only).
