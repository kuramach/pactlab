# ADR 0026: Reports as versioned, immutable exports (T-110)

**Status:** accepted (Kumar, 2026-11-09)

## Context
Kumar wants two reports:
- an executive report across an organization's pacts;
- a detailed record of one pact, in PDF.

Deals move, so a report is a snapshot of a moment. A report is also an export of sensitive deal data.

## Decision
- **Versions:** each generation is a new `report_versions` row, numbered per scope (the organization's executive reports, and each pact's reports). A database trigger makes a version final once READY. The one exception is READY → PURGED, when its pact is deleted; deletion also removes the stored file.
- **Storage:** bytes are stored once, under the version's own key: `<org>/<pact>/reports/<id>.pdf`, or `<org>/<id>/executive-report.pdf`.
- **What a version records:** the time its data was taken and which valuation runs and finding counts it captured. Every PDF page carries the version, the "data as of" time and the organization.
- **Confidentiality:** content comes from the same application services the app uses, called as the generating user, so each organization sees exactly what it may see in the app. A section the caller may not see (403/404) is left out, not filled in from elsewhere. Tests extract the PDF text and assert that a seller-side report has no persona, buyer pricing or confirmed value.
- **Totals:** the executive roll-up is computed only from its per-pact rows, so every total traces to them.
- **Generation:** runs in the API process in the background (GENERATING → READY or FAILED), like Foresight's baseline.
- **Rendering:** `pdf-lib`, with Manrope from `@fontsource/manrope` (OFL) through `@pdf-lib/fontkit` (MIT). A character missing from the font becomes "?", never silently dropped.
- **Audit:** `report.generated` and `report.downloaded`.

## Not in v1
Scheduled or emailed reports, comparing versions, custom templates, and Excel/CSV export.
