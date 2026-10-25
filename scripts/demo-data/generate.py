#!/usr/bin/env python3
"""Generate the Pactlab synthetic demo data set: <pack>/<CURRENCY>/files.

Everything is invented. Deterministic: same output every run.
Usage: python3 scripts/demo-data/generate.py <out_dir>   (or scripts/demo-data/build.sh, which also builds the PDFs)
Writes per dataset: README.md, invoice-lines.csv, <extract>.csv,
vdr-index.csv, documents/*.md (PDFs are built afterwards by kit:build).
"""
import csv, io, os, random, sys
from decimal import Decimal, ROUND_HALF_UP

OUT = sys.argv[1]
AS_OF = '2026-09'
MONTHS = []
y, m = 2024, 10
while (y, m) <= (2026, 9):
    MONTHS.append(f'{y}-{m:02d}'); m += 1
    if m == 13: y, m = y + 1, 1
LAST = MONTHS[-1]
LAST12 = MONTHS[-12:]
D = Decimal
CENT = D('0.01')

def q(x): return D(x).quantize(CENT, ROUND_HALF_UP)
def whole(x): return D(x).quantize(D('1'), ROUND_HALF_UP)
def nextm(mo):
    yy, mm = map(int, mo.split('-'))
    return f'{yy + 1}-01' if mm == 12 else f'{yy}-{mm + 1:02d}'

CUR = {
    'USD': dict(scale=D('1'), country='United States', suffix='Inc.', city='Columbus, Ohio', bank='Lakeshore Commercial Bank', auditor='Ridgeway & Moss LLP', sym='USD'),
    'EUR': dict(scale=D('0.92'), country='the Netherlands', suffix='B.V.', city='Utrecht', bank='Grachtenbank N.V.', auditor='Van Dijk Accountants', sym='EUR'),
    'GBP': dict(scale=D('0.79'), country='the United Kingdom', suffix='Ltd', city='Leeds', bank='Aire Valley Bank plc', auditor='Calder Whitby LLP', sym='GBP'),
}

def money(cur, x, decimals=False):
    v = q(x) if decimals else whole(x)
    s = f'{v:,.2f}' if decimals else f'{v:,.0f}'
    return f'{cur} {s}'

def pct(x): return f'{(D(x) * 100).quantize(D("0.1"), ROUND_HALF_UP)}%'

class Dataset:
    def __init__(self, pack, cur, brand, kind):
        self.pack, self.cur, self.c = pack, cur, CUR[cur]
        self.company = f'{brand} {self.c["suffix"]}'
        self.brand, self.kind = brand, kind
        self.rng = random.Random(f'{pack}:{cur}')
        self.customers = []   # (id, name, {month: Decimal})
        self.extracts = {}    # name -> (header, rows, description)
        self.docs = {}        # name -> (markdown, description, data_class)
        self.findings = []    # (title, where to look)
        self.notes = []
        self.summary = ''
        self.prefix = ''.join(w[0] for w in pack.split('-'))[:3]

    def amt(self, usd):
        return q(D(usd) * self.c['scale'])

    def customer(self, cid, name, monthly):
        self.customers.append((cid, name, {k: q(v) for k, v in monthly.items() if v and q(v) > 0}))

    def billed_arr(self, month=LAST):
        return sum((mo.get(month, D(0)) for _, _, mo in self.customers), D(0)) * 12

    def share_top(self, month=LAST):
        vals = sorted(((mo.get(month, D(0)), n) for _, n, mo in self.customers), reverse=True)
        total = sum(v for v, _ in vals)
        return vals[0][1], vals[0][0] / total

    def ext(self, name, header, rows, description):
        self.extracts[name] = (header, rows, description)

    def doc(self, name, text, description, data_class='Business'):
        self.docs[name] = (text.strip() + '\n', description, data_class)

    def write(self):
        d = os.path.join(OUT, self.pack, self.cur)
        os.makedirs(os.path.join(d, 'documents'), exist_ok=True)
        cols = ['line_id', 'invoice_id', 'customer_id', 'customer_name', 'subscription_id', 'price_id', 'currency', 'amount', 'interval',
                'interval_count', 'period_start', 'period_end', 'invoice_status', 'created']
        buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n'); w.writerow(cols)
        seq = 0
        for month in MONTHS:
            for cid, name, mo in self.customers:
                if month not in mo: continue
                seq += 1
                w.writerow([f'il_{self.prefix}_{seq:05d}', f'in_{self.prefix}_{month.replace("-", "")}_{cid[-4:]}', cid, name, f'sub_{cid}',
                            f'price_{self.prefix}_{self.kind}_m', self.cur, f'{mo[month]:.2f}', 'month', '1', f'{month}-01', f'{nextm(month)}-01', 'paid', f'{month}-01'])
        open(os.path.join(d, 'invoice-lines.csv'), 'w').write(buf.getvalue())
        self.line_count = seq
        for name, (header, rows, _) in self.extracts.items():
            b = io.StringIO(); ww = csv.writer(b, lineterminator='\n'); ww.writerow(header); ww.writerows(rows)
            open(os.path.join(d, f'{name}.csv'), 'w').write(b.getvalue())
        # One citable PDF of the extracts, for Documents upload.
        if self.extracts:
            pages = [f'{self.company} — data-room extracts (synthetic demo data)\n\nEach page reproduces one structured extract from this folder. All names and figures are fictional.']
            for name, (header, rows, desc) in self.extracts.items():
                lines = [f'{name}.csv — {desc}', '', ' | '.join(header)]
                for r in rows[:60]:
                    lines.append(' | '.join(str(x) for x in r))
                if len(rows) > 60: lines.append(f'… {len(rows) - 60} more rows in {name}.csv')
                pages.append('\n'.join(lines))
            self.doc('99-data-room-extracts', '\n---page---\n'.join(pages), 'The extracts above as one paged document, so findings can cite a page', 'Financial')
        for name, (text, _, _) in self.docs.items():
            open(os.path.join(d, 'documents', f'{name}.md'), 'w').write(text)
        # VDR index
        b = io.StringIO(); ww = csv.writer(b, lineterminator='\n')
        ww.writerow(['doc_id', 'title', 'file', 'data_class', 'as_of'])
        ww.writerow([f'{self.prefix.upper()}-001', 'Invoice lines, Oct 2024 – Sep 2026', 'invoice-lines.csv', 'Financial', '2026-09-30'])
        i = 1
        for name, (_, _, desc) in self.extracts.items():
            i += 1; ww.writerow([f'{self.prefix.upper()}-{i:03d}', desc, f'{name}.csv', 'Financial', '2026-09-30'])
        for name, (_, desc, dc) in self.docs.items():
            i += 1; ww.writerow([f'{self.prefix.upper()}-{i:03d}', desc, f'documents/{name}.pdf', dc, '2026-09-30'])
        open(os.path.join(d, 'vdr-index.csv'), 'w').write(b.getvalue())
        open(os.path.join(d, 'README.md'), 'w').write(self.readme())

    def readme(self):
        c = self.cur
        out = [f'# {self.company} — {PACK_TITLES[self.pack]} ({c})', '',
               f'**Fictional target.** {self.summary}', f'Based in {self.c["city"]}, {self.c["country"]}; reports in {c}. Data runs October 2024 to September 2026.', '',
               '> Synthetic demo data. Every company, person, address, account and figure here is invented.', '',
               '## Files', '', '| File | What it is | Load it in Pactlab |', '|---|---|---|',
               f'| `invoice-lines.csv` | {self.line_count} revenue lines, one per {self.kind_label} per month | Sources → Upload billing export → **Pactlab standard template** |']
        imports = PACK_IMPORTS.get(self.pack, {})
        for name, (_, _, desc) in self.extracts.items():
            if name in imports:
                out.append(f'| `{name}.csv` | {desc} | Sources → Industry data → **Upload {imports[name].lower()}** |')
            else:
                out.append(f'| `{name}.csv` | {desc} | Documents → upload `documents/99-data-room-extracts.pdf` (this table is on its own page) |')
        for name, (_, desc, dc) in self.docs.items():
            if name == '99-data-room-extracts': continue
            out.append(f'| `documents/{name}.pdf` (`.md` source) | {desc} | Documents → upload, data class *{dc}* |')
        out.append('| `vdr-index.csv` | Index of every file, as a data room would list it | Reference |')
        out += ['', '## Demo walkthrough', '',
                f'1. **Start a Pact** for `{self.company}` with base currency **{c}**, industry *{PACK_TITLES[self.pack]}*.',
                '2. **Sources → Upload billing export** → Pactlab standard template → `invoice-lines.csv` → Preview → Import. **Finances** shows the revenue ledger.',
                *([f'3. **Sources → Industry data** → upload each extract marked above ({", ".join(f"`{n}.csv`" for n in PACK_IMPORTS[self.pack])}); industry checks run on import.'] if self.pack in PACK_IMPORTS else []),
                f'{4 if self.pack in PACK_IMPORTS else 3}. **Documents** → upload every PDF in `documents/` with the data class shown above.',
                f'{5 if self.pack in PACK_IMPORTS else 4}. Look for the planted findings below (Findings → Run checks once the documents are in); accept, reject or ask for support, then price the accepted ones in **Valuation**.', '',
                '## Planted findings', '']
        for i, (title, where) in enumerate(self.findings, 1):
            out.append(f'{i}. **{title}** — {where}')
        if self.notes:
            out += ['', '## Notes', ''] + [f'- {n}' for n in self.notes]
        return '\n'.join(out) + '\n'

