# Reports (T-110, ADR 0026)

## For users
- **Where:** **Reports** in the menu, or the **Report** button on a pact.
- **Two kinds:**
  - **Executive report:** every pact you can see, by phase. It shows asking and priced value, open risks and what needs you next, and totals that add up from those rows.
  - **Pact report:** the complete record of one pact (evidence, findings, claims, valuation, terms and post-close), from your side's view only.
- **Versions:** each generation is a new version (v1, v2, …). Earlier versions never change, and every page shows its version and "data as of" time.

## Support
- **Status "Failed":** the generation hit an error, logged as `report generation failed` with the report id. Generating again makes a new version.
- **Deleted pacts:** a pact's report files are deleted with the pact. The history keeps the row, marked "Removed with its pact".
- **Audit:** who generated and who downloaded each version is in the audit log (`report.generated`, `report.downloaded`).
