# ADR 0042: Deterministic imports for every pact, and saved import formats

- **Status:** Accepted, 2026-11-25 (Kumar: *"This shd be the logic for all the pacts moving forward"*)
- **Builds on:** ADR 0010 (pack imports), ADR 0038 (import assistant), ADR 0039 (withdraw and re-import)

## Context

Files arrive in whatever shape the seller's system exports:
- title rows above the header;
- months or years across the columns;
- subtotals between lines;
- a different word for every field.

The import assistant (ADR 0038) reads that shape, and a person confirms it. That much works. Three gaps remained:

1. **A confirmed format was forgotten.** The next file from the same seller, laid out the same way, went through the AI and the person again. Only "import again" (ADR 0039) reused an earlier mapping.
2. **Most packs turn imports into no metrics.** Only Software & SaaS, Multifamily and Music rights have a metric calculator.
3. **An imported P&L feeds neither quality of earnings nor valuation yet** (T-149).

## Decision

### The rule for every pact, now and for every new pack

1. **The AI proposes the structure only:**
   - the header row;
   - the layout (rows, or months or years across);
   - which column feeds each field;
   - what each statement line is.

   Pactlab checks every proposal against the file, and a person confirms it. The AI never supplies a value.
2. **Code reads every value from the cells.** The same file with the same confirmed mapping gives the same records, and importing twice changes nothing.
3. **A confirmed format is saved and reused with no AI.** The next file with the same layout is read the same way, deterministically. Only what changed goes back to a person, and to the AI.
4. **Every import target feeds a versioned metric calculator** for its pack. Each figure carries its formula and the count of records it rests on. A missing figure names the import it needs, so it can be asked of the seller (#279).
   - A pack without a calculator is incomplete. The calculators for the remaining packs are tasks, one per pack.
5. **Metrics, prices and valuations come only from those calculators,** never from model text (CLAUDE.md rules 2 and 3).

### Saved formats (this change)

- **Table:** `import_formats`, one row per pact, per import target and per layout signature. Each row records:
  - the confirmed mapping: fields, amount unit, date format and line kinds;
  - the header row;
  - the upload it was confirmed on, and who confirmed it;
  - how often it has been used.
- **The signature** is a hash of:
  - the import target;
  - the layout kind;
  - the period granularity (months or years);
  - the header cells that are not periods, trimmed and lower-cased.

  Period columns are left out, so next month's file with new month columns still matches.
- **Reading a new upload** (before any AI call):
  1. For each saved format of the pact's target, the file is read at that format's header row.
  2. Its signature is compared.
  3. On a match, the format's mapping is applied:
     - periods are re-read from the new header;
     - line kinds are carried over by line name;
     - a line the format has never seen is left for the person (the "lines to look at" list);
     - the mapping is checked against the file with the same `blockingProblems` as any other.
  4. If those checks pass, the upload says "Read the same way as *file* on *date*. Nothing was sent to AI." with a **Read it fresh** control. Otherwise it falls through to the assistant.
- **Saving:** every successful import upserts the format from the mapping the person confirmed. A corrected mapping, imported, replaces the saved one.
- **Scope is the pact,** not the organization: a seller's layout and line names stay within the pact they were shared in.
  - Visibility follows the upload. A buyer-only import's format is seen by the buyer side only (the same RLS as `source_uploads`).
  - An organization-wide library of standard formats (e.g. a property-management system's rent-roll export) is a later decision.
- **Audit:** `import_format.saved` and `import_format.applied` events in the pact's chain.

## Consequences

- Repeat files import faster, cost nothing in AI, and are read identically every time.
- Changed files still get the AI and a person.
- **A wrong confirmation propagates to later files until corrected.** Mitigations:
  - the note names the file it came from;
  - **Read it fresh** bypasses the format;
  - importing a corrected mapping replaces the format.
- **Rollback:** drop `import_formats` (expand only). Uploads keep their own mappings, so nothing is lost.
- **Follow-up tasks:**
  - a metric calculator for each pack without one: fintech, healthcare, telecom, services, pharma, e-commerce, commercial property, hotels, hospitals, clinics, venture;
  - T-149 (P&L into quality of earnings and valuation);
  - an organization-wide format library.