# Extracts a built pack imports directly (Sources → Industry data), by file
# name, with the target's label as Pactlab shows it. Kept in step with the
# pack registry by apps/api/src/ops/demo-data.test.ts.
PACK_IMPORTS = {
    'fintech': {'loan-tape': 'Loan tape', 'aml-alerts': 'AML alerts'},
    'multifamily': {'rent-roll': 'Rent roll', 't12': 'T-12 operating statement', 'delinquency': 'Delinquency report', 'unit-inspections': 'Unit inspections'},
    'healthcare': {'claims-summary': 'Claims summary', 'provider-roster': 'Provider roster'},
    'telecom-media': {'subscribers-by-month': 'Subscribers by month'},
}

PACK_TITLES = {
    'software-saas': 'Software and SaaS', 'fintech': 'Fintech', 'healthcare': 'Healthcare services and healthtech',
    'telecom-media': 'Telecom and media', 'professional-services': 'IT and professional services', 'pharma-biotech': 'Pharma and biotech',
    'ecommerce-dtc': 'E-commerce and DTC', 'multifamily': 'Multifamily', 'commercial-property': 'Commercial property',
    'hotels': 'Hotels and hospitality', 'small-clinics': 'Small clinics', 'hospitals': 'Hospitals',
}

def ramp(rng, base, growth, months=MONTHS, start=None, end=None, noise=D('0')):
    out = {}
    v = D(base)
    for mo in months:
        if (start and mo < start) or (end and mo > end): continue
        jitter = D(1) + (D(rng.randint(-100, 100)) / 100) * noise
        out[mo] = v * jitter
        v = v * (D(1) + D(growth))
    return out

def flat(amount, start=MONTHS[0], end=None, change=None, changed=None):
    out = {}
    for mo in MONTHS:
        if mo < start or (end and mo > end): continue
        out[mo] = D(changed) if change and mo >= change else D(amount)
    return out

def sign_block(ds, signer_a, signer_b):
    return f'Signed for {ds.company}: {signer_a}\nSigned for the counterparty: {signer_b}'

