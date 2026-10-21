# FreshCo test kit (synthetic)

Files for testing Pactlab end to end on a **fresh deal you create yourself**.
Everything here is invented: FreshCo, its customers, banks and contracts.
**Synthetic data only — never put real customer or company data in this folder.**

## What's in it

| File | Edit it? | Becomes |
|---|---|---|
| `subscriptions.csv` | ✅ yes | `generated/stripe-invoice-lines.csv` — one invoice line per customer per month |
| `documents/*.md` | ✅ yes | `generated/*.pdf` (pages split on `---page---`), `*.docx`, `*.txt` |
| `generated/` | ❌ no | rebuilt by `pnpm kit:build` |

After editing, rebuild:

```bash
cd ~/projects/pactlab
pnpm kit:build                      # through September 2026
pnpm kit:build fixtures/test-kit/FreshCo 2026-12   # or another as-of month
```

### `subscriptions.csv` columns

| Column | Meaning |
|---|---|
| `customer_id`, `customer_name` | Keep IDs unique; names end in "(synthetic)". |
| `plan`, `currency` | Any plan name; ISO currency (USD). |
| `monthly_amount` | Monthly fee, e.g. `2400.00` (no commas). |
| `start_month` | First billed month, `YYYY-MM`. |
| `end_month` | Last billed month (blank = still a customer). Ending a customer creates churn. |
| `change_month`, `changed_monthly_amount` | From this month the fee changes — expansion (up) or contraction (down). Both or neither. |

As shipped, at **September 2026**: 10 active customers, MRR USD 59,600,
**ARR USD 715,200**, two churned customers, three expansions and one
contraction. NRR, GRR and concentration follow from the file.

## Walkthrough: a fresh deal

1. **Start a Pact** (left menu):
   - Name: `Project Fresh` · Buyer: your firm, Private · Seller: `FreshCo Software, Inc.`, Private, **Software & SaaS**
   - Asking price: `4,600,000`, Enterprise value, Letter of intent (that's about 6.4× ARR).
2. **Sources → Upload billing export** → system **Pactlab standard template** →
   `generated/stripe-invoice-lines.csv` → Preview → Import.
   **Finances** then shows ARR 715,200 and the movements.
3. **Documents** → upload the files in `generated/` (PDF or Word):
   - `01-master-services-agreement` and `02-reseller-agreement` — data class *Business*.
   - `03-balance-sheet-2026-09-30` and `04-loan-agreement` — data class *Financial*.
   - Ask: "What happens to the customer contract and the loan on an acquisition?"
     Answers should cite page 2 of the MSA and of the loan agreement.
4. **Valuation → Balance sheet** → add items quoting the balance sheet, page 2, word for word:
   - Debt · Term loan · 450,000 · "Term loan with Lakeside Bank, outstanding principal: USD 450,000"
   - Debt · Shareholder loan · 75,000 · "Shareholder loan from the founders: USD 75,000"
   - Debt-like · Deferred revenue · 96,000 · "Deferred revenue on annual subscriptions billed in advance: USD 96,000"
   - Debt-like · Accrued bonuses · 42,000 · "Accrued bonuses for 2026, unpaid: USD 42,000"
   - Debt-like · Earn-out · 60,000 · "Earn-out payable for the 2024 acquisition of Ledgerbird: USD 60,000"
   - Cash · 310,000 · (quote from page 1) "Cash and cash equivalents: USD 310,000"
   Try a wrong figure in a quote (e.g. "USD 999,000") — it is refused.
5. **Valuation → New scenario**: ARR multiple, ARR `715200`, multiple `5.5`;
   tick the balance-sheet items; leave the "entered without evidence" fields at 0. Run it.
   Then see **Is the multiple in range?** and the explanation on the Overview.
6. **Negotiation anchors**: add a comparable on **Comparables** (with a source),
   then cite it against the ask on the deal.

## Not in the kit yet

- **Code (GitHub/Bitbucket) and delivery (Jira):** by design these connect only
  through their APIs, never files. A fresh deal can connect a real repository
  with a read-only token (Sources → GitHub). Synthetic repositories and Jira
  sites for fresh deals arrive with the Engineering task.
