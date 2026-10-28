# The failed-deal case library

Famous deal failures, encoded as **synthetic regression cases**. A platform that claims to find what kills deals should be made to find it in the best-documented failures, with the defects planted at realistic strength and the expected findings written down before the first run. (T-092; the checks are T-091's, in `packages/calculations/src/regulatory`.)

## What a case is

Four parts, versioned together in `demo-data/cases/<case-id>/`:

| Part | File(s) | Rule |
|---|---|---|
| **1. Narrative brief** | `README.md` → *The real case* | What happened, from public sources: court rulings, regulator filings, reputable reporting. Every factual sentence is cited. Real company names appear **only here**, as history. Anything still being litigated is stated as an allegation, with the date of its status. |
| **2. Synthetic dataset** | `generate.py` and what it writes (`sites.csv`, `package.json`, `terms.json`, `buyer.json`, `feedback.json`, `commitments.json`, `merger-agreement.md`, …) | Fictional companies, people, places and figures. The real case's failure modes exist in the data at the strength the public record supports: findable by analysis, invisible to skimming. Deterministic: the generator writes the same files every run. |
| **3. Findings key** | `key.json` | The defects the platform **must** surface. Each has its check id, expected phase (`PRE` or `DILIGENCE`), direction and minimum severity. Written **before** the first run, and dated. |
| **4. Regression test** | `packages/calculations/src/regulatory/<case-id>.test.ts` | Loads the dataset, runs the pipeline, and asserts each key item surfaces in its phase with at least its severity. It prints a PASS/MISS line per key item. |

## Authoring a case

1. **Brief first.** Write *The real case* from primary sources. List the failure anatomy: the defects, in the order they became fatal, as the court or regulator found them.
2. **Map defects to checks.** For each defect, name the check that should catch it. If no check exists, the case documents a gap. File it as a product task; never write a check inside the case.
3. **Write the key** (`key.json`) and date it. From now on it changes only through a recalibration (below).
4. **Build the dataset.** Size each defect from the public facts: counts, ratios, timelines. Use a seeded random generator for everything else. Make the dataset look like an ordinary deal: most markets, sites and documents are unremarkable.
5. **Run the test.** A MISS is a product finding against the responsible check or pack. Report it in the PR as a finding. Do not edit the case to make it pass.
6. **Calibrate for realism, not for passing.** If a defect is caught only because it was planted loudly (a wall of red, a gap far beyond the record), rebalance the dataset, never weaken the key. Record every calibration in the case's *Calibration log*.

## Recalibrations

The key changes only through a documented recalibration in the case README. That record states what was wrong, **the case or the platform**, and why. A quarter in which every case passes trivially is a calibration smell. Record it in the library's own log below.

## Using cases elsewhere

- **Demo pacts:** a case also loads as an ordinary demo pact ("run the deal that failed, watch it get caught"), alongside HealthyCo, TroubledCo and SparseCo.
- **Public pages:** each published case has a page under `/case-studies` on the website. It carries the story, the failure anatomy with citations, the defect-by-defect mapping to Pactlab's checks (stated as design intent, never as a claim that Pactlab was involved or would have changed the outcome), and a link to run the case.

## The library

| Case | Real deal | What it tests | Status |
|---|---|---|---|
| `case-01-grocery` | Kroger / Albertsons (2022–2024) | Local-market overlap, remedy package quality (headroom, cherry-pick, coherence, buyer), unanswered regulator feedback, unverifiable pledges, labor exposure | Dataset, key and regression in place |
| *next* | JetBlue / Spirit | Market-definition fights; no viable remedy shape | Candidate |
| *next* | Adobe / Figma | Regulators in different jurisdictions pulling apart (US, EU, UK) | Candidate |
| *next* | Illumina / Grail | Closing over objection, then unwind: the post-close catastrophe | Candidate |

### Library log

- 2026-10-28: library started with Case 1.