# ---------------------------------------------------------------- packs
def software(ds):
    ds.kind, ds.kind_label = 'subscription', 'customer subscription'
    ds.summary = f'{ds.company} sells workflow software to mid-sized logistics and services firms on monthly and annual subscriptions.'
    names = ['Harborline Freight', 'Cobalt Ridge Dental', 'Northgate Logistics', 'Quarry Lane Studios', 'Pinecrest Clinics', 'Ironbridge Engineering',
             'Saltmarsh Foods', 'Copperfield Legal', 'Westbrook Schools', 'Amberline Hotels', 'Tidewater Marine', 'Foxglove Retail', 'Granite Peak Energy', 'Silverleaf Insurance']
    plans = [14500, 2400, 6800, 650, 1900, 3100, 1200, 4200, 2600, 980, 3600, 1500, 5200, 2200]
    for i, (n, p) in enumerate(zip(names, plans)):
        cid = f'{ds.prefix}-cus-{i + 1:04d}'
        start = MONTHS[i % 6]
        end = '2026-06' if i == 3 else None              # churned before as-of
        change, changed = (('2025-10', p * 1.2) if i in (2, 6, 12) else ('2026-04', p * 0.7) if i == 9 else (None, None))
        ds.customer(cid, f'{n} (synthetic)', flat(ds.amt(p), start, end, change, changed and ds.amt(changed)))
    arr = ds.billed_arr()
    churned = ds.amt(650) * 12
    deck = whole(arr + churned + ds.amt(18000))
    top, share = ds.share_top()
    c = ds.cur
    ds.doc('01-board-kpi-pack-2026-09', f'''
{ds.company} — board KPI pack, September 2026 (synthetic demo data)

Annual recurring revenue (ARR) at 30 September 2026: {money(c, deck)}
Logo count: 14 active customers
Net revenue retention, trailing twelve months: 118%
---page---
ARR bridge (management view)
Opening ARR, 1 October 2025, and growth from expansion and new logos are shown in the appendix.
ARR includes contracted renewals for customers in notice periods.
''', 'Management KPI pack with reported ARR')
    ds.doc('02-master-services-agreement-northgate', f'''
Master services agreement between {ds.company} and Northgate Logistics (synthetic)

1. Term. Twelve months, renewing automatically for further twelve-month terms.
---page---
14. Change of control. Customer may terminate this agreement on thirty days' written notice if the Supplier undergoes a change of control.
{sign_block(ds, 'Dana Whitlow, CEO', 'Morgan Ashby, COO')}
''', 'Largest customer contract, with change-of-control clause')
    ds.doc('03-balance-sheet-2026-09-30', f'''
{ds.company} — balance sheet at 30 September 2026 (synthetic, unaudited)

Cash and cash equivalents: {money(c, ds.amt(310000))}
Trade receivables: {money(c, ds.amt(118000))}
---page---
Term loan with {ds.c["bank"]}, outstanding principal: {money(c, ds.amt(450000))}
Deferred revenue on annual subscriptions billed in advance: {money(c, ds.amt(96000))}
''', 'Balance sheet with debt and debt-like items', 'Financial')
    ds.findings = [
        (f'Management ARR exceeds billed ARR', f'the KPI pack reports {money(c, deck)}; `invoice-lines.csv` supports {money(c, arr)} at September 2026 — a gap of {money(c, deck - arr)}. The KPI pack still counts Quarry Lane Studios, whose last invoice was June 2026.'),
        (f'Revenue concentration', f'{top} is {pct(share)} of September 2026 billed revenue.'),
        ('Largest customer can leave on a sale', '`documents/02-master-services-agreement-northgate.pdf` page 2, clause 14 — termination on change of control.'),
        ('Contraction hidden in the logo count', 'Amberline Hotels drops by 30% from April 2026; the KPI pack reports 14 active customers, the ledger has 13.'),
    ]
    ds.notes = ['Code and delivery data (GitHub, Jira) connect through their APIs, not files: in a local or dev Pactlab, use **Sources → Connect synthetic code and Jira data**.']

def fintech(ds):
    ds.kind, ds.kind_label = 'platform_fee', 'merchant platform fee'
    ds.summary = f'{ds.company} runs a payments and working-capital platform for independent retailers, earning monthly platform fees and lending to merchants through a partner bank.'
    rng = ds.rng
    for i in range(16):
        base = ds.amt(rng.choice([900, 1400, 2100, 3200, 4800, 7500]))
        ds.customer(f'{ds.prefix}-mer-{i + 1:04d}', f'{["Juniper", "Marlow", "Oakhurst", "Bramble", "Larkspur", "Thistle", "Rowan", "Hazel", "Wren", "Ember", "Clover", "Sorrel", "Briar", "Tansy", "Fennel", "Aster"][i]} Goods (synthetic)', flat(base, MONTHS[i % 8]))
    loans, chargeoffs, bal_total = [], D(0), D(0)
    for i in range(120):
        p = ds.amt(rng.choice([5000, 8000, 12000, 20000, 30000]))
        orig = MONTHS[rng.randint(0, 20)]
        dpd = rng.choices([0, 0, 0, 0, 15, 35, 65, 95], k=1)[0]
        status = 'charged_off' if dpd >= 95 else 'current' if dpd == 0 else 'delinquent'
        bal = D(0) if status == 'charged_off' else q(p * D(rng.randint(20, 90)) / 100)
        if status == 'charged_off': chargeoffs += p
        bal_total += bal
        loans.append([f'LN-{i + 1:05d}', f'{orig}-15', f'{p:.2f}', f'{bal:.2f}', ds.cur, dpd, status])
    ds.ext('loan-tape', ['loan_id', 'originated', 'principal', 'balance', 'currency', 'days_past_due', 'status'], loans, 'Loan-level tape for merchant working-capital loans')
    alerts, unreviewed = [], 0
    for i in range(80):
        ev = 'yes' if i % 10 not in (1, 4, 7) else 'no'
        unreviewed += ev == 'no'
        alerts.append([f'AL-{i + 1:05d}', f'{MONTHS[12 + i % 12]}-{(i % 27) + 1:02d}', rng.choice(['velocity', 'structuring', 'high_risk_geo', 'name_match']), 'closed', ev])
    ds.ext('aml-alerts', ['alert_id', 'raised', 'rule', 'status', 'review_evidence'], alerts, 'Transaction-monitoring alerts and whether review evidence exists')
    allowance = q(bal_total * D('0.02'))
    loss_rate = chargeoffs / sum(D(r[2]) for r in loans)
    c = ds.cur
    ds.doc('01-balance-sheet-2026-09-30', f'''
{ds.company} — balance sheet extract at 30 September 2026 (synthetic, unaudited)

Merchant loans receivable, gross: {money(c, bal_total)}
Allowance for credit losses: {money(c, allowance)} (2.0% of gross loans)
''', 'Balance sheet extract with the credit-loss allowance', 'Financial')
    ds.doc('02-aml-procedure', f'''
{ds.company} — transaction-monitoring procedure (synthetic)

Every alert must be reviewed by a compliance analyst before closure. The analyst records the evidence reviewed and the rationale in the case file.
''', 'Written AML alert-handling procedure')
    ds.doc('03-partner-bank-agreement', f'''
Program agreement between {ds.c["bank"]} (synthetic) and {ds.company}
---page---
22.3 The Bank may terminate this agreement on ninety days' notice if the Program Manager undergoes a change of control without the Bank's prior written consent.
''', 'Partner-bank program agreement')
    ds.findings = [
        ('Allowance below observed loss experience', f'the balance sheet carries a 2.0% allowance ({money(c, allowance)}); `loan-tape.csv` shows charge-offs of {pct(loss_rate)} of originated principal.'),
        ('Alerts closed without review evidence', f'{unreviewed} of 80 closed alerts in `aml-alerts.csv` have `review_evidence = no`, against the procedure in `documents/02-aml-procedure.pdf`.'),
        ('Partner bank can terminate on change of control', '`documents/03-partner-bank-agreement.pdf` page 2, clause 22.3 — consent needed before closing.'),
    ]

