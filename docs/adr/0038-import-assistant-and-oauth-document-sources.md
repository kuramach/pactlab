# ADR 0038: The mapping assistant, and document sources signed in with OAuth

- **Status:** accepted (2026-11-21, Kumar: "plan and build it now")
- **Deciders:** Kumar
- **Supersedes:** ADR 0016's token-paste detail for LIVE sources (0016's read-only design stands)

## Context
- **Real files aren't in Pactlab's template.** Sellers send rent rolls, P&Ls, T-12s and loan tapes with title rows above the header, months across the columns, subtotals, and their own column names. The importer matched header names only and read the first row as the header, and there was no P&L import at all.
- **LIVE document sources connected with a pasted access token** that dies within an hour (Google, Microsoft), so a source quietly failed until someone pasted another.
- **Deployed environments had no credential store** (T-007 left a local encrypted store only), so any stored token failed closed on live.

## Decision

### 1. The mapping assistant (`import.map@1`, job type `extraction`)
- **For every import target in every pack:** when an upload's required fields don't all match by name, the model is shown the sheet's first 30 rows as cells and the target's fields.
- **It proposes:** the header row, the layout, the column for each field (with a reason and one cell copied as evidence), what each P&L line is, and questions.
- **`checkProposal` (domain, deterministic) never trusts it as given:**
  - a column, label or month column the file doesn't have is dropped;
  - a name match wins over the model;
  - each column feeds one field;
  - below 0.85 confidence, or with evidence not in the file, the field is left empty and becomes a question.
- **A person confirms every field;** import is refused until required fields are set, and the screen holds Import until the questions are answered.
- **The model never supplies a value** (rule 3). `applyMapping` reads every value from the cells.
- **People data (rule 7):** a file with people columns is refused before the model is called. A document kept from AI keeps its upload from the assistant too (matched by its bytes).
- **Recording runs:** runs are recorded through `app_import_record_run`, because sellers upload too and `ai_runs` is buyer-side under RLS.
- **Without the assistant** (off, failed, or not needed), names are matched, months across are read from the header, and the screen says so.

### 2. Real-world sheets (deterministic)
- **Header row:** `readTable` takes it, or detects it below title rows. Blank header cells are named by letter, repeats get " (2)", ragged rows are padded.
- **Layouts:**
  - `PERIOD_COLUMNS`: lines down, months across (a P&L), unpivoted to one record per line per month;
  - `MONTHS_ACROSS`: measures down, months across (a T-12, hotel history), transposed.
- **Mapping data:** the layout, line kinds and gap acceptance are part of the mapping, so part of its idempotency key.

### 3. The P&L import, `FINANCIAL_PNL` (core: every pact)
- **Records:** account × month × amount, with a line kind (revenue, COGS, opex, other income or expense). Evidence type `finance.pnl_line`.
- **Subtotals aren't imported; they're checked:** total revenue, gross profit, operating income and net income must equal their lines (either sign convention, within one unit). A gap blocks the import until the line kinds are fixed or a person accepts it.
- **Checklist:** an imported P&L ticks the Income statement item.
- **Not yet:** QoE and valuation don't read `finance.pnl_line` yet (T-148).

### 4. Document sources signed in through the organization (T-147, without Box)
- **One sign-in per provider per organization,** in `organization_connections` (beside DocuSign): Google Drive or OneDrive / SharePoint, made by an owner or admin with OAuth 2.0 authorization code and a signed, expiring state.
- **Scopes:**
  - Google: `drive.readonly`, `access_type=offline`;
  - Microsoft: `Files.Read.All offline_access User.Read`.
  - `Files.Read.All` (delegated) rather than `Files.Read`, because sellers share deal folders from SharePoint. It's still read-only and limited to what the signed-in person can open.
  - A contract test pins the scope set.
- **Refresh tokens live only in the credential store.** Access tokens refresh at sync time, a minute early. Microsoft's replacement refresh token is kept, and a concurrent refresh that lost the race uses the winner's tokens.
- **A revoked sign-in** is `SOURCE_ACCESS` (reconnect), never a retry loop.
- **Disconnect** destroys the credential.
- **Sources follow the organization's current sign-in for their provider,** so a reconnect carries every pact's sources over, including deals the admin isn't on.
- **Pasted-token sources keep working until their token dies.** The web form no longer offers a token.

### 5. The deployed credential store
- **Store:** `SecretsManagerSecretStore`, one secret per reference under `pactlab/<env>/credentials/`, encrypted with the environment's data key.
- **IAM:** the API's role may create, put, get and delete only under that prefix.
- **Client registrations:** Pactlab's OAuth clients are four Secrets Manager values, created `unset`, set by `scripts/doc-source-key.sh`.

## Consequences
- **Messy spreadsheets import** with a proposal and questions instead of a blank form; nothing is imported on the model's word.
- **Drive and OneDrive folders stay connected** without anyone pasting tokens.
- **Other stored credentials now work deployed:** DocuSign, and GitHub and Jira tokens, use the same store.
- **Prerequisites for live use:**
  - a Google Cloud OAuth client and a Microsoft Entra app registration (runbook `document-sources.md`);
  - the next deploy creates the secrets and the API's grants (no separate access step).
- **Box** remains in T-147.