def healthcare(ds):
    ds.kind, ds.kind_label = 'reimbursement', 'payer remittance'
    ds.summary = f'{ds.company} operates nine physical-therapy and primary-care practices, paid mostly by government programmes and commercial insurers.'
    payers = [('Government programme A', 52000), ('Government programme B', 21000), ('Commercial plan North', 17000), ('Commercial plan Central', 12000), ('Commercial plan Coast', 8000), ('Self-pay and other', 5000)]
    for i, (n, base) in enumerate(payers):
        ds.customer(f'{ds.prefix}-pay-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.006', noise=D('0.03')))
    gov = sum(mo[LAST] for _, n, mo in ds.customers if n.startswith('Government')) / (ds.billed_arr() / 12)
    rows = []
    for mo in LAST12:
        for _, n, m2 in ds.customers:
            paid = m2[mo]; billed = q(paid * D('1.38')); denied = ds.rng.randint(2, 9)
            rows.append([mo, n, ds.rng.randint(300, 2400), f'{billed:.2f}', f'{paid:.2f}', denied])
    ds.ext('claims-summary', ['month', 'payer', 'claims', 'billed', 'paid', 'denial_rate_pct'], rows, 'Monthly claims billed, paid and denial rate by payer')
    roster = [[f'PR-{i + 1:02d}', ['Physical therapy', 'Primary care', 'Occupational therapy'][i % 3], '1.0' if i % 4 else '0.6', f'2026-{(i % 9) + 10 if (i % 9) + 10 <= 12 else 12}-15' if i in (3, 11) else f'2027-{(i % 12) + 1:02d}-01'] for i in range(18)]
    ds.ext('provider-roster', ['provider_ref', 'specialty', 'fte', 'credential_expiry'], roster, 'Provider roster, pseudonymous, with credential expiry dates')
    c = ds.cur
    ds.doc('01-medical-director-agreement', f'''
Medical director agreement — {ds.company} (synthetic)

Duties: four hours per month of protocol review and quality oversight.
Fee: {money(c, ds.amt(9500))} per month, fixed.
---page---
Time records for the last twelve months show an average of 1.5 hours per month of documented activity.
''', 'Medical-director agreement and time records')
    ds.doc('02-privacy-risk-assessment', f'''
{ds.company} — HIPAA security risk assessment (synthetic)

Assessment date: 14 March 2023. Next review due: March 2024.
Systems in scope: practice management, billing clearinghouse, patient portal.
''', 'Most recent privacy and security risk assessment')
    ds.findings = [
        ('Revenue concentrated in government programmes', f'government programmes A and B are {pct(gov)} of September 2026 revenue in `invoice-lines.csv`.'),
        ('Medical-director fee above documented duties', '`documents/01-medical-director-agreement.pdf` — a fixed fee for four hours a month, against 1.5 documented hours (page 2).'),
        ('Privacy risk assessment out of date', '`documents/02-privacy-risk-assessment.pdf` — last assessed March 2023, review overdue since March 2024.'),
        ('Provider credentials expiring', 'two providers in `provider-roster.csv` have credentials expiring before the end of 2026.'),
    ]
    ds.notes = ['Provider data is pseudonymous and aggregate by design; Pactlab never sends people data to a model.']

def telecom(ds):
    ds.kind, ds.kind_label = 'subscriber_plan', 'region-and-plan subscriber billing'
    ds.summary = f'{ds.company} is a regional fibre broadband and streaming-TV provider selling residential and small-business plans in four regions.'
    regions = [('North', 5200), ('Central', 3100), ('Lakes', 1900), ('Valley', 1450)]
    plans = [('Fibre 500', 42), ('Fibre 1000', 58), ('Fibre + TV', 79)]
    subs_rows, billed_last = [], 0
    for r, (reg, n0) in enumerate(regions):
        for p, (plan, arpu) in enumerate(plans):
            cid = f'{ds.prefix}-{reg[:3].lower()}-{p + 1}'
            monthly = {}
            n = D(n0) * D([0.5, 0.3, 0.2][p])
            for i, mo in enumerate(MONTHS):
                churn = D('0.009') if mo < '2026-01' else D('0.017')
                n = n * (D(1) + D('0.012') - churn)
                subs = int(n)
                monthly[mo] = ds.amt(arpu) * subs
                if mo in LAST12: subs_rows.append([mo, reg, plan, subs, f'{ds.amt(arpu):.2f}'])
                if mo == LAST: billed_last += subs
            ds.customer(cid, f'{reg} region — {plan} subscribers (synthetic)', monthly)
    ds.ext('subscribers-by-month', ['month', 'region', 'plan', 'billed_subscribers', 'arpu'], subs_rows, 'Billed subscribers and ARPU by region and plan')
    reported = int(billed_last * 1.064)
    top, share = ds.share_top()
    north = sum(mo[LAST] for _, n, mo in ds.customers if n.startswith('North')) / (ds.billed_arr() / 12)
    c = ds.cur
    ds.doc('01-kpi-pack-2026-09', f'''
{ds.company} — investor KPI pack, September 2026 (synthetic)

Subscribers at 30 September 2026: {reported:,}
Monthly churn: 0.9% (trailing twelve months, blended)
''', 'Management KPI pack with reported subscribers and churn')
    ds.doc('02-wholesale-network-agreement', f'''
Wholesale network access agreement — {ds.company} and Valleyline Networks (synthetic)
---page---
9. Pricing review. Wholesale access charges are re-priced every 24 months; the next review is 1 January 2027.
''', 'Wholesale network access agreement')
    ds.findings = [
        ('Reported subscribers exceed billed subscribers', f'the KPI pack reports {reported:,}; `subscribers-by-month.csv` bills {billed_last:,} in September 2026.'),
        ('Churn rising in 2026', 'billed subscribers grow about 0.3% a month until December 2025, then shrink about 0.5% a month from January 2026 (`invoice-lines.csv`, `subscribers-by-month.csv`); the KPI pack still reports 0.9% churn.'),
        ('Regional concentration', f'the North region is {pct(north)} of September 2026 revenue.'),
        ('Wholesale price review ahead', '`documents/02-wholesale-network-agreement.pdf` page 2, clause 9 — next re-pricing 1 January 2027.'),
    ]

def services(ds):
    ds.kind, ds.kind_label = 'retainer', 'client retainer'
    ds.summary = f'{ds.company} is a 140-person digital and data consultancy working on monthly retainers for enterprise clients.'
    clients = [('Meridian Retail Group', 118000), ('Halcyon Mutual', 52000), ('Brookfield Transit', 38000), ('Kestrel Pharma Services', 31000), ('Oakmont Utilities', 26000),
               ('Lumen Education Trust', 18000), ('Seabright Leisure', 14000), ('Carraway Foods', 11000)]
    for i, (n, base) in enumerate(clients):
        ds.customer(f'{ds.prefix}-cli-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.004', noise=D('0.04')))
    rows = []
    for mo in LAST12:
        for team, hc in (('Engineering', 62), ('Data', 34), ('Design', 22)):
            avail = hc * 140; billable = int(avail * (0.62 + ds.rng.randint(0, 5) / 100))
            rows.append([mo, team, hc, avail, billable])
    util = D(sum(r[4] for r in rows)) / D(sum(r[3] for r in rows))
    ds.ext('timesheets-summary', ['month', 'team', 'headcount', 'available_hours', 'billable_hours'], rows, 'Available and billable hours by team (aggregate)')
    hm = []
    for i, mo in enumerate(LAST12):
        hm.append([mo, 'Delivery', 2 + i % 2, 1 + (i // 3), 118 + i % 3])
        hm.append([mo, 'Support functions', 1, 0 + (i % 2), 22])
    ds.ext('headcount-movements', ['month', 'role_family', 'starters', 'leavers', 'headcount'], hm, 'Starters, leavers and headcount by role family (aggregate)')
    top, share = ds.share_top()
    c = ds.cur
    ds.doc('01-management-pack-2026-09', f'''
{ds.company} — management pack, September 2026 (synthetic)

Billable utilization, trailing twelve months: 78%
Voluntary attrition: stable
''', 'Management pack with reported utilization')
    ds.doc('02-msa-meridian', f'''
Master services agreement — {ds.company} and Meridian Retail Group (synthetic)
---page---
18.2 Termination for convenience. The Client may terminate this agreement, or any statement of work, for convenience on sixty days' written notice.
''', 'Master services agreement with the largest client')
    ds.findings = [
        ('Utilization below the reported level', f'the management pack reports 78%; `timesheets-summary.csv` gives {pct(util)} over the last twelve months.'),
        ('Largest client terminable for convenience', f'{top} is {pct(share)} of September 2026 revenue and can terminate on sixty days\' notice (`documents/02-msa-meridian.pdf` page 2, clause 18.2).'),
        ('Rising attrition in delivery roles', 'monthly delivery leavers rise from 1 to 4 across the year in `headcount-movements.csv`.'),
    ]
    ds.notes = ['People data is aggregate only — no names, no individual records.']

def pharma(ds):
    ds.kind, ds.kind_label = 'royalty', 'partner royalty and supply payment'
    ds.summary = f'{ds.company} is a specialty-pharma company earning royalties and supply revenue on two marketed products, with one late-stage programme.'
    partners = [('Aldermoor Therapeutics — royalties on Product A', 410000), ('Aldermoor Therapeutics — supply of Product A', 160000), ('Kingsway Health — royalties on Product B', 95000), ('Tessaly Pharma — licence fee', 40000)]
    for i, (n, base) in enumerate(partners):
        ds.customer(f'{ds.prefix}-par-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.005', noise=D('0.05')))
    ds.ext('patent-schedule', ['family', 'product', 'jurisdiction', 'type', 'expiry'], [
        ['PF-01', 'Product A', 'US', 'composition of matter', '2028-03-31'], ['PF-01', 'Product A', 'EP', 'composition of matter', '2028-06-30'],
        ['PF-02', 'Product A', 'US', 'formulation', '2033-11-30'], ['PF-03', 'Product B', 'US', 'method of use', '2031-08-31']], 'Patent families, products and expiry dates')
    ds.ext('pipeline', ['programme', 'indication', 'phase', 'next_milestone', 'expected'], [
        ['PX-210', 'Chronic cough', 'Phase 3', 'Top-line data', '2027-Q2'], ['PX-330', 'Dry eye', 'Phase 1', 'First patient dosed', '2026-Q4']], 'Development pipeline and next milestones')
    top, share = ds.share_top()
    c = ds.cur
    ds.doc('01-revenue-forecast', f'''
{ds.company} — five-year revenue forecast (synthetic)

Product A royalties are forecast to grow 4% a year through 2031, assuming market exclusivity through 2031.
''', 'Management revenue forecast and its exclusivity assumption')
    ds.doc('02-supplier-inspection-report', f'''
Inspection close-out summary — contract manufacturer for Product A (synthetic)
---page---
Open observations: 3 (including one on cleaning validation). Corrective actions due: Q1 2027.
''', 'Contract manufacturer inspection summary')
    ds.findings = [
        ('Key patent expires earlier than the forecast assumes', 'the forecast assumes exclusivity through 2031; `patent-schedule.csv` shows the Product A composition-of-matter patents expiring in 2028.'),
        ('Open manufacturing observations at the supplier', '`documents/02-supplier-inspection-report.pdf` page 2 — three open observations.'),
        ('Partner concentration', f'Aldermoor Therapeutics accounts for both of the two largest revenue lines; the royalty line alone is {pct(share)} of September 2026 revenue.'),
    ]

def ecommerce(ds):
    ds.kind, ds.kind_label = 'channel_payout', 'sales-channel payout'
    ds.summary = f'{ds.company} sells outdoor apparel direct to consumers through its own store, one large marketplace and a few wholesale retailers.'
    channels = [('Marketvale marketplace payouts', 148000), ('Own web store', 82000), ('Wholesale — Trailhead Stores', 21000), ('Wholesale — Fjord & Pine', 12000)]
    for i, (n, base) in enumerate(channels):
        ds.customer(f'{ds.prefix}-chn-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.01', noise=D('0.06')))
    rows = []
    for ci, cohort in enumerate(MONTHS[:18:3]):
        size = 2400 - ci * 60
        for k, mo in enumerate(m for m in MONTHS if m >= cohort):
            if k > 9: break
            decay = D('0.42') if ci < 3 else D('0.29')
            active = size if k == 0 else int(D(size) * decay * (D('0.93') ** k))
            rows.append([cohort, mo, k, active])
    ds.ext('orders-by-cohort', ['first_purchase_month', 'month', 'months_since_first', 'active_customers'], rows, 'Repeat purchase by first-purchase cohort')
    spend = []
    for i, mo in enumerate(LAST12):
        spend.append([mo, 'paid social', f'{ds.amt(30000 + i * 900):.2f}', 820 - i * 25])
        spend.append([mo, 'search', f'{ds.amt(18000):.2f}', 610])
    ds.ext('ad-spend', ['month', 'channel', 'spend', 'new_customers'], spend, 'Advertising spend and new customers by channel')
    top, share = ds.share_top()
    c = ds.cur
    ds.doc('01-marketplace-seller-terms', f'''
Marketvale seller terms — summary as accepted by {ds.company} (synthetic)
---page---
7. Marketvale may change fees, ranking or delist products on thirty days' notice.
''', 'Marketplace seller terms')
    ds.findings = [
        ('Majority of revenue through one marketplace', f'{top} is {pct(share)} of September 2026 revenue.'),
        ('Repeat purchase declining in recent cohorts', '`orders-by-cohort.csv` — cohorts from 2025-07 keep about 27% of customers in their second month, against about 39% for earlier cohorts.'),
        ('Acquisition cost rising on paid social', '`ad-spend.csv` — paid-social spend rises every month while new customers fall.'),
    ]

def multifamily(ds):
    ds.kind, ds.kind_label = 'rent', 'unit rent charge'
    ds.summary = f'{ds.company} owns Larkfield Commons, a 96-unit garden-style apartment community in three buildings (A, B, C).'
    rng = ds.rng
    rows, inspect, delinq = [], [], []
    ltl_sum, mkt_sum, repair = D(0), D(0), D(0)
    for b in 'ABC':
        for n in range(1, 33):
            unit = f'{b}{n:02d}'
            typ, sqft, mkt = rng.choice([('1BR', 690, 1450), ('2BR', 960, 1780), ('3BR', 1180, 2150)])
            in_place = ds.amt(mkt * (1 - rng.randint(3, 11) / 100))
            market = ds.amt(mkt)
            vacant = rng.random() < 0.05
            start = MONTHS[rng.randint(0, 20)]
            lease_end = f'{int(start[:4]) + 1}{start[4:]}-01'
            if not vacant:
                ds.customer(f'{ds.prefix}-unit-{unit}', f'Unit {unit} resident (synthetic)', flat(in_place, MONTHS[0]))
                ltl_sum += market - in_place; mkt_sum += market
            bal = ds.amt(rng.choice([0, 0, 0, 0, 0, 1450, 2900])) if b == 'C' and not vacant else (ds.amt(1450) if rng.random() < 0.03 and not vacant else D(0))
            rows.append([unit, b, typ, sqft, 'vacant' if vacant else 'occupied', '' if vacant else f'{start}-01', '' if vacant else lease_end, '0.00' if vacant else f'{in_place:.2f}', f'{market:.2f}', f'{bal:.2f}'])
            if bal > 0: delinq.append([unit, b, f'{bal:.2f}', 30 if bal < ds.amt(2000) else 60])
            cond = rng.choices(['good', 'fair', 'poor'], [5, 3, 2 if b != 'A' else 1])[0]
            cost = ds.amt({'good': 0, 'fair': 2800, 'poor': 9500}[cond])
            repair += cost
            inspect.append([unit, b, cond, f'{cost:.2f}'])
    ds.ext('rent-roll', ['unit', 'building', 'type', 'sqft', 'status', 'lease_start', 'lease_end', 'in_place_rent', 'market_rent', 'balance_due'], rows, 'Rent roll at 30 September 2026')
    ds.ext('delinquency', ['unit', 'building', 'balance_due', 'days_past_due'], delinq, 'Delinquent balances at 30 September 2026')
    ds.ext('unit-inspections', ['unit', 'building', 'condition', 'estimated_repair_cost'], inspect, 'Unit-condition inspections with repair estimates')
    gpr = ds.billed_arr()
    t12 = []
    opex_total = D(0)
    for mo in LAST12:
        rent = sum(m2.get(mo, D(0)) for _, _, m2 in ds.customers)
        other = ds.amt(4200); opex = q(rent * D('0.43')); opex_total += opex
        t12.append([mo, f'{rent:.2f}', f'{other:.2f}', f'{opex:.2f}', f'{(rent + other - opex):.2f}'])
    noi = sum(D(r[4]) for r in t12)
    om_noi = whole(noi * D('1.11'))
    budget = ds.amt(1500) * 96
    c_share = D(sum(1 for d in delinq if d[1] == 'C')) / max(len(delinq), 1)
    c = ds.cur
    ds.ext('t12', ['month', 'rental_income', 'other_income', 'operating_expenses', 'net_operating_income'], t12, 'Trailing-twelve-month operating statement (T-12)')
    ds.doc('01-offering-memorandum', f'''
Larkfield Commons — offering memorandum (synthetic)

96 units in three buildings. Stabilized net operating income: {money(c, om_noi)}.
---page---
Capital plan: {money(c, budget)} ({money(c, ds.amt(1500))} per door) covers all deferred maintenance.
Rents are shown at pro-forma market levels.
''', 'Offering memorandum with stated NOI and capital plan')
    ds.findings = [
        ('Offering memorandum NOI above the T-12', f'the memorandum states {money(c, om_noi)}; `t12.csv` sums to {money(c, noi)} — the memorandum uses pro-forma rents.'),
        ('Deferred maintenance above the capital plan', f'`unit-inspections.csv` estimates {money(c, repair)} of repairs against a {money(c, budget)} capital plan — {money(c, repair / 96)} per door. Price as remediation.'),
        ('Delinquency concentrated in Building C', f'{pct(c_share)} of delinquent units in `delinquency.csv` are in Building C.'),
        ('Loss-to-lease (upside, not price)', f'occupied units are {pct(ltl_sum / mkt_sum)} below market rent in `rent-roll.csv`. Record it as confirmed value — never as a reason to pay more.'),
    ]
    ds.notes = ['Residents are referred to by unit only; there are no personal names.', 'The rent roll maps onto the billing import: each occupied unit is a customer billed monthly.']

def commercial(ds):
    ds.kind, ds.kind_label = 'base_rent', 'tenant base-rent charge'
    ds.summary = f'{ds.company} owns Quayside Business Park, a 210,000 sq ft mixed office and light-industrial park with eleven tenants.'
    tenants = [('Corvane Logistics', 80000, 165000, '2027-06-30', 0.94), ('Pellham Engineering', 22000, 41000, '2031-03-31', 1.02), ('Brightwater Analytics', 16000, 29000, '2029-12-31', 1.0),
               ('Ashgrove Print', 9000, 18000, '2026-12-31', 1.08), ('Moorland Medical Supplies', 14000, 24000, '2030-09-30', 0.97), ('Teal Harbor Software', 11000, 16000, '2028-05-31', 1.0),
               ('Northlight Studios', 7000, 12000, '2027-01-31', 1.05), ('Fernbank Foods', 12500, 21000, '2032-06-30', 0.99), ('Cinder Path Fitness', 6000, 9000, '2026-11-30', 1.0),
               ('Haldon Insurance Brokers', 8000, 11000, '2029-02-28', 1.0), ('Gullwing Robotics', 9500, 15000, '2033-10-31', 1.0)]
    rr = []
    walt_num, total_rent = D(0), D(0)
    for i, (n, rent, sqft, end, mkt_ratio) in enumerate(tenants):
        r = ds.amt(rent)
        ds.customer(f'{ds.prefix}-ten-{i + 1:03d}', f'{n} (synthetic)', flat(r))
        yrs = (int(end[:4]) - 2026) + (int(end[5:7]) - 9) / 12
        walt_num += r * D(str(round(yrs, 2))); total_rent += r
        rr.append([n + ' (synthetic)', f'Unit {i + 1}', sqft, '2021-07-01', end, f'{r:.2f}', f'{q(r / D(str(mkt_ratio))):.2f}'])
    ds.ext('rent-roll', ['tenant', 'suite', 'sqft', 'lease_start', 'lease_end', 'monthly_base_rent', 'monthly_market_rent'], rr, 'Commercial rent roll with expiries and market rents')
    cam = [['2025', 'Repairs and maintenance', f'{ds.amt(212000):.2f}', f'{ds.amt(171000):.2f}'], ['2025', 'Insurance', f'{ds.amt(88000):.2f}', f'{ds.amt(88000):.2f}'], ['2025', 'Security', f'{ds.amt(64000):.2f}', f'{ds.amt(41000):.2f}']]
    ds.ext('cam-reconciliation', ['year', 'category', 'expenses', 'recoveries'], cam, 'Common-area-maintenance expenses against tenant recoveries')
    top, share = ds.share_top()
    walt = walt_num / total_rent
    c = ds.cur
    ds.doc('01-phase-i-environmental-site-assessment', f'''
Phase I environmental site assessment — Quayside Business Park (synthetic)
---page---
Findings: a recognized environmental condition (REC) is identified at Unit 9, the former location of a dry-cleaning operation (1988–2004). A Phase II investigation is recommended.
''', 'Phase I environmental site assessment')
    ds.doc('02-lease-abstract-corvane', f'''
Lease abstract — Corvane Logistics at Quayside Business Park (synthetic)

Term ends 30 June 2027. Tenant option to renew for five years at 95% of market rent, notice due by 31 December 2026.
''', 'Lease abstract for the anchor tenant')
    ds.findings = [
        ('Anchor tenant concentration and near-term expiry', f'{top} is {pct(share)} of base rent and its lease ends 30 June 2027 (`rent-roll.csv`, `documents/02-lease-abstract-corvane.pdf`). Weighted average lease term is {walt.quantize(D("0.1"))} years.'),
        ('Recognized environmental condition', '`documents/01-phase-i-environmental-site-assessment.pdf` page 2 — former dry cleaner at Unit 9; Phase II recommended.'),
        ('CAM recoveries below expenses', '`cam-reconciliation.csv` — repairs and security recover less than they cost.'),
        ('Below-market anchor rent', 'Corvane pays about 6% below market rent in `rent-roll.csv` — the deepest discount on the rent roll, on the largest lease.'),
    ]

def hotels(ds):
    ds.kind, ds.kind_label = 'room_revenue', 'revenue-channel settlement'
    ds.summary = f'{ds.company} owns and operates the 180-room Harbourview Hotel, a branded upscale hotel under a franchise agreement.'
    rng = ds.rng
    season = {1: 0.72, 2: 0.76, 3: 0.84, 4: 0.9, 5: 1.0, 6: 1.18, 7: 1.32, 8: 1.3, 9: 1.08, 10: 0.95, 11: 0.8, 12: 0.78}
    chans = [('BookNest online travel agency', 0.41), ('Direct web and phone', 0.27), ('Corporate accounts', 0.18), ('Groups and events', 0.09), ('Food and beverage', 0.05)]
    hist, str_rows = [], []
    for i, mo in enumerate(MONTHS):
        s = D(str(season[int(mo[5:])]))
        occ = min(D('0.93'), D('0.68') * s)
        adr = ds.amt(168) * (D('0.92') + s / 10) * (D('1.015') ** (i // 12))
        sold = int(D(180 * 30) * occ)
        room_rev = q(adr * sold)
        hist.append([mo, 180 * 30, sold, f'{q(adr):.2f}', f'{q(room_rev / (180 * 30)):.2f}', f'{room_rev:.2f}', f'{q(room_rev * D("0.19")):.2f}', f'{q(room_rev * D("0.34")):.2f}'])
        if mo >= '2025-10':
            comp = q(room_rev / (180 * 30) * D('1.07') * (D('1.006') ** (i - 12)))
            str_rows.append([mo, f'{occ:.3f}', f'{q(adr):.2f}', f'{q(room_rev / (180 * 30)):.2f}', f'{comp:.2f}'])
    for j, (n, sh) in enumerate(chans):
        monthly = {row[0]: D(row[5]) * D(str(sh)) for row in hist}
        ds.customer(f'{ds.prefix}-chn-{j + 1:03d}', f'{n} (synthetic)', monthly)
    ds.ext('operating-history', ['month', 'rooms_available', 'rooms_sold', 'adr', 'revpar', 'room_revenue', 'fb_revenue', 'gross_operating_profit'], hist, 'Monthly operating history from the property-management system')
    ds.ext('str-benchmark', ['month', 'occupancy', 'adr', 'revpar', 'comp_set_revpar'], str_rows, 'STR-style benchmark against the competitive set')
    top, share = ds.share_top()
    c = ds.cur
    pip = ds.amt(3600000)
    ds.doc('01-franchise-agreement', f'''
Franchise agreement — Harbourview Hotel (synthetic brand: Meridale Hotels)
---page---
16.4 Transfer. On any change of ownership the transferee must complete a property improvement plan (PIP) specified by the Franchisor. The current estimate of the PIP is {money(c, pip)}.
21.1 The Franchisor may terminate on transfer without consent.
''', 'Franchise agreement with transfer and PIP clauses')
    ds.doc('02-management-contract', f'''
Hotel management agreement — {ds.company} and Coastline Hospitality Management (synthetic)
---page---
12.2 Termination on sale. The Owner may terminate on sale of the hotel on payment of a termination fee equal to three times the prior year's base management fee.
''', 'Third-party management contract')
    ds.findings = [
        ('Brand PIP required on change of ownership', f'`documents/01-franchise-agreement.pdf` page 2, clause 16.4 — PIP estimated at {money(c, pip)}. Price as remediation or escrow.'),
        ('RevPAR trailing the competitive set', 'in `str-benchmark.csv` the hotel\'s RevPAR trails the competitive set by about 7% in October 2025, widening to about 12% by September 2026.'),
        ('Channel concentration', f'{top} is {pct(share)} of revenue — commission cost and ranking risk.'),
        ('Seasonal demand', 'July and August room revenue is about twice January\'s in `operating-history.csv`.'),
        ('Management contract termination fee', '`documents/02-management-contract.pdf` page 2, clause 12.2 — three times the prior year\'s base fee on sale.'),
    ]

def hospitals(ds):
    ds.kind, ds.kind_label = 'net_patient_revenue', 'payer net-revenue settlement'
    ds.summary = f'{ds.company} operates St. Brennan Regional Medical Center, a 220-bed acute-care hospital with cardiology, orthopaedics and maternity service lines.'
    payers = [('Government programme A', 1850000), ('Commercial plan Keystone', 610000), ('Government programme B', 420000), ('Commercial plan Riverbend', 280000), ('Self-pay and other', 120000)]
    for i, (n, base) in enumerate(payers):
        ds.customer(f'{ds.prefix}-pay-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.003', noise=D('0.02')))
    census = []
    for mo in LAST12:
        for line, adm, los in (('Cardiology', 310, 4.1), ('Orthopaedics', 260, 3.2), ('Maternity', 190, 2.4), ('General medicine', 520, 3.8)):
            days = int(adm * los); census.append([mo, line, adm, days, f'{days / 30:.1f}'])
    ds.ext('census', ['month', 'service_line', 'admissions', 'patient_days', 'average_daily_census'], census, 'Admissions and census by service line')
    pm = [[mo, n, f'{q(m2[mo] * D("2.9")):.2f}', f'{m2[mo]:.2f}'] for mo in LAST12 for _, n, m2 in ds.customers]
    ds.ext('payer-mix', ['month', 'payer', 'gross_charges', 'net_revenue'], pm, 'Gross charges and net revenue by payer')
    top, share = ds.share_top()
    c = ds.cur
    ds.doc('01-accreditation-record', f'''
St. Brennan Regional Medical Center — accreditation status (synthetic)

Accredited through 31 May 2028.
---page---
Condition: accreditation does not transfer automatically on a change of ownership; a new owner must apply within 30 days and undergo a focused survey.
''', 'Accreditation record and transfer condition')
    ds.doc('02-medicare-cost-report-summary', f'''
Cost report summary, fiscal year 2025 (synthetic)

Total operating expenses: {money(c, ds.amt(36200000))}
Committed regulatory capital expenditure (fire-safety and seismic upgrades): {money(c, ds.amt(4100000))}
''', 'Cost report summary with committed regulatory capex', 'Financial')
    ds.doc('03-service-line-dependence', f'''
Service-line staffing summary (synthetic, aggregate)

Cardiology: two interventional cardiologists perform about 80% of procedures.
''', 'Aggregate physician dependence by service line')
    ds.findings = [
        ('Earnings concentrated in one payer', f'{top} is {pct(share)} of September 2026 net revenue.'),
        ('Accreditation does not transfer automatically', '`documents/01-accreditation-record.pdf` page 2 — make it a closing condition.'),
        ('Key-physician dependence in cardiology', '`documents/03-service-line-dependence.pdf` — two physicians perform about 80% of cardiology procedures (aggregate data only).'),
        ('Committed regulatory capex', f'`documents/02-medicare-cost-report-summary.pdf` — {money(c, ds.amt(4100000))} committed. Price as remediation.'),
    ]
    ds.notes = ['Physician data is aggregate only; Pactlab never sends people data to a model.']

def clinics(ds):
    ds.kind, ds.kind_label = 'clinic_revenue', 'payer remittance'
    ds.summary = f'{ds.company} runs six dental and physiotherapy clinics with 22 providers, paid by insurers and patients.'
    payers = [('Insurer Bluepoint', 96000), ('Insurer Harrowgate', 54000), ('Government scheme', 41000), ('Patients — self-pay', 38000)]
    for i, (n, base) in enumerate(payers):
        ds.customer(f'{ds.prefix}-pay-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.005', noise=D('0.03')))
    vol = []
    site3_p07, site3_total = D(0), D(0)
    for mo in LAST12:
        for site in range(1, 7):
            for p in range(1, 5 if site != 3 else 3):
                ref = f'P{(site - 1) * 4 + p:02d}' if site != 3 else ('P07' if p == 1 else 'P08')
                visits = 240 if (site == 3 and ref == 'P07') else 85 if site == 3 else ds.rng.randint(120, 200)
                rev = ds.amt(visits * 105)
                if site == 3: site3_total += rev; site3_p07 += rev if ref == 'P07' else 0
                vol.append([mo, f'Site {site}', ref, visits, f'{rev:.2f}'])
    ds.ext('patient-volume', ['month', 'site', 'provider_ref', 'visits', 'revenue'], vol, 'Visits and revenue by site and pseudonymous provider')
    ds.ext('equipment-schedule', ['asset', 'site', 'acquired', 'useful_life_years', 'status'], [
        ['Panoramic X-ray unit', 'Site 1', '2014-05-01', 10, 'in service'], ['Panoramic X-ray unit', 'Site 4', '2015-02-01', 10, 'in service'],
        ['Dental chairs (6)', 'Site 2', '2021-09-01', 12, 'in service'], ['Shockwave therapy unit', 'Site 5', '2023-03-01', 8, 'in service']], 'Equipment with acquisition dates and useful lives')
    ds.ext('coding-summary', ['quarter', 'high_complexity_share', 'policy_benchmark'], [['2025-Q4', '0.31', '0.15'], ['2026-Q1', '0.33', '0.15'], ['2026-Q2', '0.34', '0.15'], ['2026-Q3', '0.36', '0.15']], 'Share of visits billed at the highest complexity code')
    c = ds.cur
    ds.doc('01-coding-policy', f'''
{ds.company} — coding and billing policy (synthetic)

Highest-complexity codes are expected for about 15% of visits. Higher shares require a documented clinical review.
''', 'Coding and billing policy')
    ds.findings = [
        ('One provider carries Site 3', f'P07 earns {pct(site3_p07 / site3_total)} of Site 3 revenue in `patient-volume.csv` — a retention risk after closing.'),
        ('High-complexity coding above policy', '`coding-summary.csv` shows 31–36% of visits at the highest code against the 15% expected by `documents/01-coding-policy.pdf`.'),
        ('Imaging equipment past its useful life', 'two panoramic X-ray units in `equipment-schedule.csv` (2014 and 2015, ten-year lives). Price as remediation.'),
    ]
    ds.notes = ['Providers are pseudonymous (P01, P02, …); Pactlab never sends people data to a model.']

PACKS = [
    ('software-saas', 'Brightwave Software', software), ('fintech', 'Tallyport Payments', fintech), ('healthcare', 'Riverside Care Partners', healthcare),
    ('telecom-media', 'Northlake Fibre', telecom), ('professional-services', 'Sablestone Consulting', services), ('pharma-biotech', 'Calvera Pharmaceuticals', pharma),
    ('ecommerce-dtc', 'Ridgeline Outfitters', ecommerce), ('hotels', 'Harbourview Hotel Holdings', hotels), ('multifamily', 'Larkfield Residential', multifamily),
    ('commercial-property', 'Quayside Estates', commercial), ('hospitals', 'St. Brennan Health', hospitals), ('small-clinics', 'Clearbrook Clinics', clinics),
]

if __name__ == '__main__':
    built = []
    for slug, brand, fn in PACKS:
        for cur in CUR:
            ds = Dataset(slug, cur, brand, 'x')
            fn(ds)
            ds.write()
            built.append((slug, cur, ds.company, ds.line_count, len(ds.findings)))
    for b in built: print(*b, sep='\t')
