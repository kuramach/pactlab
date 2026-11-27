#!/usr/bin/env python3
"""Generate the Pactlab synthetic demo data set: <pack>/<CURRENCY>/files.

Everything is invented. Deterministic: same output every run.
Usage: python3 scripts/demo-data/generate.py <out_dir>   (or scripts/demo-data/build.sh, which also builds the PDFs)
Writes per dataset: README.md, invoice-lines.csv, <extract>.csv,
vdr-index.csv, bidders.csv (the seller-side test), documents/*.md (PDFs are built afterwards by kit:build).
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
# Five years of history (T-184b): the months before MONTHS back to January 2021, for packs whose billing runs back.
HIST_MONTHS = []
y, m = 2021, 1
while (y, m) < (2024, 10):
    HIST_MONTHS.append(f'{y}-{m:02d}'); m += 1
    if m == 13: y, m = y + 1, 1
MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
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

def sig2(x):
    """Round to two significant figures, as a seller quotes a price (4,730,000 -> 4,700,000)."""
    x = D(x)
    step = D(10) ** (len(str(int(x))) - 2)
    return (x / step).quantize(D('1'), ROUND_HALF_UP) * step

# The seller's asking price for each pack, as a multiple of September 2026
# billed revenue run-rate: a full but plausible ask for the sector, set before
# diligence so the planted findings show up as a gap against it. Enterprise
# value, quoted in the teaser. Venture Raise has no asking price —
# the founder sets the round on the Raise tab instead.
ASKING_MULTIPLE = {
    'software-saas': D('8'), 'fintech': D('4'), 'healthcare': D('1.5'), 'telecom-media': D('3'),
    'professional-services': D('1.2'), 'pharma-biotech': D('4'), 'ecommerce-dtc': D('1.5'), 'hotels': D('3.5'),
    'multifamily': D('12'), 'commercial-property': D('11'), 'hospitals': D('1'), 'small-clinics': D('1.3'),
    'multifamily-syndication': D('12'),
}

class Dataset:
    def __init__(self, pack, cur, brand, kind):
        self.pack, self.cur, self.c = pack, cur, CUR[cur]
        self.company = f'{brand} {self.c["suffix"]}'
        self.brand, self.kind = brand, kind
        self.rng = random.Random(f'{pack}:{cur}')
        self.customers = []   # (id, name, {month: Decimal})
        self.billing_months = MONTHS   # HIST_MONTHS + MONTHS when the billing export runs back five years (T-184b)
        self.extracts = {}    # name -> (header, rows, description)
        self.docs = {}        # name -> (markdown, description, data_class)
        self.findings = []    # (title, where to look)
        self.notes = []
        self.summary = ''
        self.sale_summary = None  # what the seller shares with bidders, when it differs from the summary
        self.engineering = False
        self.prefix = ''.join(w[0] for w in pack.split('-'))[:3]
        # The selling entity and the buyer the guide enters; a syndication (T-106) seats the sponsor as the buyer.
        self.seller, self.buyer = None, 'Demo Buyer'
        self.syndication_step = []
        self.music_step = []
        self.energy_step = []
        self.spv_step = []
        self.pnl_step = []
        self.ask = None
        self.ask_note = None

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

    def asking(self):
        """The seller's asking price: a multiple of billed revenue, or the pack's own ask (a royalty catalog prices on statement income)."""
        return self.ask if self.ask is not None else sig2(self.billed_arr() * ASKING_MULTIPLE[self.pack])

    @property
    def seller_name(self):
        return self.seller or self.company

    def bidders(self):
        """Three synthetic bidding firms for the seller-side test (T-097): one offers just under the ask and
        raises in round 2, one offers lower with an earn-out, one passes. For a raise: investors with a pre-money."""
        c = self.cur
        if self.pack == 'venture-raise':
            return [
                dict(firm='Harborline Ventures (synthetic)', tag='harborline', kind='Venture fund',
                     question='How many months of runway do you have after this round?', scope='ALL',
                     answer='About 20 months at the current burn, by our own estimate.',
                     price=self.amt(2000000), round2=self.amt(2000000), pre_money=self.amt(10000000), round2_pre=self.amt(11000000),
                     structure='Series Seed preferred, 1x non-participating', conditions='One investor board seat; pro-rata rights', outcome='Awarded in round 2'),
                dict(firm='Kestrel Seed Fund (synthetic)', tag='kestrel', kind='Seed fund',
                     question='Can you share the founders\' vesting schedules?', scope='PRIVATE',
                     answer='Four years with a one-year cliff, from February 2023; the schedules are in the data room.',
                     price=self.amt(1500000), round2=self.amt(1500000), pre_money=self.amt(9000000), round2_pre=self.amt(9500000),
                     structure='SAFE, valuation cap as the pre-money, 15% discount', conditions='Most-favoured-nation clause', outcome='Shortlisted, then declined at the award'),
                dict(firm='Atlas Angels (synthetic)', tag='atlas', kind='Angel group',
                     question='', scope='', answer='', price=None, round2=None, pre_money=None, round2_pre=None,
                     structure='', conditions='', outcome='Passes: "Too early for our fund this year."'),
            ]
        ask = self.asking()
        return [
            dict(firm='Harbor Capital Partners (synthetic)', tag='harbor', kind='Private equity',
                 question='Can any customer or supplier contract be ended on a change of control?', scope='ALL',
                 answer='One customer contract has a change-of-control clause; it is in the shared documents.',
                 price=sig2(ask * D('0.92')), round2=sig2(ask * D('0.97')), pre_money=None, round2_pre=None,
                 structure='Cash at close for 100% of the shares', conditions='Subject to confirmatory diligence and committed financing', outcome='Awarded in round 2'),
            dict(firm='Northline Strategic (synthetic)', tag='northline', kind='Corporate (strategic acquirer)',
                 question='Can you share the last three years of audited accounts?', scope='PRIVATE',
                 answer='FY2024 and FY2025 are audited; FY2026 closes in December. We will add them to the data room.',
                 price=sig2(ask * D('0.85')), round2=sig2(ask * D('0.88')), pre_money=None, round2_pre=None,
                 structure='80% cash at close, 20% earn-out over 24 months', conditions='Key-person retention for the founders', outcome='Shortlisted, then declined at the award'),
            dict(firm='Atlas Growth Equity (synthetic)', tag='atlas', kind='Growth equity',
                 question='', scope='', answer='', price=None, round2=None, pre_money=None, round2_pre=None,
                 structure='', conditions='', outcome='Passes: "Outside our sector focus this year."'),
        ]

    def write(self):
        d = os.path.join(OUT, self.pack, self.cur)
        os.makedirs(os.path.join(d, 'documents'), exist_ok=True)
        cols = ['line_id', 'invoice_id', 'customer_id', 'customer_name', 'subscription_id', 'price_id', 'currency', 'amount', 'interval',
                'interval_count', 'period_start', 'period_end', 'invoice_status', 'created']
        buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n'); w.writerow(cols)
        seq = 0
        for month in self.billing_months:
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
            self.doc('99-data-room-extracts', '\n---page---\n'.join(pages), 'Every CSV extract in this folder as one paged PDF, so findings can cite a page', 'Financial')
        for name, (text, _, _) in self.docs.items():
            open(os.path.join(d, 'documents', f'{name}.md'), 'w').write(text)
        # VDR index
        b = io.StringIO(); ww = csv.writer(b, lineterminator='\n')
        ww.writerow(['doc_id', 'title', 'file', 'data_class', 'as_of'])
        first = self.billing_months[0]
        ww.writerow([f'{self.prefix.upper()}-001', f'Invoice lines, {MONTH_LABEL[int(first[5:]) - 1]} {first[:4]} – Sep 2026', 'invoice-lines.csv', 'Financial', '2026-09-30'])
        i = 1
        for name, (_, _, desc) in self.extracts.items():
            i += 1; ww.writerow([f'{self.prefix.upper()}-{i:03d}', desc, f'{name}.csv', 'Financial', '2026-09-30'])
        for name, (_, desc, dc) in self.docs.items():
            i += 1; ww.writerow([f'{self.prefix.upper()}-{i:03d}', desc, f'documents/{name}.pdf', dc, '2026-09-30'])
        open(os.path.join(d, 'vdr-index.csv'), 'w').write(b.getvalue())
        # Who to invite in the seller-side test, and what each bidder asks and offers.
        b = io.StringIO(); ww = csv.writer(b, lineterminator='\n')
        ww.writerow(['firm', 'invite_tag', 'kind', 'question', 'answer_to', 'answer', 'offer_round_1', 'offer_round_2', 'pre_money_round_1', 'pre_money_round_2', 'currency', 'structure', 'conditions', 'outcome'])
        for bd in self.bidders():
            fmt = lambda v: '' if v is None else f'{v:.0f}'
            ww.writerow([bd['firm'], bd['tag'], bd['kind'], bd['question'], {'ALL': 'all bidders', 'PRIVATE': 'only this bidder'}.get(bd['scope'], ''), bd['answer'],
                         fmt(bd['price']), fmt(bd['round2']), fmt(bd['pre_money']), fmt(bd['round2_pre']), self.cur if bd['price'] is not None else '', bd['structure'], bd['conditions'], bd['outcome']])
        open(os.path.join(d, 'bidders.csv'), 'w').write(b.getvalue())
        open(os.path.join(d, 'README.md'), 'w').write(self.readme())

    def seller_side(self):
        """Part B (T-097): the seller runs a bid process. Labels are exactly what Pactlab shows."""
        c, venture = self.cur, self.pack == 'venture-raise'
        label = COMPANY_TYPE_LABELS[self.pack]
        pdfs = list(self.docs.keys())
        teaser = pdfs[0] if pdfs else None
        bidders = self.bidders()
        a, b, passer = bidders
        who = 'investor' if venture else 'bidder'
        title = 'run a round' if venture else 'run a bid process'
        out = [f'# Part B — Seller side: {title}', '',
               f'Here you are {self.seller_name.rstrip(".")}{" raising a round" if venture else ""}. You invite three {who}s from `bidders.csv`, share a little, answer their questions and choose one.',
               f'Each {who} sees only their own bid — never another {who}\'s questions, offers or whether they passed. Part B checks that too.', '',
               '**Addresses.** This folder holds no email addresses. Invite **an address you can read for each firm**: your own address with `+` and the firm\'s tag from `bidders.csv` added before the @ (for tag `harbor`: *yourname+harbor* at your email domain — Gmail, Outlook and most providers deliver it to you). On your own computer (`pnpm dev`) any made-up address works: every email Pactlab sends, invitations and sign-in codes, is written to `apps/api/.data/mail/`.', '']
        n = 0
        def step(t):
            nonlocal n
            n += 1
            out.extend([f'## Step B{n} — {t}', ''])
        step('Start the Pact as the seller')
        out += ['1. Click **Start a Pact** (top right).',
                f'2. Under *Who are you in this deal?* choose **We are selling (or raising)**. Pact name: `Project {self.brand.split()[0]} Sale` · Base currency: **{c}** → **Next**. (There is no buying-entity step.)',
                f'3. **Selling entity** — Legal or trading name: `{self.seller_name}` · **Private** · What kind of company is it?: **{label}** → **Next**.',
                '4. **Asking price** — ' + ('choose **Not known yet** → **Next**.' if venture else f'enter the same asking price as Part A, Step 1 (`{self.asking():.0f}`) → **Next**.'),
                '5. **Review and start** — the Buyer box says *Bid process — you invite buyers once the pact starts* → **Start Pact**.', '',
                '**You should see:** the **Bidders** page, with no bidders yet.', '']
        step(f'Decide what {who}s see')
        out += ['On **Bidders**, under **What bidders see**:', '',
                '| Field | Enter |', '|---|---|',
                f'| Shared summary | `{self.sale_summary or self.summary}` |',
                f'| Your data room (link) | `https://dataroom.example/{self.pack}` (Pactlab is not the data room; this is where you would grant access) |',
                f'| NDA | `Mutual NDA (synthetic): everything shared about {self.seller_name} stays confidential.` |',
                '| Offer deadline (UTC) | a date a week from today |', '',
                '→ **Save**.', '']
        if teaser:
            out += [f'Then open the **Documents** tab and upload `documents/{teaser}.pdf` with **Share with bidders** ticked (it is chosen at upload and cannot be changed later). Upload nothing else as shared — the rest stays with you.', '']
        out += [f'**You should see:** "Saved. Bidders see the shared view once they accept the NDA."' + (f' On Documents, `{teaser}.pdf` is listed.' if teaser else ''), '']
        step(f'Add the three {who}s and invite them')
        out += ['On **Bidders**, for each row of `bidders.csv`:', '',
                '| Bidding firm | Then invite | Tag |', '|---|---|---|']
        out += [f'| `{x["firm"]}` → **Add bidder** | your address with `+{x["tag"]}` in *Invite someone from {x["firm"]}* → **Invite** | `{x["tag"]}` |' for x in bidders]
        out += ['', '**You should see:** three firms marked **Invited**, each listing the address you invited.', '']
        step(f'Be each {who} (a private window per {who})')
        out += [f'For each {who}: open the invitation link (from the email, or the newest file in `apps/api/.data/mail/`) in a **private window**, create the account with the firm\'s name, sign in with the code, then **Accept and open the pact**.', '',
                f'1. You land on **Your bid** and see only the NDA. Click **I accept the NDA** — the shared summary, the data-room link{" and the shared document" if teaser else ""} appear.',
                f'2. **{a["firm"]}**: ask `{a["question"]}` → **Ask**. Then offer:', '',
                '   | Field | Enter |', '   |---|---|',
                f'   | Price | `{a["price"]:.0f}` ({money(c, a["price"])}){" — the amount invested" if venture else ""} |',
                f'   | Currency | `{c}` |']
        if venture:
            out.append(f'   | Pre-money valuation (investment rounds only) | `{a["pre_money"]:.0f}` ({money(c, a["pre_money"])}) |')
        out += [f'   | Structure (cash, shares, earn-out…) | `{a["structure"]}` |', f'   | Conditions | `{a["conditions"]}` |', '', '   → **Submit offer**.',
                f'3. **{b["firm"]}**: ask `{b["question"]}` → **Ask**. Then offer **Price** `{b["price"]:.0f}` ({money(c, b["price"])})' + (f', **Pre-money** `{b["pre_money"]:.0f}`' if venture else '') + f', **Structure** `{b["structure"]}`, **Conditions** `{b["conditions"]}` → **Submit offer**.',
                f'4. **{passer["firm"]}**: accept the NDA, then type `{passer["outcome"].split(": ", 1)[1].strip(chr(34))}` as the reason → **Pass on this pact**.', '',
                f'**You should see**, as {b["firm"]}: your own question and offer only — nothing of {a["firm"]}\'s question or offer, and no sign that {passer["firm"]} passed. There are no deal tabs; trying `/deals/<id>/bidders` shows nothing of the seller\'s side.', '']
        step('Answer the questions')
        out += ['Back as the seller (your normal window), on **Bidders** under **Questions from bidders**:', '',
                f'- {a["firm"]}\'s question → answer `{a["answer"]}` → choose **All bidders (without naming who asked)** → **Answer**.',
                f'- {b["firm"]}\'s question → answer `{b["answer"]}` → keep **Only {b["firm"]}** → **Answer**.', '',
                f'**You should see**, as {b["firm"]} (refresh **Your bid**): your private answer, and under *Answered to all bidders* the {"runway" if venture else "change-of-control"} question — without the name of who asked it. {a["firm"]} sees the answer to all, but not {b["firm"]}\'s private one.', '']
        step('Compare the offers')
        out += ['On **Bidders**, **Offers side by side** sets the two offers next to each other — price' + (', pre-money' if venture else '') + ', structure, conditions, version. Pactlab does not rank them or recommend one.', '',
                f'**You should see:** {a["firm"]} at {money(c, a["price"])} and {b["firm"]} at {money(c, b["price"])}; {passer["firm"]} marked **Passed** with its reason.', '']
        if venture:
            out += ['For each investor, click **Add to round comparison**. Open the **Raise** tab: both appear under **Offers**. To see what the founders own after each, import `cap-table.csv` on **Sources** first, as in Part A.', '']
        step('Shortlist, run round 2 and choose')
        out += [f'1. Click **Shortlist** on {a["firm"]} and on {b["firm"]}, then **Start round 2 with 2 shortlisted**.',
                f'2. As each {who}, submit a revised offer on **Your bid**: {a["firm"]} `{a["round2"]:.0f}`' + (f' (pre-money `{a["round2_pre"]:.0f}`)' if venture else '') + f', {b["firm"]} `{b["round2"]:.0f}`' + (f' (pre-money `{b["round2_pre"]:.0f}`)' if venture else '') + ' → **Submit revised offer**. Every version stays listed.',
                f'3. As the seller, click **Award to {a["firm"]}**.', '',
                f'**You should see:** "Awarded. Every other bidder has been declined and their access ended." {a["firm"]}\'s **Your bid** says **Selected by the seller**; {b["firm"]} can no longer open the pact. The **Team** tab and the audit log record every step.', '']
        return out

    def readme(self):
        """A click-by-click guide: every label below is exactly what Pactlab shows on screen."""
        c, imports = self.cur, PACK_IMPORTS.get(self.pack, {})
        label = COMPANY_TYPE_LABELS[self.pack]
        pdfs = [(name, desc, dc) for name, (_, desc, dc) in self.docs.items()]
        venture = self.pack == 'venture-raise'
        out = [f'# {self.company} — {PACK_TITLES[self.pack]} ({c})', '',
               f'**Fictional target.** {self.summary}', f'Based in {self.c["city"]}, {self.c["country"]}; reports in {c}. Data runs {MONTH_NAME[int(self.billing_months[0][5:]) - 1]} {self.billing_months[0][:4]} to September 2026.', '',
               '> Synthetic demo data. Every company, person, address, account and figure here is invented.', '',
               '## Before you start', '',
               '- Download this whole folder (on GitHub: **Code → Download ZIP** at the top of the repository, then unzip).',
               '- Sign in to Pactlab. The steps take about 15 minutes.',
               f'- You upload **{1 + len(imports)} CSV file{"s" if imports else ""}** and **{len(pdfs)} PDF{"s" if len(pdfs) != 1 else ""}**. Nothing else.',
               '- **Never upload the `.md` files** in `documents/`. They are the text each PDF is built from; Pactlab reads the PDFs.',
               '- `vdr-index.csv` is for reference only (how a data room would list these files). Do not upload it.',
               '- Text in **bold** below is a button, tab or option exactly as Pactlab shows it.', '',
               '## Two ways to test this company', '',
               f'- **Part A — Buyer side** (Steps 1 onwards): you {"are the founder, diligencing your own startup before investors do" if venture else ("are " + self.buyer + ", the sponsor, diligencing the property you are buying and the offering you raise its equity on" if self.seller else "are a buyer doing diligence on " + self.company)}.',
               f'- **Part B — Seller side** ([below](#part-b--seller-side-run-a-{"round" if venture else "bid-process"})): you {"are the founder, inviting several investors" if venture else "are " + self.seller_name + ", inviting several buyers"} — they ask questions, then offer or pass, and you choose one. Uses `bidders.csv`.',
               '- Each part starts its own Pact, so you can do either one, or both.', '',
               '# Part A — Buyer side', '']
        step = 0
        def heading(title):
            nonlocal step
            step += 1
            out.extend([f'## Step {step} — {title}', ''])
        heading('Start the Pact')
        out += ['1. Click **Start a Pact** (top right).',
                f'2. **Name the Pact** — Pact name: `Project {self.brand.split()[0]}` · Base currency: **{c}** → **Next**.',
                f'3. **Buying entity** — Legal or trading name: `{self.buyer}` · **Private** → **Next**.',
                f'4. **Selling entity** — Legal or trading name: `{self.seller_name}` · **Private** · What kind of company is it?: **{label}** → **Next**.']
        if venture:
            out.append('5. **Asking price** — choose **Not known yet** (a raise has no asking price; you set your round on the **Raise** tab after the uploads) → **Next**.')
        else:
            asking = self.asking()
            out += ['5. **Asking price** — choose **We have an asking price**, then:', '',
                    '   | Field | Enter |', '   |---|---|',
                    f'   | Asking price | `{asking:.0f}` ({money(c, asking)}) |',
                    f'   | Currency | **{c}** |',
                    '   | Quoted as | **Enterprise value** |',
                    '   | Where it came from | **Teaser or information memorandum** |',
                    '   | Date quoted | 30 September 2026 |',
                    '   | Of which earn-out, Note | leave empty |', '',
                    (f'   → **Next**. ({self.ask_note})' if self.ask_note else f'   → **Next**. (This is the seller\'s ask: about 14× trailing statement income. The demo shows how far the evidence supports it.)' if self.ask is not None else f'   → **Next**. (This is the seller\'s ask: {ASKING_MULTIPLE[self.pack]}× the September 2026 billed revenue run-rate. The demo shows how far the evidence supports it.)')]
        out += ['6. **Review and start** — check the summary → **Start Pact**.', '',
                f'**You should see:** the Pact overview for `{self.seller_name}`' + ('.' if venture else f', with the asking price {money(c, asking)}.'), '']
        heading('Upload the billing export')
        out += ['1. Open the **Sources** tab → **Upload billing export**.',
                '2. *1. Where is the export from?* → **Pactlab standard template**.',
                '3. *2. Choose the file* → `invoice-lines.csv` → **Upload and map columns**.',
                f'4. The columns are matched for you. Click **Check every row**, then **Import {self.line_count} lines**.', '',
                '**You should see:** a green message ending "Finances now include them." The **Finances** tab now shows the revenue ledger.', '']
        if imports:
            heading('Upload the industry data')
            out += ['Open the **Sources** tab and scroll to **Industry data**. Upload these files one at a time:', '',
                    '| # | Click | Choose the file | Then | Button should read |', '|---|---|---|---|---|']
            for i, (name, target) in enumerate(imports.items(), 1):
                out.append(f'| {i} | **Upload {target.lower()}** | `{name}.csv` | **Upload and map columns** → **Check every row** | **Import {len(self.extracts[name][1])} rows** |')
            out += ['', '**You should see** after each import: "… imported … Industry checks ran on them". Some findings may already appear as drafts; that is expected.', '']
        heading('Upload the documents')
        out += [f'Open the **Documents** tab. Under **Upload a document**, upload each PDF from the `documents/` folder, one at a time — choose the file, set **Data class**, leave **Keep away from AI** unticked, click **Upload**.', '',
                '| # | File | Data class | What it is |', '|---|---|---|---|']
        for i, (name, desc, dc) in enumerate(pdfs, 1):
            out.append(f'| {i} | `documents/{name}.pdf` | **{DATA_CLASS_LABELS[dc]}** | {desc} |')
        out += ['', f'**You should see:** all {len(pdfs)} documents listed on the **Documents** tab.', '']
        if venture:
            heading('Set your round and record the offer (Raise tab)')
            out += ['Open the **Raise** tab.', '',
                    '1. Under **The round**, enter:', '',
                    '   | Field | Enter |', '   |---|---|',
                    f'   | Currency | **{c}** |',
                    f'   | Your ask (pre-money) | `{self.amt(12000000):.0f}` ({money(c, self.amt(12000000))}) |',
                    f'   | Raising | `{self.amt(2000000):.0f}` ({money(c, self.amt(2000000))}) |',
                    '   | Pool target after the round (%) | `10` |', '',
                    '   → **Save round**.',
                    '2. Under **Offers**, record Harborline Ventures\' term sheet (`documents/06-term-sheet-harborline.pdf`):', '',
                    '   | Field | Enter |', '   |---|---|',
                    '   | Investor (firm or fund) | `Harborline Ventures` |',
                    f'   | Pre-money ({c}) | `{self.amt(10000000):.0f}` ({money(c, self.amt(10000000))}) |',
                    f'   | Amount ({c}) | `{self.amt(2000000):.0f}` ({money(c, self.amt(2000000))}) |',
                    '   | Pool target (%) | `10` |',
                    '   | Liquidation preference (×) | `1` |',
                    '   | Investor board seats | `1` |',
                    '   | Received on | 30 September 2026 |', '',
                    '   → **Record offer**.', '',
                    '**You should see:** **Offers side by side** showing Harborline\'s price per share and what the founders own after the round.', '']
        if self.engineering:
            heading('Connect the code and delivery data (Engineering)')
            out += ['Code and delivery data come through their APIs, never as files. Local and dev Pactlab include a synthetic Brightwave repository and Jira site for this:', '',
                    '1. Open the **Sources** tab → **Connect synthetic code and Jira data**.',
                    '2. Repository: **brightwave/platform** · Jira site: **brightwave.atlassian.net (BW)** → **Connect and sync**.',
                    '3. Pactlab opens **Engineering** when the sync finishes (a few seconds).', '',
                    '**You should see** on **Engineering**: the Brightwave team (six engineers and a product manager who files work but never commits), `billing/` maintained by one person, one engineer marked departed, and delivery slipping in the last two sprints. On **Findings**, two engineering drafts:', '',
                    '- **Single-contributor concentration in billing/** — one engineer wrote every billing change.',
                    '- **Commits attributed to unmatched or departed identities** — commits still arrive under an engineer who left in May.', '']
        if self.syndication_step:
            heading('Read the offering (Syndication tab)')
            out += self.syndication_step
        if self.music_step:
            heading('Read the catalog (Catalog tab)')
            out += self.music_step
        if self.energy_step:
            heading('Read the reserves and liabilities (Assets tab)')
            out += self.energy_step
        if self.spv_step:
            heading('Seat the investors and check the vehicle (SPV tab)')
            out += self.spv_step
        if self.pnl_step:
            heading('Upload the P&L by year')
            out += self.pnl_step
        heading('Run the checks and review the findings')
        out += [f'1. Open the **Findings** tab → **Run {label.lower()} checks**.',
                f'2. **You should see exactly these {len(self.findings)} findings** (running the checks again adds nothing):', '']
        for i, (title, where) in enumerate(self.findings, 1):
            out.append(f'   {i}. **{title}** — {where}')
        out += ['', '3. Open each finding, read the quoted evidence, then click **Accept**, **Reject** or **Ask for support**. A person decides; Pactlab only drafts.', '']
        heading('Test the price')
        if venture:
            out += ['Open the **Raise** tab again. **Offers side by side** now reflects the cap table: SAFE-1 converts on SAFE-3\'s terms (most-favoured-nation). '
                    'Under **Ready for diligence?**, see what an investor will still ask for. The investor view shares only what is safe to share.', '']
        else:
            out += ['1. Open the **Valuation** tab → **New scenario**.',
                    '2. Fill in the valuation method\'s fields — the hint under each field says where its number comes from (usually the **Finances** tab) — and save.',
                    '3. Click **Run** on the scenario.', '',
                    '**You should see:** **Asking vs Sextant** — the asking price against the value the evidence supports, before and after the findings you accepted.', '']
        out += self.seller_side()
        out += ['## Every file in this folder', '', '| File | What it is | Upload it? |', '|---|---|---|',
                f'| `invoice-lines.csv` | {self.line_count} revenue lines, one per {self.kind_label} per month | **Yes** — billing export step |']
        for name, (_, rows, desc) in self.extracts.items():
            if name in imports:
                out.append(f'| `{name}.csv` | {desc} ({len(rows)} rows) | **Yes** — industry data step |')
            elif name == 'pnl' and self.pnl_step:
                out.append(f'| `{name}.csv` | {desc} ({len(rows)} lines) | **Yes** — P&L step |')
            else:
                out.append(f'| `{name}.csv` | {desc} ({len(rows)} rows) | **No** — it is already inside `documents/99-data-room-extracts.pdf`, which you upload |')
        for name, desc, _ in pdfs:
            out.append(f'| `documents/{name}.pdf` | {desc} | **Yes** — documents step |')
        out += ['| `bidders.csv` | The three bidding firms for Part B: who to invite, what each asks and offers | **No** — read it while you follow Part B |',
                '| `documents/*.md` | The text each PDF is built from | **No** — never |',
                '| `vdr-index.csv` | Index of every file, as a data room would list it | **No** — reference only |']
        if self.notes:
            out += ['', '## Notes', ''] + [f'- {n}' for n in self.notes]
        return '\n'.join(out) + '\n'

# Extracts a built pack imports directly (Sources → Industry data), by file
# name, with the target's label as Pactlab shows it. Kept in step with the
# pack registry by apps/api/src/ops/demo-data.test.ts.
PACK_IMPORTS = {
    'fintech': {'loan-tape': 'Loan tape', 'aml-alerts': 'AML alerts', 'processor-volume': 'Processor volume', 'licence-register': 'Licence and sponsor register'},
    'multifamily': {'rent-roll': 'Rent roll', 't12': 'T-12 operating statement', 'delinquency': 'Delinquency report', 'unit-inspections': 'Unit inspections',
                    'occupancy-history': 'Occupancy and rent history', 'rent-roll-history': 'Rent roll snapshots'},
    'healthcare': {'claims-summary': 'Claims summary', 'provider-roster': 'Provider roster', 'remittances': 'Remittances by payer', 'clinician-collections': 'Collections by clinician', 'credentialing-register': 'Credentialing register', 'payer-contracts': 'Payer contract register'},
    'telecom-media': {'subscribers-by-month': 'Subscribers by month', 'subscriber-movements': 'Subscriber movements', 'rights-register': 'Rights and carriage register',
                      'revenue-by-counterparty': 'Advertising and affiliate revenue', 'capex-by-year': 'Capital expenditure by year'},
    'professional-services': {'timesheets-summary': 'Timesheets summary', 'headcount-movements': 'Headcount movements', 'time-billing': 'Time and billing', 'wip-ar-ageing': 'WIP and debtor ageing'},
    'pharma-biotech': {'patent-schedule': 'Patent schedule', 'trial-registry': 'Trial registry records', 'pipeline': 'Pipeline', 'obligations-model': 'Payment obligations model', 'rd-roster': 'R&D roster'},
    'ecommerce-dtc': {'orders-by-cohort': 'Orders by cohort', 'ad-spend': 'Ad spend', 'channel-orders': 'Orders by channel', 'inventory': 'Stock report'},
    'commercial-property': {'rent-roll': 'Commercial rent roll', 'cam-reconciliation': 'CAM reconciliation'},
    'hotels': {'operating-history': 'Operating history', 'str-benchmark': 'STR benchmark'},
    'small-clinics': {'patient-volume': 'Patient volume', 'equipment-schedule': 'Equipment schedule', 'coding-summary': 'Coding summary', 'remittances': 'Remittances by payer',
                      'clinician-collections': 'Collections by clinician', 'credentialing-register': 'Credentialing register', 'payer-contracts': 'Payer contract register',
                      'service-lines': 'Service lines by provider', 'referrals': 'Visits by referral source'},
    'hospitals': {'census': 'Census', 'payer-mix': 'Payer mix'},
    'venture-raise': {'cap-table': 'Cap table', 'monthly-financials': 'Monthly financials'},
    'multifamily-syndication': {'rent-roll': 'Rent roll', 't12': 'T-12 operating statement', 'delinquency': 'Delinquency report', 'unit-inspections': 'Unit inspections',
                                'occupancy-history': 'Occupancy and rent history', 'rent-roll-history': 'Rent roll snapshots', 'track-record': 'Sponsor track record'},
    'music-rights': {'works-register': 'Works register', 'writer-splits': 'Writer splits', 'chain-of-title': 'Chain of title', 'royalty-statements': 'Royalty statements'},
    'energy-generation': {'plant-register': 'Plant register', 'interest-register': 'Interest register', 'lease-schedule': 'Lease schedule', 'production-history': 'Production history', 'liability-schedule': 'Liability schedule'},
    'startup-spv': {'cap-table': 'Cap table', 'monthly-financials': 'Monthly financials'},
}

# What Pactlab's "What kind of company is it?" shows (COMPANY_TYPE_LABELS in
# @pactlab/domain); kept in step by apps/api/src/ops/demo-data.test.ts.
COMPANY_TYPE_LABELS = {
    'software-saas': 'Software & SaaS', 'fintech': 'Fintech', 'healthcare': 'Healthcare & health tech',
    'telecom-media': 'Telecom & media', 'professional-services': 'Professional services', 'pharma-biotech': 'Pharma & biotech',
    'ecommerce-dtc': 'E-commerce & DTC', 'multifamily': 'Multifamily', 'commercial-property': 'Commercial property',
    'hotels': 'Hotels & hospitality', 'small-clinics': 'Small clinics', 'hospitals': 'Hospitals',
    'venture-raise': 'Venture Raise', 'multifamily-syndication': 'Multifamily syndication', 'music-rights': 'Music rights',
    'energy-generation': 'Energy generation & rights',
    'startup-spv': 'Startup equity SPV',
}
# The Documents tab's data-class options.
DATA_CLASS_LABELS = {'Business': 'business information', 'Financial': 'financial information'}

PACK_TITLES = {
    'software-saas': 'Software and SaaS', 'fintech': 'Fintech', 'healthcare': 'Healthcare services and healthtech',
    'telecom-media': 'Telecom and media', 'professional-services': 'IT and professional services', 'pharma-biotech': 'Pharma and biotech',
    'ecommerce-dtc': 'E-commerce and DTC', 'multifamily': 'Multifamily', 'commercial-property': 'Commercial property',
    'hotels': 'Hotels and hospitality', 'small-clinics': 'Small clinics', 'hospitals': 'Hospitals',
    'venture-raise': 'Venture Raise', 'multifamily-syndication': 'Multifamily syndication', 'music-rights': 'Music rights',
    'energy-generation': 'Energy generation and rights',
    'startup-spv': 'Startup equity SPV',
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
    northgate = next(mo for _, n, mo in ds.customers if n.startswith('Northgate'))[LAST] / (ds.billed_arr() / 12)
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
''', 'Northgate Logistics contract, with a change-of-control clause')
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
        ('Customer can terminate on change of control', f'`documents/02-master-services-agreement-northgate.pdf` page 2, clause 14 — Northgate Logistics ({pct(northgate)} of September 2026 billed revenue) may leave if the company is sold.'),
        ('Contraction hidden in the logo count', 'Amberline Hotels (synthetic) pays 30.0% less from April 2026; the KPI pack reports 14 active customers, billing has 13 in September 2026.'),
    ]
    ds.notes = ['Code and delivery data (GitHub, Jira) connect through their APIs, never files. The synthetic Brightwave repository and Jira site in the Engineering step are built into local and dev Pactlab; production connects the real ones.']
    ds.engineering = True

KIND_TITLE = {'money_transmitter': 'money-transmitter licence', 'payment_institution': 'payment-institution licence', 'e_money': 'e-money licence', 'lending': 'lending licence'}

def fintech(ds):
    ds.kind, ds.kind_label = 'platform_fee', 'merchant platform fee'
    ds.summary = f'{ds.company} runs a payments and working-capital platform for independent retailers, earning monthly platform fees and lending to merchants through a partner bank.'
    rng = ds.rng
    sponsor_ref = 'SBA-2023-0412'
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
BSA/AML programme: transaction-monitoring procedure for {ds.company} (synthetic).

Every alert must be reviewed by a compliance analyst before closure. The analyst records the evidence reviewed and the rationale in the case file.
''', 'Written AML alert-handling procedure')
    ds.doc('03-partner-bank-agreement', f'''
Program agreement between {ds.c["bank"]} (synthetic) and {ds.company}
---page---
22.3 The Bank may terminate this agreement on ninety days' notice if the Program Manager undergoes a change of control without the Bank's prior written consent.
---page---
8.2 The Program Manager shall keep the chargeback ratio, measured each calendar quarter as chargebacks divided by settled transactions by count, below 0.90%.
8.3 Fraud losses shall not exceed 0.15% of processed volume in any calendar quarter.
This agreement, reference {sponsor_ref}, expires on 31 March 2028 unless renewed.
''', 'Partner-bank program agreement, with its monitoring thresholds and term')
    ds.findings = [
        ('Allowance below observed loss experience', f'the balance sheet carries a 2.0% allowance ({money(c, allowance)}); `loan-tape.csv` shows charge-offs of {pct(loss_rate)} of originated principal.'),
        ('Alerts closed without review evidence', f'{unreviewed} of 80 closed alerts in `aml-alerts.csv` have `review_evidence = no`, against the procedure in `documents/02-aml-procedure.pdf`.'),
        ('Partner bank can terminate on change of control', '`documents/03-partner-bank-agreement.pdf` page 2, clause 22.3 — consent needed before closing.'),
    ]
    # --- Payments (T-159): processor exports, the licence register, compliance evidence and a three-year P&L.
    procs = [('Northpass Processing (synthetic)', D('9000000'), D('0.022')), ('Keystone Acquiring (synthetic)', D('5000000'), D('0.026'))]
    cb_rates = [D('0.0042'), D('0.0045'), D('0.0049'), D('0.0053'), D('0.0058'), D('0.0066'), D('0.0078'), D('0.0094')]   # by quarter; the last breaches 0.90%
    fraud_rates = [D('0.00062'), D('0.00058'), D('0.00065'), D('0.00060'), D('0.00066'), D('0.00061'), D('0.00067'), D('0.00063')]
    vol_rows, by_key = [], {}
    # Five years (T-184): the export runs back to January 2021 so every calendar year FY2021–FY2025 is whole. The
    # earlier months come from their own random generator, so the last 24 months are unchanged; take rate
    # compresses every year (planted (e)).
    hrng = random.Random(f'fintech-history:{ds.cur}')
    hist_months = []
    hy, hm = 2021, 1
    while (hy, hm) < (2024, 10):
        hist_months.append(f'{hy}-{hm:02d}'); hm += 1
        if hm == 13: hy, hm = hy + 1, 1
    hist_take = {'2021': D('0.0110'), '2022': D('0.0102'), '2023': D('0.0096'), '2024': D('0.0091')}
    hist_cb = {'2021': D('0.0050'), '2022': D('0.0054'), '2023': D('0.0049'), '2024': D('0.0046')}
    hist_fraud = {'2021': D('0.00060'), '2022': D('0.00064'), '2023': D('0.00059'), '2024': D('0.00062')}
    for pi, (pname, base, growth) in enumerate(procs):
        back = D('1.016') if pi == 0 else D('1.018')
        for k, mo in enumerate(hist_months):
            v = base / back ** (len(hist_months) - k)
            vol = whole(ds.amt(v) * (D(1) + D(hrng.randint(-10, 10)) / 1000))
            ticket = D(62) + D(hrng.randint(-20, 20)) / 10
            tx = whole(vol / ds.amt(ticket))
            net = q(vol * (hist_take[mo[:4]] + D(hrng.randint(-4, 4)) / 100000))
            cbs = whole(tx * hist_cb[mo[:4]])
            cba = q(cbs * ds.amt(ticket))
            fraud = q(vol * hist_fraud[mo[:4]])
            vol_rows.append([mo, pname, f'{vol:.2f}', f'{tx:.0f}', f'{net:.2f}', f'{cbs:.0f}', f'{cba:.2f}', f'{fraud:.2f}'])
            by_key[(mo, pname)] = (vol, net)
        v = base
        for i, mo in enumerate(MONTHS):
            vol = whole(ds.amt(v) * (D(1) + D(rng.randint(-10, 10)) / 1000))
            ticket = D(62) + D(rng.randint(-20, 20)) / 10
            tx = whole(vol / ds.amt(ticket))
            net = q(vol * (D('0.0085') + D(rng.randint(-4, 4)) / 100000))
            cbs = whole(tx * cb_rates[i // 3])
            cba = q(cbs * ds.amt(ticket))
            fraud = q(vol * fraud_rates[i // 3])
            vol_rows.append([mo, pname, f'{vol:.2f}', f'{tx:.0f}', f'{net:.2f}', f'{cbs:.0f}', f'{cba:.2f}', f'{fraud:.2f}'])
            by_key[(mo, pname)] = (vol, net)
            v = v * (D(1) + growth)
    ds.ext('processor-volume', ['month', 'processor', 'gross_volume', 'transactions', 'net_revenue', 'chargeback_count', 'chargeback_amount', 'fraud_losses'], vol_rows,
           'Processor settlement exports by month, January 2021 to September 2026: volume, transactions, net revenue, chargebacks and fraud losses')
    trailing = sum((by_key[(mo, p)][0] for mo in LAST12 for p, _, _ in procs), D(0))
    prior = sum((by_key[(mo, p)][0] for mo in MONTHS[:12] for p, _, _ in procs), D(0))
    net12 = sum((by_key[(mo, p)][1] for mo in LAST12 for p, _, _ in procs), D(0))
    doubled_month, doubled_proc = '2026-03', procs[0][0]
    deck_tpv = trailing + by_key[(doubled_month, doubled_proc)][0]
    tpv_growth = ((trailing / prior - 1) * 100).quantize(D('1'), ROUND_HALF_UP)
    take = (net12 / trailing * 100).quantize(D('0.01'), ROUND_HALF_UP)
    q3 = [r for r in vol_rows if r[0] in ('2026-07', '2026-08', '2026-09')]
    cb_q3 = sum(D(r[5]) for r in q3) / sum(D(r[3]) for r in q3)

    LIC = {
        'USD': [('MT-OH-20431', 'money_transmitter', 'Ohio', 'Ohio Division of Financial Institutions', '2021-07-01', '2027-06-30'),
                ('MT-IL-30981', 'money_transmitter', 'Illinois', 'Illinois Department of Financial and Professional Regulation', '2021-06-01', '2026-05-31'),
                ('MT-TX-11872', 'money_transmitter', 'Texas', 'Texas Department of Banking', '2022-01-15', '2027-12-31'),
                ('MT-FL-50214', 'money_transmitter', 'Florida', 'Florida Office of Financial Regulation', '2022-04-30', '2028-04-30'),
                ('CFL-CA-60778', 'lending', 'California', 'California Department of Financial Protection and Innovation', '2023-02-01', '2027-12-31'),
                ('SML-OH-70345', 'lending', 'Ohio', 'Ohio Division of Financial Institutions', '2023-03-01', '2028-02-28')],
        'EUR': [('PI-NL-20431', 'payment_institution', 'Netherlands', 'De Nederlandsche Bank', '2021-07-01', '2027-06-30'),
                ('PI-BE-30981', 'payment_institution', 'Belgium', 'National Bank of Belgium', '2021-06-01', '2026-05-31'),
                ('PI-FR-11872', 'payment_institution', 'France', 'ACPR', '2022-01-15', '2027-12-31'),
                ('EM-IE-50214', 'e_money', 'Ireland', 'Central Bank of Ireland', '2022-04-30', '2028-04-30'),
                ('CR-DE-60778', 'lending', 'Germany', 'BaFin', '2023-02-01', '2027-12-31'),
                ('CR-NL-70345', 'lending', 'Netherlands', 'Netherlands Authority for the Financial Markets', '2023-03-01', '2028-02-28')],
        'GBP': [('PI-UK-20431', 'payment_institution', 'United Kingdom', 'Financial Conduct Authority', '2021-07-01', '2027-06-30'),
                ('PI-IE-30981', 'payment_institution', 'Ireland', 'Central Bank of Ireland', '2021-06-01', '2026-05-31'),
                ('EM-GI-11872', 'e_money', 'Gibraltar', 'Gibraltar Financial Services Commission', '2022-01-15', '2027-12-31'),
                ('PI-JE-50214', 'payment_institution', 'Jersey', 'Jersey Financial Services Commission', '2022-04-30', '2028-04-30'),
                ('CC-UK-60778', 'lending', 'United Kingdom', 'Financial Conduct Authority', '2023-02-01', '2027-12-31'),
                ('CC-NI-70345', 'lending', 'Northern Ireland', 'Financial Conduct Authority', '2023-03-01', '2028-02-28')],
    }[ds.cur]
    lic_rows = [[lid, kind, jur, auth, 'active', issued, exp] for lid, kind, jur, auth, issued, exp in LIC]
    lic_rows.append([sponsor_ref, 'sponsor_bank', ds.c['country'], f'{ds.c["bank"]} (synthetic)', 'active', '2023-04-01', '2028-03-31'])
    ds.ext('licence-register', ['licence_id', 'kind', 'jurisdiction', 'authority', 'status', 'issued_on', 'expires_on'], lic_rows, 'Licence and sponsor-bank register as the company keeps it')
    lapsed = LIC[1]
    kind_word = {'money_transmitter': 'money transmitter licence', 'payment_institution': 'payment institution authorisation', 'e_money': 'e-money authorisation', 'lending': 'lending licence'}

    # Five fiscal years of P&L (T-184), by year across the columns; payments revenue is the exports' net revenue
    # for each calendar year. Fraud losses grow faster than revenue every year (planted (d)).
    fees_2025 = sum((mo.get(m, D(0)) for _, _, mo in ds.customers for m in MONTHS if m.startswith('2025-')), D(0))
    loans_2025 = ds.amt(1200000)
    fy = ['2021', '2022', '2023', '2024', '2025']
    years = [f'FY{y}' for y in fy]
    proc = [q(sum((D(r[4]) for r in vol_rows if r[0].startswith(y)), D(0))) for y in fy]
    fees = [q(fees_2025 * f) for f in (D('0.38'), D('0.49'), D('0.62'), D('0.81'), D('1'))]
    loan_rev = [q(loans_2025 * f) for f in (D('0.30'), D('0.42'), D('0.58'), D('0.79'), D('1'))]
    rev = [proc[i] + fees[i] + loan_rev[i] for i in range(5)]
    ratios = {
        'Cost of processing (processor platform fees)': ([D('0.178'), D('0.181'), D('0.180'), D('0.175'), D('0.182')], proc),
        'Fraud losses': ([D('0.004'), D('0.005'), D('0.006'), D('0.010'), D('0.017')], rev),
        'Credit losses on merchant loans': ([D('0.029'), D('0.031'), D('0.030'), D('0.028'), D('0.031')], rev),
        'Staff costs': ([D('0.33'), D('0.32'), D('0.32'), D('0.30'), D('0.29')], rev),
        'Technology': ([D('0.10'), D('0.10'), D('0.10'), D('0.10'), D('0.09')], rev),
        'Sales and marketing': ([D('0.12'), D('0.12'), D('0.12'), D('0.13'), D('0.12')], rev),
        'General and administrative': ([D('0.075'), D('0.07'), D('0.07'), D('0.065'), D('0.06')], rev),
    }
    pnl_rows = [['Payment processing revenue'] + [f'{x:.2f}' for x in proc], ['Platform fee revenue'] + [f'{x:.2f}' for x in fees], ['Merchant loan revenue'] + [f'{x:.2f}' for x in loan_rev]]
    for name, (rs, base) in ratios.items():
        pnl_rows.append([name] + [f'{q(base[i] * rs[i]):.2f}' for i in range(5)])
    fraud = [q(rev[i] * ratios['Fraud losses'][0][i]) for i in range(5)]
    ds.ext('pnl', ['Line'] + years, pnl_rows, 'Profit and loss by fiscal year, FY2021 to FY2025')
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2021 to FY2025).',
                   '2. Say what each line is: the three lines ending in *revenue* are **Revenue**, `Cost of processing (processor platform fees)` is **Cost of revenue**, and the rest are **Operating expenses**.',
                   f'3. **Check every row**, then **Import {len(pnl_rows) * 5} rows**.', '',
                   '**You should see:** the import succeed. The **Payments** tab now shows the P&L year by year, **Finances** shows the five years side by side, and the checks in the next step read every year.', '']
    def take_of(y):
        rows = [r for r in vol_rows if r[0].startswith(y)]
        return sum((D(r[4]) for r in rows), D(0)) / sum((D(r[2]) for r in rows), D(0))
    takes = [take_of(y) for y in fy]

    ds.doc('04-investor-presentation', f'''
{ds.company} — investor presentation, September 2026 (synthetic demo data).

Total payment volume (TPV), twelve months to September 2026: {money(c, deck_tpv)}.
TPV grew {tpv_growth}% year on year.
Effective take rate: {take}% of payment volume.
Net revenue retention: 116%.
''', 'Investor presentation with TPV, growth, take-rate and retention claims')
    ds.doc('05-licence-' + lapsed[2].lower().replace(' ', '-'), f'''
{lapsed[2]} {kind_word[lapsed[1]]} (synthetic).

Issued by {lapsed[3]} to {ds.company}.
Licence number {lapsed[0]} was issued on 1 June 2021 and expires on 31 May 2026.
Renewal must be filed before the expiry date.
''', f'{lapsed[2]} licence certificate, with its expiry date')
    ds.doc('06-pci-attestation', f'''
PCI DSS Attestation of Compliance for {ds.company} (synthetic).

Date of attestation: 14 March 2026.
Assessed entity: {ds.company}, service provider level 2. Qualified security assessor: Ridgecrest Assurance (synthetic).
''', 'PCI DSS attestation of compliance')
    ds.doc('07-report-of-examination', f'''
Report of examination of {ds.company} (synthetic).

Examination date: 12 February 2026.
The examination reviewed the money-services programme, complaint handling and record keeping. Findings are listed in the appendix for management's response.
''', 'Regulatory report of examination')
    ds.findings += [
        ('Claim contradicted: Total payment volume', f'the investor presentation states {money(c, deck_tpv)} for the twelve months to September 2026; `processor-volume.csv` gives {money(c, trailing)} — the gap is {doubled_proc}\'s March 2026 volume ({money(c, by_key[(doubled_month, doubled_proc)][0])}), counted twice.'),
        ('Claim verified: TPV growth', f'{tpv_growth}% year on year, recomputed from the exports.'),
        ('Claim verified: Take rate', f'{take}%: net revenue ÷ processed volume, twelve months to September 2026.'),
        ('Claim not verified: Retention', 'net revenue retention of 116%: the processor exports carry no merchant identities to recompute it from.'),
        (f'Lapsed: {lapsed[2]} {KIND_TITLE[lapsed[1]]} ({lapsed[0]})', f'`documents/05-licence-{lapsed[2].lower().replace(" ", "-")}.pdf` — it expired on 31 May 2026, four months before the latest processor month; `licence-register.csv` still records it as active.'),
        ('Chargeback rate breaches the stated threshold, 2026-Q3', f'{(cb_q3 * 100).quantize(D("0.01"), ROUND_HALF_UP)}% of settled transactions in July–September 2026, against the 0.90% in clause 8.2 of `documents/03-partner-bank-agreement.pdf` (page 3).'),
        ('P&L trend, 2021–2025', 'every imported year side by side: revenue, growth, margins and the fraud, credit-loss and processing ratios.'),
        ('Fraud losses growing faster than revenue, 2021–2025', f'`pnl.csv` — fraud losses rise from {pct(ratios["Fraud losses"][0][0])} of revenue in FY2021 to {pct(ratios["Fraud losses"][0][4])} in FY2025 ({money(c, fraud[0])} to {money(c, fraud[4])}); FY2025 alone looks small.'),
        ('Effective take rate falling every year, FY2021–FY2025', f'`processor-volume.csv` — net revenue ÷ volume by calendar year: ' + ', '.join(f'FY{y} {(t * 100).quantize(D("0.01"), ROUND_HALF_UP)}%' for y, t in zip(fy, takes)) + '. Volume grows; each dollar of it earns less (five-year history, T-184).'),
    ]
    ds.notes = ds.notes + ['The P&L (`pnl.csv`) imports through Sources like any extract; the multi-year checks read every year it holds. A single year still imports: the trend then reports that year alone.']

def healthcare(ds):
    ds.kind, ds.kind_label = 'reimbursement', 'payer remittance'
    ds.summary = f'{ds.company} operates nine physical-therapy and primary-care practices, paid mostly by government programmes and commercial insurers.'
    payers = [('Government programme A', 52000), ('Government programme B', 21000), ('Commercial plan North', 17000), ('Commercial plan Central', 12000), ('Commercial plan Coast', 8000), ('Self-pay and other', 5000)]
    for i, (n, base) in enumerate(payers):
        ds.customer(f'{ds.prefix}-pay-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.006', noise=D('0.03')))
    gov = sum(mo[LAST] for _, n, mo in ds.customers if n.startswith('Government')) / (ds.billed_arr() / 12)
    rng = ds.rng
    c = ds.cur
    # --- Remittances (T-160): January 2021 to September 2026 (five years, T-184b), by month and payer. From
    # October 2024 the cash collected is the billed revenue above; before it the mix leans to commercial payers
    # and drifts toward Government programme B (Medicaid), the lowest-paying class per claim (planted (c)).
    # Months before 2023 come from their own random generator, so the later rows are unchanged.
    hrng = random.Random(f'healthcare-history:{ds.cur}')
    r_months, (yy, mm) = [], (2021, 1)
    while (yy, mm) <= (2026, 9):
        r_months.append(f'{yy}-{mm:02d}'); mm += 1
        if mm == 13: yy, mm = yy + 1, 1
    klass = {'Government programme A': 'medicare', 'Government programme B': 'medicaid', 'Commercial plan North': 'commercial', 'Commercial plan Central': 'commercial', 'Commercial plan Coast': 'commercial', 'Self-pay and other': 'self_pay'}
    yield_usd = {'medicare': D('96'), 'medicaid': D('61'), 'commercial': D('142'), 'self_pay': D('84')}
    denial_factor = {'medicare': D('1.0'), 'medicaid': D('1.25'), 'commercial': D('0.9'), 'self_pay': D('0.6')}
    denial_year = {'2021': D('0.040'), '2022': D('0.051'), '2023': D('0.062'), '2024': D('0.079'), '2025': D('0.096'), '2026': D('0.104')}   # rising every year (planted (a))
    start_share = {'Government programme A': D('0.44'), 'Government programme B': D('0.09'), 'Commercial plan North': D('0.195'), 'Commercial plan Central': D('0.14'), 'Commercial plan Coast': D('0.095'), 'Self-pay and other': D('0.04')}
    first_billed = MONTHS[0]
    billing_total0 = sum(mo[first_billed] for _, _, mo in ds.customers)
    end_share = {n.replace(' (synthetic)', ''): mo[first_billed] / billing_total0 for _, n, mo in ds.customers}
    early_share = {'Government programme A': D('0.43'), 'Government programme B': D('0.06'), 'Commercial plan North': D('0.21'), 'Commercial plan Central': D('0.15'), 'Commercial plan Coast': D('0.105'), 'Self-pay and other': D('0.045')}
    hist = [m for m in r_months if m < '2023-01']
    pre = [m for m in r_months if '2023-01' <= m < first_billed]
    remit = []   # [month, payer, class, claims, denied, billed, collected, ar]
    for mo in r_months:
        g = rng if mo >= '2023-01' else hrng
        if mo >= first_billed:
            amounts = {n.replace(' (synthetic)', ''): q(m2[mo]) for _, n, m2 in ds.customers}
        elif mo >= '2023-01':
            k = pre.index(mo)
            t = D(k) / D(len(pre))
            total = billing_total0 / (D('1.006') ** (len(pre) - k))
            amounts = {n: q(total * (start_share[n] + (end_share[n] - start_share[n]) * t)) for n, _ in payers}
        else:
            j = hist.index(mo)
            t = D(j) / D(len(hist))
            total = billing_total0 / (D('1.006') ** (len(pre) + len(hist) - j))
            amounts = {n: q(total * (early_share[n] + (start_share[n] - early_share[n]) * t)) for n, _ in payers}
        for n, _ in payers:
            cl = klass[n]
            collected = amounts[n]
            claims = whole(collected / (ds.amt(yield_usd[cl]) * (D(1) + D(g.randint(-15, 15)) / 1000)))
            denied = whole(claims * denial_year[mo[:4]] * denial_factor[cl])
            billed = q(collected * D('1.38'))
            ar = q(billed * D(41) / D('30.4') * (D(1) + D(g.randint(-20, 20)) / 1000))
            remit.append([mo, f'{n} (synthetic)', cl, claims, denied, billed, collected, ar])
    ds.ext('remittances', ['month', 'payer', 'payer_class', 'claims', 'denied_claims', 'billed', 'collected', 'ar_balance'],
           [[r[0], r[1], r[2], f'{r[3]:.0f}', f'{r[4]:.0f}', f'{r[5]:.2f}', f'{r[6]:.2f}', f'{r[7]:.2f}'] for r in remit],
           'Remittances by month and payer: claims, denials, charges billed, cash collected and receivables at month end')
    def year_of(y): return [r for r in remit if r[0].startswith(y)]
    def denial(y):
        rows = year_of(y)
        return sum(r[4] for r in rows) / sum(r[3] for r in rows)
    def commercial_share(y):
        rows = year_of(y)
        return sum(r[6] for r in rows if r[2] == 'commercial') / sum(r[6] for r in rows)
    def medicaid_claims(y):
        rows = year_of(y)
        return sum(r[3] for r in rows if r[2] == 'medicaid') / sum(r[3] for r in rows)
    def days_in_ar(y):
        rows = year_of(y)
        return sum(r[7] for r in rows if r[0] == f'{y}-12') / (sum(r[5] for r in rows) / 365)
    # The claims summary (T-061) for the last twelve months, now read from the same remittances.
    rows = []
    for r in remit:
        if r[0] in LAST12:
            rows.append([r[0], r[1], f'{r[3]:.0f}', f'{r[5]:.2f}', f'{r[6]:.2f}', f'{(D(r[4]) / D(r[3]) * 100).quantize(D("0.1"), ROUND_HALF_UP)}'])
    ds.ext('claims-summary', ['month', 'payer', 'claims', 'billed', 'paid', 'denial_rate_pct'], rows, 'Monthly claims billed, paid and denial rate by payer')
    roster = [[f'PR-{i + 1:02d}', ['Physical therapy', 'Primary care', 'Occupational therapy'][i % 3], '1.0' if i % 4 else '0.6', f'2026-{(i % 9) + 10 if (i % 9) + 10 <= 12 else 12}-15' if i in (3, 11) else f'2027-{(i % 12) + 1:02d}-01'] for i in range(18)]
    ds.ext('provider-roster', ['provider_ref', 'specialty', 'fte', 'credential_expiry'], roster, 'Provider roster, pseudonymous, with credential expiry dates')

    # --- Collections by clinician, January 2021 to September 2026. PR-03 carries 31% of them (planted (d)).
    # Before October 2025 (T-184b) the collections follow the remittances, and the collected per visit rises each
    # year faster than collections grow, so visits fall every year (planted (e)); the last twelve months are unchanged.
    per_visit = {'2021': D(70), '2022': D(79), '2023': D(88), '2024': D(98), '2025': D(108)}
    sites = ['Northgate', 'Riverside', 'Eastfield', 'Millbrook', 'Westcourt', 'Harbour Road', 'Elmstead', 'Fairview', 'Southpark']
    weights = {r[0]: D(r[2]) * (D(1) + D(rng.randint(-10, 10)) / 100) for r in roster if r[0] != 'PR-03'}
    wsum = sum(weights.values())
    refs = sorted(weights)
    clin = []
    for mo in r_months:
        total = sum(r[6] for r in remit if r[0] == mo)
        amounts = {'PR-03': q(total * D('0.31'))}
        rest = total - amounts['PR-03']
        for ref in refs[:-1]:
            amounts[ref] = q(rest * weights[ref] / wsum)
        amounts[refs[-1]] = total - sum(amounts.values())
        for i, r in enumerate(roster):
            ref = r[0]
            clin.append([mo, ref, f'{sites[i % 9]} practice (synthetic)', f'{whole(amounts[ref] / ds.amt(108 if mo in LAST12 else per_visit[mo[:4]])):.0f}', f'{amounts[ref]:.2f}'])
    ds.ext('clinician-collections', ['month', 'provider_ref', 'site', 'visits', 'collected'], clin, 'Collections by clinician and month, pseudonymous, from the practice-management system, January 2021 to September 2026')
    star_total = sum(D(r[4]) for r in clin if r[1] == 'PR-03' and r[0] in LAST12)
    clin_total = sum(D(r[4]) for r in clin if r[0] in LAST12)
    def year_visits(y): return sum(int(r[3]) for r in clin if r[0].startswith(y))

    # --- The credentialing register: a state licence per clinician, controlled-substance registrations for primary care.
    juris = {'USD': 'Ohio', 'EUR': 'Netherlands', 'GBP': 'England'}[c]
    board = {'Physical therapy': 'physical therapy', 'Primary care': 'medical', 'Occupational therapy': 'occupational therapy'}
    month_names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    lapsed = {'PR-07': ('2026-04-30', '30 April 2026', '2027-04-30'), 'PR-15': ('2026-06-30', '30 June 2026', '2027-06-30')}   # planted (b)
    creds, verify = [], []
    for i, r in enumerate(roster):
        ref, spec = r[0], r[1]
        expiry = f'{2027 + i % 2}-{(i % 12) + 1:02d}-28'
        creds.append([f'CR-{i + 1:02d}01', ref, 'state_licence', juris, f'{juris} {board[spec]} licensing board (synthetic)', 'active', lapsed[ref][2] if ref in lapsed else expiry])
        if spec == 'Primary care':
            creds.append([f'CR-{i + 1:02d}02', ref, 'controlled_substance', juris, 'Controlled-substance registry (synthetic)', 'active', f'2028-{(i % 12) + 1:02d}-28'])
        if ref in lapsed:
            verify.append(f'{ref}: {board[spec]} licence, {juris} — expired on {lapsed[ref][1]}; no renewal on the board\'s register at the date of verification.')
        else:
            y, m_, d_ = expiry.split('-')
            verify.append(f'{ref}: {board[spec]} licence, {juris} — active, expires on {int(d_)} {month_names[int(m_) - 1]} {y}.')
    ds.ext('credentialing-register', ['credential_ref', 'provider_ref', 'kind', 'jurisdiction', 'issuer', 'status', 'expires_on'], creds, 'Credentialing register as the practice keeps it: licences and registrations by pseudonymous clinician')
    # Collections recorded in the months after each lapsed licence's expiry.
    after = {ref: sum(D(x[4]) for x in clin if x[1] == ref and f'{x[0]}-01' > lapsed[ref][0]) for ref in lapsed}

    # --- The payer contract register.
    contracts = [
        ['MCR-ENR-4410', 'Government programme A (synthetic)', 'medicare', '2016-01-01', '', 'no'],
        ['MCD-ENR-2207', 'Government programme B (synthetic)', 'medicaid', '2018-07-01', '2029-06-30', 'no'],
        ['PA-NORTH-2024', 'Commercial plan North (synthetic)', 'commercial', '2024-04-01', '2027-03-31', 'no'],
        ['PA-CENTRAL-2022', 'Commercial plan Central (synthetic)', 'commercial', '2022-01-01', '2026-12-31', 'yes'],
        ['PA-COAST-2023', 'Commercial plan Coast (synthetic)', 'commercial', '2023-01-01', '2027-12-31', 'no'],
    ]
    ds.ext('payer-contracts', ['contract_id', 'payer', 'payer_class', 'effective_on', 'expires_on', 'auto_renews'], contracts, 'Payer contract and enrolment register')
    trailing_total = sum(r[6] for r in remit if r[0] in LAST12)
    north_share = sum(r[6] for r in remit if r[0] in LAST12 and r[1].startswith('Commercial plan North')) / trailing_total

    # --- Five fiscal years of P&L (T-184b), by year across the columns. Patient revenue is the cash collected;
    # denial write-offs grow faster than revenue every year, which a single year misses (planted (a), the P&L side).
    years = ['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']
    patient = [sum((r[6] for r in year_of(y[2:])), D(0)) for y in years]
    other = [q(ds.amt(18000) * D(f)) for f in ('0.92', '0.96', '1', '1.04', '1.08')]
    rev = [patient[i] + other[i] for i in range(5)]
    ratios = {
        'Cost of care: clinical staff': [D('0.53'), D('0.525'), D('0.52'), D('0.515'), D('0.51')],
        'Cost of care: medical supplies': [D('0.06'), D('0.06'), D('0.06'), D('0.06'), D('0.059')],
        'Denial write-offs and bad debt': [D('0.010'), D('0.013'), D('0.018'), D('0.026'), D('0.039')],
        'Billing and collection costs': [D('0.040'), D('0.040'), D('0.040'), D('0.041'), D('0.040')],
        'Rent and occupancy': [D('0.09'), D('0.088'), D('0.085'), D('0.082'), D('0.080')],
        'General and administrative': [D('0.098'), D('0.094'), D('0.090'), D('0.084'), D('0.076')],
    }
    pnl_rows = [['Net patient service revenue'] + [f'{x:.2f}' for x in patient], ['Other operating revenue'] + [f'{x:.2f}' for x in other]]
    for name, rs in ratios.items():
        pnl_rows.append([name] + [f'{q(rev[i] * rs[i]):.2f}' for i in range(5)])
    writeoffs = [q(rev[i] * ratios['Denial write-offs and bad debt'][i]) for i in range(5)]
    ds.ext('pnl', ['Line'] + years, pnl_rows, 'Profit and loss by fiscal year, FY2021 to FY2025')
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2021 to FY2025).',
                   '2. Say what each line is: the two lines ending in *revenue* are **Revenue**, the two `Cost of care` lines are **Cost of revenue**, and the rest are **Operating expenses**.',
                   f'3. **Check every row**, then **Import {len(pnl_rows) * 5} rows**.', '',
                   '**You should see:** the import succeed. The **Practice** tab now shows the P&L year by year next to collections; **Finances** shows the five years side by side with visits, the commercial share and the denial rate, and the checks in the next step read every year.', '']

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
    deck_ar = days_in_ar('2025').quantize(D('1'), ROUND_HALF_UP)
    ds.doc('03-management-presentation', f'''
{ds.company} — management presentation, September 2026 (synthetic demo data).

Nine practices and 18 clinicians across {juris}.
Claim denial rate fell from 8.4% in FY2023 to 6.1% in FY2025.
Commercial payers were 41% of collections in FY2025.
Days in accounts receivable at 31 December 2025: {deck_ar} days.
''', 'Management presentation with denial-rate, payer-mix and days-in-AR claims')
    verified = '\n'.join(verify)
    ds.doc('04-licence-verification', f'''
Licence verification report for {ds.company} (synthetic).

Verified on 28 September 2026 against the issuing boards' public registers. Clinicians are listed by the practice's pseudonymous reference.
---page---
{verified}
''', 'Primary-source verification of every clinician\'s licence, by pseudonymous reference')
    ds.doc('05-restrictive-covenants-schedule', f'''
Schedule 4.12: restrictive covenants — clinicians bound by a non-compete or retention agreement ({ds.company}, synthetic).

PR-01: non-compete, 24 months within 15 miles of any practice, signed 2021.
PR-02: retention agreement to December 2027.
PR-05: non-compete, 18 months within 10 miles, signed 2022.
PR-08: non-compete, 24 months within 15 miles, signed 2023.
No other clinician is listed in this schedule.
''', 'Disclosure schedule of the clinicians bound by a non-compete or retention agreement')
    ds.doc('06-coding-and-billing-audit', f'''
Coding and billing audit — {ds.company} (synthetic).

Audit date: 12 June 2026. Reviewer: Lakeside Revenue Integrity (synthetic).
A sample of 200 claims across the nine practices was reviewed against the documentation on file; coding accuracy in the sample was 94.5%.
''', 'External coding and billing audit report')
    ds.doc('07-payer-contract-commercial-north', f'''
Provider agreement between Commercial plan North (synthetic) and {ds.company}.

Term: 1 April 2024 to 31 March 2027; renewal by mutual written agreement only.
Reimbursement: 118% of the government programme fee schedule, reviewed annually.
''', 'Provider agreement with Commercial plan North')

    ds.findings = [
        ('Revenue concentrated in government programmes', f'government programmes A and B are {pct(gov)} of September 2026 revenue in `invoice-lines.csv`.'),
        ('Medical-director fee above documented duties', '`documents/01-medical-director-agreement.pdf` — a fixed fee for four hours a month, against 1.5 documented hours (page 2).'),
        ('Privacy risk assessment out of date', '`documents/02-privacy-risk-assessment.pdf` — last assessed March 2023, review overdue since March 2024.'),
        ('Provider credentials expiring', 'two providers in `provider-roster.csv` have credentials expiring before the end of 2026.'),
        ('Claim contradicted: Denial rate', f'the management presentation says the denial rate fell from 8.4% to 6.1%; `remittances.csv` shows it rose: {pct(denial("2023"))} in 2023, {pct(denial("2024"))} in 2024, {pct(denial("2025"))} in 2025.'),
        ('Denial rate rising, 2021–2025', f'denied ÷ adjudicated claims in `remittances.csv`, up every year from {pct(denial("2021"))} to {pct(denial("2025"))}; one year alone looks like one figure.'),
        ('Claim contradicted: Commercial payer share', f'the presentation says 41% of FY2025 collections came from commercial payers; `remittances.csv` gives {pct(commercial_share("2025"))}.'),
        ('Payer mix shifted toward Medicaid, the lowest-paying payer class, 2021–2025', f'Government programme B (Medicaid) went from {pct(medicaid_claims("2021"))} of claims in 2021 to {pct(medicaid_claims("2025"))} in 2025, and pays least per claim.'),
        ('Claim verified: Days in accounts receivable', f'{deck_ar} days at 31 December 2025, recomputed from the receivables and charges in `remittances.csv` ({days_in_ar("2025").quantize(D("0.1"), ROUND_HALF_UP)}).'),
        ('Practising on an expired licence: PR-07', f'`documents/04-licence-verification.pdf` (page 2) — the licence expired on 30 April 2026; the register still says active to April 2027, and `clinician-collections.csv` records {money(c, after["PR-07"])} collected on PR-07\'s claims since.'),
        ('Practising on an expired licence: PR-15', f'the licence expired on 30 June 2026; {money(c, after["PR-15"])} collected since.'),
        ('31.0% of collections from one clinician, no non-compete on file: PR-03', f'PR-03 collected {money(c, star_total)} of {money(c, clin_total)} in the twelve months to September 2026; `documents/05-restrictive-covenants-schedule.pdf` does not list PR-03.'),
        ('Payer contract ends within a year: Commercial plan North (synthetic)', f'`payer-contracts.csv` — PA-NORTH-2024 ends on 31 March 2027 with no automatic renewal; the payer is {pct(north_share)} of trailing collections.'),
        ('Visits falling every year, FY2021–FY2025', f'`clinician-collections.csv` — visits by calendar year: {", ".join(f"FY{y} {year_visits(y):,}" for y in ["2021", "2022", "2023", "2024", "2025"])}, while collections grew; the growth is collected per visit, not patients.'),
        ('P&L trend, 2021–2025', 'every imported year side by side: revenue, growth, margins and the denial write-off, clinical staff, supplies and billing ratios.'),
        ('Denial write-offs and bad debt growing faster than revenue, 2021–2025', f'`pnl.csv` — from {pct(ratios["Denial write-offs and bad debt"][0])} of revenue in FY2021 to {pct(ratios["Denial write-offs and bad debt"][4])} in FY2025 ({money(c, writeoffs[0])} to {money(c, writeoffs[4])}); FY2025 alone looks small.'),
    ]
    assert denial('2021') < denial('2022') < denial('2023') < denial('2024') < denial('2025'), 'denials must rise every year'
    assert days_in_ar('2025') - days_in_ar('2021') < 5, 'days in AR must not drift'
    assert year_visits('2021') > year_visits('2022') > year_visits('2023') > year_visits('2024') > year_visits('2025'), 'visits must fall every year'
    ds.notes = ['Provider data is pseudonymous and aggregate by design; Pactlab never sends people data to a model.',
                '`remittances.csv` and `clinician-collections.csv` run January 2021 to September 2026, so each of FY2021–FY2025 is a complete year (five years of history, read side by side on **Finances**).',
                'The P&L (`pnl.csv`) imports through Sources like any extract; the multi-year checks read every year it holds. A single year still imports: the trend then reports that year alone.',
                'Diligence support only: the pack checks documents, dates and arithmetic. It does not assess the quality of care or whether billing, referrals or the expired licences are lawful.']

def telecom(ds):
    ds.kind, ds.kind_label = 'subscriber_plan', 'region-and-plan subscriber billing'
    ds.summary = f'{ds.company} is a regional fibre broadband and streaming-TV provider selling residential and small-business plans in four regions, with a regional sports channel carried by other distributors.'
    c = ds.cur
    regions = [('North', 5200), ('Central', 3100), ('Lakes', 1900), ('Valley', 1450)]
    plans = [('Fibre 500', 42), ('Fibre 1000', 58), ('Fibre + TV', 79)]
    # Subscriber movements (T-168) run January 2021 to September 2026 (five years, T-184b), so FY2021–FY2025 are
    # complete years. Churn before October 2024 climbs every year (planted (e)); from October 2024 it is unchanged.
    OM = []
    yy, mm = 2021, 1
    while (yy, mm) <= (2026, 9):
        OM.append(f'{yy}-{mm:02d}'); mm += 1
        if mm == 13: yy, mm = yy + 1, 1
    HIST_CHURN = {'2021': D('0.0066'), '2022': D('0.0073'), '2023': D('0.0079'), '2024': D('0.0084')}
    def churn_of(mo): return D('0.017') if mo >= '2026-01' else D('0.009') if mo >= '2024-10' else HIST_CHURN[mo[:4]]
    subs_rows, move_rows, billed_last = [], [], 0
    for r, (reg, n0) in enumerate(regions):
        for p, (plan, arpu) in enumerate(plans):
            cid = f'{ds.prefix}-{reg[:3].lower()}-{p + 1}'
            monthly, closing = {}, {}
            base = D(n0) * D([0.5, 0.3, 0.2][p])
            n = base
            for i, mo in enumerate(MONTHS):
                n = n * (D(1) + D('0.012') - churn_of(mo))
                subs = int(n)
                closing[mo] = subs
                monthly[mo] = ds.amt(arpu) * subs
                if mo in LAST12: subs_rows.append([mo, reg, plan, subs, f'{ds.amt(arpu):.2f}'])
                if mo == LAST: billed_last += subs
            ds.customer(cid, f'{reg} region — {plan} subscribers (synthetic)', monthly)
            # Before October 2024 the base grew 0.3% a month (1.2% added, 0.9% lost): the same series, run back.
            first = OM.index(MONTHS[0])
            for j, mo in enumerate(OM[:first]):
                closing[mo] = int(base / (D('1.003') ** (first - 1 - j)))
            opening = int(base / (D('1.003') ** first))
            for mo in OM:
                close = closing[mo]
                disc = int((D(opening) * churn_of(mo)).quantize(D('1'), ROUND_HALF_UP))
                move_rows.append([mo, reg, plan, opening, close - opening + disc, disc, close, f'{q(ds.amt(arpu) * close):.2f}'])
                opening = close
    move_rows.sort(key=lambda row: (row[0], row[1], row[2]))
    ds.ext('subscribers-by-month', ['month', 'region', 'plan', 'billed_subscribers', 'arpu'], subs_rows, 'Billed subscribers and ARPU by region and plan')
    ds.ext('subscriber-movements', ['month', 'region', 'plan', 'opening_subscribers', 'gross_adds', 'disconnects', 'closing_subscribers', 'service_revenue'], move_rows,
           'Subscriber movements by month, region and plan from the billing system: opening, gross additions, disconnects, closing and service revenue')
    reported = int(billed_last * 1.064)
    north = sum(mo[LAST] for _, n, mo in ds.customers if n.startswith('North')) / (ds.billed_arr() / 12)

    # What the movements give, as the checks read them (trailing twelve months to September 2026).
    trail = [row for row in move_rows if row[0] in LAST12]
    t_open = sum(row[3] for row in trail); t_disc = sum(row[5] for row in trail)
    t_rev = sum((D(row[7]) for row in trail), D(0)); t_sm = sum((D(row[3] + row[6]) / 2 for row in trail), D(0))
    churn = D(t_disc) / D(t_open)
    arpu = (t_rev / t_sm).quantize(CENT, ROUND_HALF_UP)

    # Advertising and affiliate revenue by counterparty. One advertiser is 34% of ad revenue (planted (c)); the
    # four distributors carrying the sports channel are spread, the largest Rivermark Cable at 27%.
    advertisers = [('Brightline Motors', D('0.34')), ('Harbour Home Furnishings', D('0.15')), ('Quarry Lane Insurance', D('0.13')), ('Tallgrass Grocers', D('0.11')),
                   ('Northbank Credit Union', D('0.10')), ('Cedar Point Auto Group', D('0.09')), ('Lakeshore Health', D('0.08'))]
    distributors = [('Rivermark Cable', D('0.27')), ('Harborview Cable', D('0.26')), ('Lakeshore Telecom', D('0.24')), ('Summit Fibre', D('0.23'))]
    ad_total, aff_total, stream_rows, by_counterparty = {}, {}, [], {}
    for i, mo in enumerate(OM):
        back = len(OM) - 1 - i
        ad_total[mo] = D(0); aff_total[mo] = D(0)
        for stream, total, parties in (('advertising', ds.amt(D(118000) / (D('1.004') ** back)), advertisers), ('affiliate', ds.amt(D(250000) / (D('1.002') ** back)), distributors)):
            for name, weight in parties:
                amount = q(total * weight)
                (ad_total if stream == 'advertising' else aff_total)[mo] += amount
                if mo in MONTHS: stream_rows.append([mo, stream, f'{name} (synthetic)', f'{amount:.2f}'])
                if mo in LAST12: by_counterparty[(stream, name)] = by_counterparty.get((stream, name), D(0)) + amount
    ds.ext('revenue-by-counterparty', ['month', 'stream', 'counterparty', 'amount'], stream_rows, 'Advertising and affiliate revenue by month and counterparty, from the ad-sales and affiliate statements')
    ad_trailing = sum((v for (st, _n), v in by_counterparty.items() if st == 'advertising'), D(0))
    bright = by_counterparty[('advertising', 'Brightline Motors')]
    billed_trailing = sum((mo[m] for _, _, mo in ds.customers for m in LAST12 if m in mo), D(0))
    base_revenue = billed_trailing + sum(by_counterparty.values(), D(0))

    # The rights and carriage register. The seller's register says AF-01 runs to 2028; the agreement itself
    # says it expires on 30 September 2027, nine months after the expected closing (planted (b)).
    rivermark = by_counterparty[('affiliate', 'Rivermark Cable')]
    register = [
        ['AF-01', 'Rivermark Cable (synthetic)', 'affiliate', 'receivable', f'{rivermark:.2f}', '2022-10-01', '2028-09-30', 'no'],
        ['AF-02', 'Harborview Cable (synthetic)', 'affiliate', 'receivable', f'{by_counterparty[("affiliate", "Harborview Cable")]:.2f}', '2023-01-01', '2029-12-31', 'no'],
        ['AF-03', 'Lakeshore Telecom (synthetic)', 'affiliate', 'receivable', f'{by_counterparty[("affiliate", "Lakeshore Telecom")]:.2f}', '2022-07-01', '2027-08-31', 'yes'],
        ['AF-04', 'Summit Fibre (synthetic)', 'affiliate', 'receivable', f'{by_counterparty[("affiliate", "Summit Fibre")]:.2f}', '2024-04-01', '2028-03-31', 'no'],
        ['CA-01', 'Summit Entertainment Networks (synthetic)', 'carriage', 'payable', f'{ds.amt(1100000):.2f}', '2023-01-01', '2028-12-31', 'no'],
        ['SR-01', 'Northern Lakes Hockey League (synthetic)', 'sports_rights', 'payable', f'{ds.amt(650000):.2f}', '2024-07-01', '2029-06-30', 'no'],
        ['CL-01', 'Lakeview Studios (synthetic)', 'content_licence', 'payable', f'{ds.amt(180000):.2f}', '2025-05-01', '2027-04-30', 'no'],
    ]
    ds.ext('rights-register', ['agreement_id', 'counterparty', 'kind', 'flow', 'annual_value', 'starts_on', 'ends_on', 'auto_renews'], register,
           'Rights and carriage register: content, affiliate, carriage and sports-rights agreements with their annual value and dates')

    # Five fiscal years of P&L (T-184b). Revenue ties to the movements and the statements; content costs climb
    # while ARPU stays flat (planted (d)).
    years = ['2021', '2022', '2023', '2024', '2025']
    sub_rev = {y: sum((D(row[7]) for row in move_rows if row[0].startswith(y)), D(0)) for y in years}
    ad_rev = {y: sum((v for mo, v in ad_total.items() if mo.startswith(y)), D(0)) for y in years}
    aff_rev = {y: sum((v for mo, v in aff_total.items() if mo.startswith(y)), D(0)) for y in years}
    rev = {y: sub_rev[y] + ad_rev[y] + aff_rev[y] for y in years}
    CONTENT = {'2021': D('0.16'), '2022': D('0.18'), '2023': D('0.20'), '2024': D('0.245'), '2025': D('0.29')}
    content = {y: q(rev[y] * CONTENT[y]) for y in years}
    network = {y: q(rev[y] * D('0.17')) for y in years}
    carriage = {y: q(rev[y] * D('0.08')) for y in years}
    marketing = {y: q(rev[y] * D('0.06')) for y in years}
    general = {y: q(rev[y] * D('0.09')) for y in years}
    pnl_rows = [['Subscription revenue'] + [f'{sub_rev[y]:.2f}' for y in years],
                ['Advertising revenue'] + [f'{ad_rev[y]:.2f}' for y in years],
                ['Affiliate fee revenue'] + [f'{aff_rev[y]:.2f}' for y in years],
                ['Cost of content and programming'] + [f'{content[y]:.2f}' for y in years],
                ['Cost of network operations'] + [f'{network[y]:.2f}' for y in years],
                ['Cost of carriage and retransmission fees'] + [f'{carriage[y]:.2f}' for y in years],
                ['Marketing and subscriber acquisition'] + [f'{marketing[y]:.2f}' for y in years],
                ['General and administrative'] + [f'{general[y]:.2f}' for y in years]]
    ds.ext('pnl', ['Line'] + [f'FY{y}' for y in years], pnl_rows, 'Profit and loss by fiscal year, FY2021 to FY2025')
    def gm(y): return (rev[y] - content[y] - network[y] - carriage[y]) / rev[y]
    def om(y): return (rev[y] - content[y] - network[y] - carriage[y] - marketing[y] - general[y]) / rev[y]
    def year_rows(y): return [row for row in move_rows if row[0].startswith(y)]
    def sub_months(y): return sum((D(row[3] + row[6]) / 2 for row in year_rows(y)), D(0))
    def year_arpu(y): return sum((D(row[7]) for row in year_rows(y)), D(0)) / sub_months(y)
    def content_per_sub(y): return content[y] / sub_months(y)
    def year_churn(y): return D(sum(row[5] for row in year_rows(y))) / D(sum(row[3] for row in year_rows(y)))
    # Capital expenditure by year, steady against revenue (no planted defect).
    capex_rows = []
    for y in years:
        for category, part in (('network', D('0.14')), ('customer_premises', D('0.04')), ('it', D('0.015')), ('content', D('0.01'))):
            capex_rows.append([y, category, f'{q(rev[y] * part):.2f}'])
    ds.ext('capex-by-year', ['year', 'category', 'amount'], capex_rows, 'Capital expenditure by fiscal year and category, FY2021 to FY2025')
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2021 to FY2025).',
                   '2. Say what each line is: the three lines ending in *revenue* are **Revenue**, the three lines starting *Cost of* are **Cost of revenue**, and the rest are **Operating expenses**.',
                   f'3. **Check every row**, then **Import {len(pnl_rows) * 5} rows**.', '',
                   '**You should see:** the import succeed. The **Subscribers** tab now shows the P&L year by year and content cost per subscriber against ARPU; **Finances** shows the five years side by side with subscribers, churn and ARPU, and the checks in the next step read every year.', '']

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
    ds.doc('03-investor-presentation', f'''
{ds.company} — investor presentation, September 2026 (synthetic demo data).

We billed {billed_last:,} subscribers on 30 September 2026.
Average monthly churn was 0.9% over the twelve months to September 2026.
ARPU was {c} {arpu:.2f} a month over the same twelve months, with prices unchanged since 2023.
Northlake Sports Network is carried by four distributors under long-term affiliation agreements.
The expected closing date is 31 December 2026.
''', 'Investor presentation with the subscriber, churn and ARPU claims and the expected closing date')
    ds.doc('04-affiliation-agreement-rivermark', f'''
Affiliation agreement AF-01 — Northlake Sports Network ({ds.company}) and Rivermark Cable (synthetic).
---page---
14.1 Term. Agreement AF-01 expires on 30 September 2027.
14.2 Renewal. Agreement AF-01 does not renew automatically; any renewal needs a new written agreement signed by both parties.
''', 'Affiliation agreement with Rivermark Cable, the largest distributor of the sports channel')
    ds.findings = [
        ('Reported subscribers exceed billed subscribers', f'the KPI pack reports {reported:,}; `subscribers-by-month.csv` bills {billed_last:,} in September 2026.'),
        ('Churn rising against the reported rate', 'billed subscribers grow about 0.3% a month until December 2025, then shrink about 0.5% a month from January 2026 (`invoice-lines.csv`, `subscribers-by-month.csv`); the KPI pack still reports 0.9% churn.'),
        ('Regional concentration', f'the North region is {pct(north)} of September 2026 revenue.'),
        ('Wholesale price review ahead', '`documents/02-wholesale-network-agreement.pdf` page 2, clause 9 — next re-pricing 1 January 2027.'),
        ('Claim verified: Subscribers', f'the investor presentation says {billed_last:,} billed subscribers; `subscriber-movements.csv` closes September 2026 at {billed_last:,}.'),
        ('Claim contradicted: Monthly churn', f'the investor presentation says 0.9% a month; `subscriber-movements.csv` gives {pct(churn)} a month over the twelve months to September 2026 (disconnects ÷ opening subscribers).'),
        ('Claim verified: ARPU', f'the investor presentation says {c} {arpu:.2f} a month; `subscriber-movements.csv` gives the same over the twelve months to September 2026.'),
        ('Material agreement ends within 12 months of the closing: AF-01', f'`documents/04-affiliation-agreement-rivermark.pdf` page 2 — AF-01 expires on 30 September 2027 and does not renew automatically, nine months after the 31 December 2026 closing (the register says 2028). It is {pct(rivermark / base_revenue)} of trailing revenue.'),
        ('Advertising revenue concentrated in one counterparty: Brightline Motors (synthetic)', f'`revenue-by-counterparty.csv` — Brightline Motors is {pct(bright / ad_trailing)} of advertising revenue over the twelve months to September 2026.'),
        ('Content costs rising against flat ARPU, 2021–2025', f'`pnl.csv` and `subscriber-movements.csv` — content cost per subscriber a month {", ".join(f"{y} {content_per_sub(y):.2f}" for y in years)} against ARPU {", ".join(f"{y} {year_arpu(y):.2f}" for y in years)}. A single year shows only that year.'),
        ('Monthly churn rising every year, FY2021–FY2025', f'`subscriber-movements.csv` — disconnects ÷ opening subscribers by calendar year: {", ".join(f"FY{y} {year_churn(y) * 100:.2f}%" for y in years)}. The trailing twelve months alone do not show it.'),
        ('P&L trend, 2021–2025', 'every imported year side by side: revenue, growth, margins and the content, network, carriage and marketing ratios.'),
        ('Gross margin and Operating margin down across 2021–2025', f'`pnl.csv` — gross margin {pct(gm("2021"))} to {pct(gm("2025"))}, operating margin {pct(om("2021"))} to {pct(om("2025"))}.'),
        ('Content and programming costs growing faster than revenue, 2021–2025', f'`pnl.csv` — {pct(CONTENT["2021"])} of revenue in FY2021 to {pct(CONTENT["2025"])} in FY2025.'),
    ]
    ds.notes = ['Subscribers appear only as counts by region and plan, never as people; advertisers and distributors are businesses.',
                '`subscriber-movements.csv` runs January 2021 to September 2026, so each of FY2021–FY2025 is a complete year (five years of history, read side by side on **Finances**); its service revenue ties to the P&L\'s subscription revenue year by year.',
                'The agreement governs over the register: `rights-register.csv` gives AF-01 an end of 2028-09-30, the agreement itself 30 September 2027.',
                'The P&L (`pnl.csv`) imports through Sources like any extract; the multi-year checks read every year it holds. A single year still imports: the trend then reports that year alone.']

def services(ds):
    ds.kind, ds.kind_label = 'retainer', 'client fee'
    ds.summary = f'{ds.company} is a 140-person digital and data consultancy working on retainers and projects for enterprise clients.'
    rng = ds.rng
    c = ds.cur
    # --- Time and billing (T-167): January 2021 to September 2026 (five years, T-184b), one row per month, client and fee-earner.
    # Months before 2023 come from their own random generator, so the later rows are unchanged.
    # Fee-earners are pseudonymous references (P- partners, C- consultants); each client's relationship
    # partner bills 40% of its fees. Meridian is about 27% of fees against the deck's 15% ceiling (planted (a)).
    hrng = random.Random(f'services-history:{ds.cur}')
    OM = []
    yy, mm = 2021, 1
    while (yy, mm) <= (2026, 9):
        OM.append(f'{yy}-{mm:02d}'); mm += 1
        if mm == 13: yy, mm = yy + 1, 1
    clients = [  # name, relationship partner, consultant, engagement, Sep-2026 monthly fees (USD)
        ('Meridian Retail Group', 'P-01', 'C-01', 'retainer', 81000),
        ('Seabright Leisure', 'P-01', 'C-02', 'time_and_materials', 21000),
        ('Halcyon Mutual', 'P-02', 'C-03', 'managed_service', 42000),
        ('Lumen Education Trust', 'P-02', 'C-04', 'project', 24000),
        ('Carraway Foods', 'P-02', 'C-05', 'retainer', 15000),
        ('Brookfield Transit', 'P-03', 'C-06', 'project', 36000),
        ('Kestrel Pharma Services', 'P-03', 'C-07', 'project', 24000),
        ('Oakmont Utilities', 'P-04', 'C-08', 'retainer', 36000),
        ('Northwind Councils', 'P-05', 'C-09', 'project', 21000),
    ]
    # Realization (fees ÷ standard value) falls every year (planted (b)); a single year looks unremarkable.
    REAL = {'2021': D('0.95'), '2022': D('0.935'), '2023': D('0.92'), '2024': D('0.87'), '2025': D('0.81'), '2026': D('0.80')}
    RATE = {'Partner': ds.amt(350), 'Consultant': ds.amt(160)}
    tb_rows, fees = [], {}
    for name, partner, consultant, engagement, base in clients:
        for i, mo in enumerate(OM):
            back = len(OM) - 1 - i
            month_fees = ds.amt(D(base) / (D('1.008') ** back)) * (D(1) + D((rng if mo >= '2023-01' else hrng).randint(-20, 20)) / 1000)
            yr = mo[:4]
            for ref, grade, part in ((partner, 'Partner', D('0.4')), (consultant, 'Consultant', D('0.6'))):
                billed = q(month_fees * part)
                standard = q(billed / REAL[yr])
                worked = (standard / RATE[grade]).quantize(D('0.1'), ROUND_HALF_UP)
                hours_billed = (worked * (REAL[yr] + D('0.04'))).quantize(D('0.1'), ROUND_HALF_UP)
                collected = q(billed * D('0.97'))
                tb_rows.append([mo, f'{name} (synthetic)', engagement, ref, grade, partner, f'{worked}', f'{hours_billed}', f'{standard:.2f}', f'{billed:.2f}', f'{collected:.2f}'])
                fees[(mo, name)] = fees.get((mo, name), D(0)) + billed
    ds.ext('time-billing', ['month', 'client', 'engagement', 'fee_earner', 'grade', 'relationship_partner', 'hours_worked', 'hours_billed', 'standard_value', 'billed', 'collected'], tb_rows,
           'Time and billing by month, client, engagement and fee-earner (pseudonymous): hours, standard value, fees billed and collected')
    # Billing is the clients' fees, October 2024 to September 2026.
    for i, (name, *_rest) in enumerate(clients):
        ds.customer(f'{ds.prefix}-cli-{i + 1:03d}', f'{name} (synthetic)', {mo: fees[(mo, name)] for mo in MONTHS})
    # Timesheets: five years (T-184b). Before October 2025 they come from their own generator; utilization
    # falls every year (planted (e)), and the last twelve months are unchanged.
    UTIL = {'2021': D('0.74'), '2022': D('0.715'), '2023': D('0.69'), '2024': D('0.67'), '2025': D('0.65')}
    HC = {'2021': (52, 28, 18), '2022': (55, 30, 19), '2023': (58, 31, 20), '2024': (60, 33, 21), '2025': (62, 34, 22)}
    rows = []
    for mo in OM:
        if mo in LAST12: continue
        for (team, _hc), hc in zip((('Engineering', 62), ('Data', 34), ('Design', 22)), HC[mo[:4]]):
            avail = hc * 140; billable = int(avail * (UTIL[mo[:4]] + D(hrng.randint(-5, 5)) / 1000))
            rows.append([mo, team, hc, avail, billable])
    for mo in LAST12:
        for team, hc in (('Engineering', 62), ('Data', 34), ('Design', 22)):
            avail = hc * 140; billable = int(avail * (0.62 + rng.randint(0, 5) / 100))
            rows.append([mo, team, hc, avail, billable])
    trail_ts = [r for r in rows if r[0] in LAST12]
    util = D(sum(r[4] for r in trail_ts)) / D(sum(r[3] for r in trail_ts))
    def year_util(y): return D(sum(r[4] for r in rows if r[0].startswith(y))) / D(sum(r[3] for r in rows if r[0].startswith(y)))
    ds.ext('timesheets-summary', ['month', 'team', 'headcount', 'available_hours', 'billable_hours'], rows, 'Available and billable hours by team (aggregate), January 2021 to September 2026')
    hm = []
    for i, mo in enumerate(LAST12):
        hm.append([mo, 'Delivery', 2 + i % 2, 1 + (i // 3), 118 + i % 3])
        hm.append([mo, 'Support functions', 1, 0 + (i % 2), 22])
    ds.ext('headcount-movements', ['month', 'role_family', 'starters', 'leavers', 'headcount'], hm, 'Starters, leavers and headcount by role family (aggregate)')

    # Trailing twelve months, as the checks read them.
    trail = [r for r in tb_rows if r[0] in LAST12]
    total = sum((D(r[9]) for r in trail), D(0))
    by_client, by_partner = {}, {}
    for r in trail:
        by_client[r[1]] = by_client.get(r[1], D(0)) + D(r[9])
        by_partner[r[5]] = by_partner.get(r[5], D(0)) + D(r[9])
    top_client, top_fees = max(by_client.items(), key=lambda kv: kv[1])
    top_partner, partner_fees = max(by_partner.items(), key=lambda kv: kv[1])
    recurring = sum((D(r[9]) for r in trail if r[2] in ('retainer', 'managed_service')), D(0))
    def year_rows(y): return [r for r in tb_rows if r[0].startswith(y)]
    def realization(y): return sum((D(r[9]) for r in year_rows(y)), D(0)) / sum((D(r[8]) for r in year_rows(y)), D(0))

    # WIP and debtor ageing at each year end. WIP over 90 days doubles from 2024 to 2025 (planted (d)).
    def month_fees_of(mo): return sum((fees[(mo, n)] for n, *_rest in clients), D(0))
    ageing, over = [], {}
    SPLIT = {'wip': [D('0.55'), D('0.22'), D('0.12'), D('0.07'), D('0.04')], 'ar': [D('0.60'), D('0.25'), D('0.08'), D('0.05'), D('0.02')]}
    for y in ['2023', '2024', '2025']:
        f = month_fees_of(f'{y}-12')
        for ledger, times in (('wip', D('1.3')), ('ar', D('1.1'))):
            amounts = [q(f * times * part) for part in SPLIT[ledger]]
            if ledger == 'wip' and y == '2025':
                late = q(over[('wip', '2024')] * D('2.1'))
                first = q(late * D('0.64'))
                amounts = amounts[:3] + [first, late - first]
            over[(ledger, y)] = amounts[3] + amounts[4]
            for band, amount in zip(['0-30', '31-60', '61-90', '91-180', '181+'], amounts):
                ageing.append([f'{y}-12-31', ledger, band, f'{amount:.2f}'])
    ds.ext('wip-ar-ageing', ['as_of', 'ledger', 'band', 'amount'], ageing, 'WIP and debtor ageing by band at each year end, FY2023 to FY2025')
    wip_factor = over[('wip', '2025')] / over[('wip', '2024')]
    wip_increase = over[('wip', '2025')] - over[('wip', '2024')]

    # Five fiscal years of P&L (T-184b). Fees tie to the export; staff cost follows the time worked, so the margin
    # falls as realization does, and write-offs outpace revenue.
    years = ['2021', '2022', '2023', '2024', '2025']
    def ysum(y, kinds=None, col=9): return sum((D(r[col]) for r in year_rows(y) if kinds is None or r[2] in kinds), D(0))
    rev = {y: ysum(y) for y in years}
    WO = {'2021': D('0.006'), '2022': D('0.008'), '2023': D('0.010'), '2024': D('0.016'), '2025': D('0.026')}
    staff = {y: q(ysum(y, col=8) * D('0.48')) for y in years}
    subs = {y: q(rev[y] * D('0.08')) for y in years}
    other = {y: q(rev[y] * D('0.015')) + q(rev[y] * D('0.07')) + q(rev[y] * D('0.05')) + q(rev[y] * WO[y]) for y in years}
    pnl_rows = [['Retainer and managed-service fee revenue'] + [f'{ysum(y, ("retainer", "managed_service")):.2f}' for y in years],
                ['Project fee revenue'] + [f'{ysum(y, ("project", "time_and_materials")):.2f}' for y in years],
                ['Cost of fee-earner salaries'] + [f'{staff[y]:.2f}' for y in years],
                ['Cost of subcontractors'] + [f'{subs[y]:.2f}' for y in years],
                ['WIP and bad-debt write-offs'] + [f'{q(rev[y] * WO[y]):.2f}' for y in years],
                ['Recruitment'] + [f'{q(rev[y] * D("0.015")):.2f}' for y in years],
                ['Rent and office'] + [f'{q(rev[y] * D("0.07")):.2f}' for y in years],
                ['Business development and general'] + [f'{q(rev[y] * D("0.05")):.2f}' for y in years]]
    ds.ext('pnl', ['Line'] + [f'FY{y}' for y in years], pnl_rows, 'Profit and loss by fiscal year, FY2021 to FY2025')
    def gm(y): return (rev[y] - staff[y] - subs[y]) / rev[y]
    def om(y): return (rev[y] - staff[y] - subs[y] - other[y]) / rev[y]
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2021 to FY2025).',
                   '2. Say what each line is: the two lines ending in *revenue* are **Revenue**, the two lines starting *Cost of* are **Cost of revenue**, and the rest are **Operating expenses**.',
                   f'3. **Check every row**, then **Import {len(pnl_rows) * 5} rows**.', '',
                   '**You should see:** the import succeed. The **Practice** tab now shows the P&L year by year, reconciled to the billing export; **Finances** shows the five years side by side with utilization, realization and headcount, and the checks in the next step read every year.', '']

    top, share = ds.share_top()
    ds.doc('01-management-pack-2026-09', f"""
{ds.company} — management pack, September 2026 (synthetic)

Billable utilization, trailing twelve months: 78%
Voluntary attrition: stable
""", 'Management pack with reported utilization')
    ds.doc('02-msa-meridian', f"""
Master services agreement — {ds.company} and Meridian Retail Group (synthetic)
---page---
18.2 Termination for convenience. The Client may terminate this agreement, or any statement of work, for convenience on sixty days' written notice.
""", 'Master services agreement with the largest client')
    ds.doc('03-information-memorandum', f"""
{ds.company} — information memorandum, September 2026 (synthetic demo data).

A diversified book: no client exceeds 15% of fees.
No partner relationship accounts for more than 40% of fees.
Most of the work is recurring, under retainers and managed services.
""", 'Information memorandum with the concentration ceilings')
    ds.doc('04-covenant-register', f"""
Restrictive covenant register for {ds.company} (synthetic), as provided by the seller.

P-03: non-solicitation of clients and staff for 12 months after leaving.
P-04: non-compete within the firm's sectors for 6 months, and non-solicitation of clients for 12 months.
P-01 and P-02: no non-compete or non-solicitation covenant; their partnership agreements predate the register.
""", 'Register of the non-compete and non-solicitation covenants binding partners, by pseudonymous reference')
    ds.findings = [
        ('Utilization below the reported level', f'the management pack reports 78%; `timesheets-summary.csv` gives {pct(util)} over the last twelve months.'),
        ('Largest client terminable for convenience', f'{top} is {pct(share)} of September 2026 revenue and can terminate on sixty days\' notice (`documents/02-msa-meridian.pdf` page 2, clause 18.2).'),
        ('Rising attrition in delivery roles', 'monthly delivery leavers rise from 1 to 4 across the year in `headcount-movements.csv`.'),
        ('Claim contradicted: Client concentration ceiling', f'the information memorandum says no client exceeds 15% of fees; `time-billing.csv` gives {top_client} {pct(top_fees / total)} of fees billed in the twelve months to September 2026.'),
        ('Claim verified: Partner concentration ceiling', f'the largest partner book ({top_partner}, the clients whose relationship they hold) is {pct(partner_fees / total)} of fees, under the stated 40%.'),
        ('Realization falling every year, 2021–2025', f'`time-billing.csv` — fees ÷ standard value {", ".join(f"{y} {pct(realization(y))}" for y in years)}. A single year looks unremarkable.'),
        (f'WIP over 90 days up {wip_factor.quantize(D("0.1"), ROUND_HALF_UP)}× in a year, 2024–2025', f'`wip-ar-ageing.csv` — WIP older than 90 days {money(c, over[("wip", "2024")])} at 2024-12-31, {money(c, over[("wip", "2025")])} at 2025-12-31; the {money(c, wip_increase)} increase is priced into working capital.'),
        ('Rainmaker with no non-solicit or non-compete on file: P-01', f'P-01\'s book is {pct(by_partner["P-01"] / total)} of fees; `documents/04-covenant-register.pdf` states P-01 has no covenant.'),
        ('Rainmaker with no non-solicit or non-compete on file: P-02', f'P-02\'s book is {pct(by_partner["P-02"] / total)} of fees; the same register states P-02 has no covenant.'),
        (f'Revenue quality: {pct(recurring / total)} recurring, twelve months to September 2026', 'retainers and managed services against projects and time and materials, from `time-billing.csv`.'),
        ('Utilization falling every year, FY2021–FY2025', f'`timesheets-summary.csv` — billable ÷ available hours by calendar year: {", ".join(f"FY{y} {year_util(y) * 100:.2f}%" for y in years)}. The trailing twelve months alone do not show it.'),
        ('P&L trend, 2021–2025', 'every imported year side by side: revenue, growth, margins and the staff, subcontractor, write-off and recruitment ratios.'),
        ('Gross margin and Operating margin down across 2021–2025', f'`pnl.csv` — gross margin {pct(gm("2021"))} to {pct(gm("2025"))}, operating margin {pct(om("2021"))} to {pct(om("2025"))}.'),
        ('WIP and bad-debt write-offs growing faster than revenue, 2021–2025', f'`pnl.csv` — {pct(WO["2021"])} of revenue in FY2021 to {pct(WO["2025"])} in FY2025.'),
    ]
    ds.notes = ['People data is aggregate or pseudonymous only — fee-earners are P- and C- references, never names, emails or pay; no person is assessed.',
                '`time-billing.csv` and `timesheets-summary.csv` run January 2021 to September 2026, so each of FY2021–FY2025 is a complete year (five years of history, read side by side on **Finances**); the fees tie to the P&L year by year.',
                'The P&L (`pnl.csv`) imports through Sources like any extract; the multi-year checks read every year it holds. A single year still imports: the trend then reports that year alone.']

def pharma(ds):
    ds.kind, ds.kind_label = 'royalty', 'partner royalty and supply payment'
    ds.summary = f'{ds.company} is a specialty-pharma company earning royalties and supply revenue on two marketed products, with two development programmes led by PX-410.'
    partners = [('Aldermoor Therapeutics — royalties on Product A', 410000), ('Aldermoor Therapeutics — supply of Product A', 160000), ('Kingsway Health — royalties on Product B', 95000), ('Tessaly Pharma — licence fee', 40000)]
    for i, (n, base) in enumerate(partners):
        ds.customer(f'{ds.prefix}-par-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.005', noise=D('0.05')))
    # Five years of billing (T-184b): January 2021 onward, from their own random generator, so the last 24 months are
    # unchanged. Product B royalties fall every year until a step down in October 2024 (planted (e)).
    ds.billing_months = HIST_MONTHS + MONTHS
    hrng = random.Random(f'pharma-history:{ds.cur}')
    for (cid, name, monthly), (_, base) in zip(ds.customers, partners):
        for k, mo in enumerate(HIST_MONTHS):
            jitter = D(1) + D(hrng.randint(-30, 30)) / 1000
            if 'Product B' in name:
                level = D('1.75') - D('0.5') * D(k) / D(len(HIST_MONTHS) - 1)
                monthly[mo] = q(ds.amt(base) * level * jitter)
            else:
                monthly[mo] = q(ds.amt(base) / (D('1.005') ** (len(HIST_MONTHS) - k)) * jitter)
    ds.ext('patent-schedule', ['family', 'product', 'jurisdiction', 'type', 'expiry'], [
        ['PF-01', 'Product A', 'US', 'composition of matter', '2028-03-31'], ['PF-01', 'Product A', 'EP', 'composition of matter', '2028-06-30'],
        ['PF-02', 'Product A', 'US', 'formulation', '2033-11-30'], ['PF-03', 'Product B', 'US', 'method of use', '2033-08-31']], 'Patent families, products and expiry dates')
    ds.ext('pipeline', ['programme', 'indication', 'phase', 'next_milestone', 'expected'], [
        ['PX-410', 'Idiopathic pulmonary fibrosis', 'Phase 2', 'Phase 2 interim data', '2027-Q4'],
        ['PX-330', 'Dry eye', 'Phase 1', 'Phase 2 start', '2027-Q3']], 'Development pipeline: each programme\'s claimed phase and next milestone')
    # T-163: the registry records the seller supplies. The lead asset is filed as Phase 1, not the Phase 2 the pipeline claims (planted (a)).
    ds.ext('trial-registry', ['registry_id', 'programme', 'phase', 'status', 'start_date', 'primary_completion'], [
        ['CTR-2025-04101', 'PX-410', 'Phase 1', 'recruiting', '2025-03-10', '2027-02-28'],
        ['CTR-2024-03301', 'PX-330', 'Phase 1', 'completed', '2024-02-01', '2026-06-30']], 'Trial-registry records for the pipeline programmes, as filed')
    licensor = 'Brennick Biologics (synthetic)'
    phase2, phase3, fee = ds.amt(12000000), ds.amt(25000000), ds.amt(250000)
    # The seller's model of what it owes: the Phase 2 start milestone on PX-330 is missing (planted (c)).
    ds.ext('obligations-model', ['obligation_id', 'counterparty', 'kind', 'trigger', 'amount', 'rate', 'expected'], [
        ['OB-01', licensor, 'milestone', 'Phase 3 start (PX-330)', f'{phase3:.2f}', '', '2029-Q1'],
        ['OB-02', licensor, 'royalty', 'Net sales of PX-330', '', '0.06', ''],
        ['OB-03', licensor, 'licence_fee', '', f'{fee:.2f}', '', 'Annually']], 'The seller\'s model of milestones, royalties and licence fees owed')
    ds.ext('rd-roster', ['scientist_ref', 'function', 'programmes_led', 'patent_families'], [
        ['S-01', 'Discovery chemistry', '2', '3'], ['S-02', 'Clinical development', '0', '0'], ['S-03', 'Formulation', '0', '1'], ['S-04', 'Translational biology', '0', '0']],
        'R&D roster by pseudonymous reference: programmes led and patent families as inventor')
    top, share = ds.share_top()
    c = ds.cur

    # Five fiscal years of P&L (T-184b); revenue is the billing export's, year by year. R&D is flat across the
    # years while the deck brings the PX-410 readout forward (planted (d)).
    def billed(year, word):
        return sum((mo.get(m, D(0)) for _, n, mo in ds.customers for m in ds.billing_months if m.startswith(year) and word in n), D(0))
    years = ['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']
    royalty = [q(billed(y[2:], 'royalties')) for y in years]
    supply = [q(billed(y[2:], 'supply')) for y in years]
    licence = [q(billed(y[2:], 'licence fee')) for y in years]
    rev = [royalty[i] + supply[i] + licence[i] for i in range(5)]
    product_b = {y[2:]: billed(y[2:], 'Product B') for y in years}
    rd = [ds.amt(22200000), ds.amt(21900000), ds.amt(22000000), ds.amt(22300000), ds.amt(22100000)]
    pnl_rows = [['Royalty revenue'] + [f'{x:.2f}' for x in royalty], ['Product supply revenue'] + [f'{x:.2f}' for x in supply], ['Licence fee revenue'] + [f'{x:.2f}' for x in licence],
                ['Cost of product supply'] + [f'{q(supply[i] * D(r)):.2f}' for i, r in enumerate(('0.43', '0.43', '0.42', '0.42', '0.41'))],
                ['Research and development'] + [f'{x:.2f}' for x in rd],
                ['Royalties paid to licensors'] + [f'{q(rev[i] * D(r)):.2f}' for i, r in enumerate(('0.022', '0.021', '0.021', '0.020', '0.020'))],
                ['General and administrative'] + [f'{q(rev[i] * D(r)):.2f}' for i, r in enumerate(('0.21', '0.20', '0.19', '0.18', '0.17'))]]
    ds.ext('pnl', ['Line'] + years, pnl_rows, 'Profit and loss by fiscal year, FY2021 to FY2025')
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2021 to FY2025).',
                   '2. Say what each line is: the three lines ending in *revenue* are **Revenue**, `Cost of product supply` is **Cost of revenue**, and the rest are **Operating expenses**.',
                   f'3. **Check every row**, then **Import {len(pnl_rows) * 5} rows**.', '',
                   '**You should see:** the import succeed. The **Pipeline** tab shows R&D year by year, **Finances** the five years side by side with revenue by product, and the checks in the next step read every year.', '']

    ds.doc('01-revenue-forecast', f'''
{ds.company} — five-year revenue forecast (synthetic)

Product A royalties are forecast to grow 4% a year through 2031, assuming market exclusivity through 2031.
''', 'Management revenue forecast and its exclusivity assumption')
    ds.doc('02-supplier-inspection-report', f'''
Inspection close-out summary — contract manufacturer for Product A (synthetic)
---page---
Open observations: 3 (including one on cleaning validation). Corrective actions due: Q1 2027.
''', 'Contract manufacturer inspection summary')
    ds.doc('03-investor-presentation', f'''
{ds.company} — investor presentation, September 2026 (synthetic demo data).

PX-410, our lead asset, is in Phase 2 for idiopathic pulmonary fibrosis.
We have brought forward the PX-410 Phase 2 readout from 2028-Q4 to 2027-Q4.
The target closing date is 30 September 2026.
The buyer's investment case assumes a hold period of 5 years.
''', 'Investor presentation: pipeline claims, the accelerated readout, the closing date and the hold')
    ds.doc('04-fda-meeting-minutes', f'''
Minutes of the Type B meeting with the FDA on PX-410 (synthetic).

The sponsor presented the ongoing Phase 1 dose-escalation study of PX-410 (CTR-2025-04101).
The Agency asked for the completed safety data before a further protocol is submitted.
''', 'Regulatory correspondence: minutes of the FDA meeting on PX-410')
    ds.doc('05-patent-record', f'''
Patent record — {ds.company} (synthetic).

Patent family PF-01 (US), composition of matter covering Product A, is in force and expires on 31 March 2028.
Patent family PF-01 (EP), composition of matter covering Product A, is in force and expires on 30 June 2028.
Patent family PF-02 (US), a formulation patent on Product A, expires on 30 November 2033.
''', 'Patent record extract with each family\'s expiry')
    ds.doc('06-licence-agreement-brennick', f'''
Licence agreement between {ds.company} and {licensor} for PX-330.
---page---
7.1 {ds.company} shall pay {licensor} a milestone payment of {money(c, phase2)} upon the first dosing of a patient in a Phase 2 trial of PX-330.
7.2 {ds.company} shall pay {licensor} a milestone payment of {money(c, phase3)} upon the start of the first Phase 3 trial of PX-330.
8.1 {ds.company} shall pay {licensor} a royalty of 6% of net sales of PX-330.
8.4 {ds.company} shall pay {licensor} an annual licence fee of {money(c, fee)}.
''', 'In-licence of PX-330: milestones, royalty and annual fee')
    ds.doc('07-supply-agreement-halvorsen', f'''
Supply agreement between {ds.company} and Halvorsen Contract Manufacturing (synthetic).

Halvorsen Contract Manufacturing (synthetic) is the sole manufacturer of Product A.
No second source for Product A has been qualified.
''', 'Manufacturing and supply agreement for Product A')

    product_a = sum((mo.get(m, D(0)) for _, n, mo in ds.customers for m in LAST12 if 'Product A' in n), D(0))
    ds.findings = [
        ('Key patent expires earlier than the forecast assumes', 'the forecast assumes exclusivity through 2031; `patent-schedule.csv` shows the Product A composition-of-matter patents expiring in 2028.'),
        ('Open manufacturing observations at the supplier', '`documents/02-supplier-inspection-report.pdf` page 2 — three open observations.'),
        ('Partner concentration', f'Aldermoor Therapeutics accounts for both of the two largest revenue lines; the royalty line alone is {pct(share)} of September 2026 revenue.'),
        ('Claim contradicted: PX-410 phase', 'the pipeline schedule says Phase 2; `trial-registry.csv` files CTR-2025-04101 as Phase 1, and the FDA minutes (`documents/04-fda-meeting-minutes.pdf`) describe an ongoing Phase 1 study.'),
        ('Claim not verified: PX-410 timeline', 'no Phase 2 trial is registered for PX-410, so no registered date bears on the 2027-Q4 interim data.'),
        ('Claim verified: PX-330 phase', 'CTR-2024-03301 is registered as Phase 1 (completed).'),
        ('Key patent expires 18 months after closing: Product A', f'PF-01 (US) expires on 31 March 2028 (`documents/05-patent-record.pdf`), 18 months after the 30 September 2026 closing and inside the 5-year hold; priced on Product A\'s {money(c, product_a)} of trailing revenue.'),
        (f'Milestone payment omitted from the seller\'s model: {licensor}', f'clause 7.1 of `documents/06-licence-agreement-brennick.pdf` — {money(c, phase2)} on the first Phase 2 dosing of PX-330, which the pipeline expects in 2027-Q3; `obligations-model.csv` has no such line.'),
        ('Single-source manufacturing: Product A', '`documents/07-supply-agreement-halvorsen.pdf` — one manufacturer, no second source qualified.'),
        ('Key-scientist concentration: S-01', '`rd-roster.csv` — S-01 leads both programmes and is an inventor on all 3 patent families; no retention agreement is on file.'),
        ('R&D spend flat while the timeline is brought forward, 2021–2025', f'`pnl.csv` — R&D of {", ".join(money(c, x) for x in rd)} across FY2021–FY2025, while the investor presentation brings the PX-410 readout forward a year; FY2025 alone shows nothing.'),
        ('Product B revenue falling every year, FY2021–FY2025', f'`invoice-lines.csv` — the Kingsway Health royalties on Product B by calendar year: {", ".join(f"FY{y} {money(c, v)}" for y, v in product_b.items())}. The last twelve months alone show it growing.'),
        ('P&L trend, 2021–2025', 'every imported year side by side: revenue, growth, margins and the R&D, supply and royalties-paid ratios.'),
    ]
    ds.notes = ds.notes + ['`invoice-lines.csv` runs January 2021 to September 2026, so each of FY2021–FY2025 is a complete year (five years of history, read side by side on **Finances**); the P&L\'s revenue lines tie to it year by year.',
                           'The P&L (`pnl.csv`) imports through Sources like any extract; the multi-year checks read every year it holds. A single year still imports: the trend then reports that year alone.',
                           'Pactlab checks documents, dates and consistency only: it never opines on efficacy, approvability or trial design.']

def ecommerce(ds):
    ds.kind, ds.kind_label = 'channel_payout', 'sales-channel payout'
    ds.summary = f'{ds.company} sells outdoor apparel direct to consumers through its own store, one large marketplace and a few wholesale retailers.'
    rng = ds.rng
    c = ds.cur
    # --- Orders by channel (T-164): January 2021 to September 2026 (five years, T-184b), one row per month and
    # channel; months before 2023 come from their own random generator. Discounts take a larger share of gross
    # sales every year (planted (e)).
    # Net sales grow about 1.2% a month; the marketplace carries about 64% of them (planted (b)).
    # Cost of goods and fulfilment rise each year, so contribution compresses (planted (d)).
    hrng = random.Random(f'ecommerce-history:{ds.cur}')
    OM = []
    yy, mm = 2021, 1
    while (yy, mm) <= (2026, 9):
        OM.append(f'{yy}-{mm:02d}'); mm += 1
        if mm == 13: yy, mm = yy + 1, 1
    chans = [  # name, platform, account, Sep-2026 net (USD), gross order value, fee rate
        ('Marketvale marketplace', 'marketplace', 'MV-20417', 160000, D('74'), D('0.15')),
        ('Own web store', 'storefront', 'SHOP-5531', 62000, D('92'), D('0.03')),
        ('Wholesale — Trailhead Stores', 'wholesale', 'WH-TRAIL', 18000, D('1800'), D('0')),
        ('Wholesale — Fjord & Pine', 'wholesale', 'WH-FJORD', 10000, D('1500'), D('0')),
    ]
    COGS = {'2021': D('0.37'), '2022': D('0.385'), '2023': D('0.40'), '2024': D('0.42'), '2025': D('0.44'), '2026': D('0.45')}
    FUL = {'2021': D('0.097'), '2022': D('0.0985'), '2023': D('0.100'), '2024': D('0.110'), '2025': D('0.118'), '2026': D('0.120')}
    NEWSHARE = {'2021': D('0.48'), '2022': D('0.44'), '2023': D('0.40'), '2024': D('0.36'), '2025': D('0.32'), '2026': D('0.30')}
    DISC = {'2021': D('0.035'), '2022': D('0.042'), '2023': D('0.050'), '2024': D('0.060'), '2025': D('0.070'), '2026': D('0.075')}
    RET = D('0.08')
    order_rows, by = [], {}
    for name, platform, account, base, aov, fee in chans:
        for i, mo in enumerate(OM):
            back = len(OM) - 1 - i
            net_target = ds.amt(D(base) / (D('1.012') ** back)) * (D(1) + D((rng if mo >= '2023-01' else hrng).randint(-30, 30)) / 1000)
            gross = q(net_target / (D(1) - DISC[mo[:4]] - RET))
            disc, ret = q(gross * DISC[mo[:4]]), q(gross * RET)
            net = gross - disc - ret
            yr = mo[:4]
            orders = max(1, int(whole(gross / ds.amt(aov))))
            newc = '' if platform == 'wholesale' else str(int(whole(D(orders) * NEWSHARE[yr])))
            cogs = q(net * COGS[yr])
            ful = q(net * (FUL[yr] if platform != 'wholesale' else D('0.03')))
            fees = q(net * fee)
            order_rows.append([mo, name, platform, account, orders, newc, f'{gross:.2f}', f'{disc:.2f}', f'{ret:.2f}', f'{cogs:.2f}', f'{ful:.2f}', f'{fees:.2f}'])
            by[(mo, name)] = dict(platform=platform, orders=D(orders), newc=D(newc or 0), gross=gross, net=net, cogs=cogs, ful=ful, fees=fees)
    ds.ext('channel-orders', ['month', 'channel', 'platform', 'account', 'orders', 'new_customers', 'gross_sales', 'discounts', 'returns', 'cogs', 'fulfilment', 'channel_fees'], order_rows,
           'Storefront and marketplace orders by month, channel and platform account, January 2021 to September 2026: sales, returns, costs and new customers')
    # Billing is the channel payouts: each channel's net sales, October 2024 to September 2026.
    for i, (name, _, _, _, _, _) in enumerate(chans):
        ds.customer(f'{ds.prefix}-chn-{i + 1:03d}', f'{name} (synthetic)', {mo: by[(mo, name)]['net'] for mo in MONTHS})
    trailing_net = sum((by[(mo, n)]['net'] for mo in LAST12 for n, *_ in chans), D(0))
    mv_net = sum((by[(mo, chans[0][0])]['net'] for mo in LAST12), D(0))
    mv_share = mv_net / trailing_net

    # Cohorts: active customers by first-purchase cohort, twelve months each. Recent cohorts repeat less (T-065).
    rows = []
    for ci, cohort in enumerate(MONTHS[:18:3]):
        size = 2400 - ci * 60
        for k, mo in enumerate(m for m in MONTHS if m >= cohort):
            if k > 11: break
            decay = D('0.42') if ci < 3 else D('0.29')
            active = size if k == 0 else int(D(size) * decay * (D('0.93') ** k))
            rows.append([cohort, mo, k, active])
    ds.ext('orders-by-cohort', ['first_purchase_month', 'month', 'months_since_first', 'active_customers'], rows, 'Repeat purchase by first-purchase cohort')
    spend = []
    for i, mo in enumerate(LAST12):
        spend.append([mo, 'paid social', f'{ds.amt(30000 + i * 900):.2f}', 820 - i * 25])
        spend.append([mo, 'search', f'{ds.amt(18000):.2f}', 610])
    ds.ext('ad-spend', ['month', 'channel', 'spend', 'new_customers'], spend, 'Advertising spend and new customers by channel')

    # Cohort value: orders per customer over the first 12 months, from every cohort observed for all 12.
    full = [ch for ch in sorted({r[0] for r in rows}) if len([r for r in rows if r[0] == ch]) >= 12]
    size = sum((D(r[3]) for r in rows if r[0] in full and r[2] == 0), D(0))
    active = sum((D(r[3]) for r in rows if r[0] in full and r[2] < 12), D(0))
    per = active / size
    cons = [by[(mo, n)] for mo in LAST12 for n, plat, *_ in chans if plat != 'wholesale']
    c_orders = sum((x['orders'] for x in cons), D(0))
    c_gross = sum((x['gross'] for x in cons), D(0))
    c_net = sum((x['net'] for x in cons), D(0))
    c_contrib = sum((x['net'] - x['cogs'] - x['ful'] - x['fees'] for x in cons), D(0))
    ltv_gross = per * c_gross / c_orders
    ltv_contrib = per * c_contrib / c_orders
    deck_ltv = whole(ltv_gross)
    paid_spend = sum((D(r[2]) for r in spend), D(0))
    paid_new = sum((D(r[3]) for r in spend), D(0))
    deck_cac = q(paid_spend / paid_new)

    # Stock report at 30 September 2026: 22% of value received more than 180 days earlier (planted (c)).
    from datetime import date, timedelta
    as_of = date(2026, 9, 30)
    lots, fresh_value = [], D(0)
    for i in range(30):
        cost = ds.amt(rng.choice([18, 24, 31, 42, 55, 68]))
        units = rng.randint(120, 900)
        received = as_of - timedelta(days=rng.randint(10, 170))
        lots.append([f'RO-{["JKT", "FLC", "TRS", "BAS", "HAT", "PCK"][i % 6]}-{i + 1:03d}', 'Main warehouse' if i % 3 else '3PL East', units, cost, received.isoformat()])
        fresh_value += D(units) * cost
    aged_target = fresh_value * D('0.22') / D('0.78')
    aged_ages = [195, 230, 260, 310, 390, 455]
    for j, age in enumerate(aged_ages):
        cost = ds.amt([42, 55, 68, 31, 24, 55][j])
        units = int(whole(aged_target / len(aged_ages) / cost))
        lots.append([f'RO-{["JKT", "FLC", "TRS", "BAS", "HAT", "PCK"][j]}-{31 + j:03d}', 'Main warehouse', units, cost, (as_of - timedelta(days=age)).isoformat()])
    inv_rows = [[sku, loc, units, f'{cost:.2f}', rec, as_of.isoformat()] for sku, loc, units, cost, rec in lots]
    ds.ext('inventory', ['sku', 'location', 'units', 'unit_cost', 'received_on', 'as_of'], inv_rows, 'Stock report at 30 September 2026: units, landed cost and date received by SKU and location')
    inv_total = sum((D(r[2]) * D(r[3]) for r in inv_rows), D(0))
    inv_aged = sum((D(r[2]) * D(r[3]) for r in inv_rows if (as_of - date.fromisoformat(r[4])).days > 180), D(0))
    aged_share = inv_aged / inv_total

    # Five fiscal years of P&L (T-184b). Revenue ties to the orders export; advertising grows faster than revenue (planted (d)).
    years = ['2021', '2022', '2023', '2024', '2025']
    def ysum(y, key, platform=None):
        return sum((by[(mo, n)][key] for mo in OM if mo.startswith(y) for n, plat, *_ in chans if platform is None or plat == platform), D(0))
    MKT = {'2021': D('0.08'), '2022': D('0.10'), '2023': D('0.12'), '2024': D('0.145'), '2025': D('0.17')}
    rev = {y: ysum(y, 'net') for y in years}
    pnl_rows = [['Marketplace revenue'] + [f'{ysum(y, "net", "marketplace"):.2f}' for y in years],
                ['Own store revenue'] + [f'{ysum(y, "net", "storefront"):.2f}' for y in years],
                ['Wholesale revenue'] + [f'{ysum(y, "net", "wholesale"):.2f}' for y in years],
                ['Cost of goods sold'] + [f'{ysum(y, "cogs"):.2f}' for y in years],
                ['Cost of fulfilment and shipping'] + [f'{ysum(y, "ful"):.2f}' for y in years],
                ['Cost of marketplace and payment fees'] + [f'{ysum(y, "fees"):.2f}' for y in years],
                ['Advertising and marketing'] + [f'{q(rev[y] * MKT[y]):.2f}' for y in years],
                ['Staff costs'] + [f'{q(rev[y] * D("0.11")):.2f}' for y in years],
                ['Warehouse rent and general'] + [f'{q(rev[y] * D("0.05")):.2f}' for y in years]]
    ds.ext('pnl', ['Line'] + [f'FY{y}' for y in years], pnl_rows, 'Profit and loss by fiscal year, FY2021 to FY2025')
    cac_y = {y: q(rev[y] * MKT[y]) / ysum(y, 'newc') for y in years}
    def cm(y):
        cn = [by[(mo, n)] for mo in OM if mo.startswith(y) for n, plat, *_ in chans if plat != 'wholesale']
        net = sum((x['net'] for x in cn), D(0))
        return sum((x['net'] - x['cogs'] - x['ful'] - x['fees'] for x in cn), D(0)) / net
    def disc_rate(y):
        rows_y = [by[(mo, n)] for mo in OM if mo.startswith(y) for n, *_ in chans]
        return sum((x['gross'] - x['net'] for x in rows_y), D(0)) / sum((x['gross'] for x in rows_y), D(0)) - RET
    def gm(y): return (rev[y] - ysum(y, 'cogs') - ysum(y, 'ful') - ysum(y, 'fees')) / rev[y]
    def om(y): return (rev[y] * (1 - MKT[y] - D('0.16')) - ysum(y, 'cogs') - ysum(y, 'ful') - ysum(y, 'fees')) / rev[y]
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2021 to FY2025).',
                   '2. Say what each line is: the three lines ending in *revenue* are **Revenue**, the three lines starting *Cost of* are **Cost of revenue**, and the rest are **Operating expenses**.',
                   f'3. **Check every row**, then **Import {len(pnl_rows) * 5} rows**.', '',
                   '**You should see:** the import succeed. The **Channels** tab now shows the P&L year by year, reconciled to the channel exports; **Finances** shows the five years side by side with orders, order value, repeat rate and the discount rate, and the checks in the next step read every year.', '']

    ds.doc('01-marketplace-seller-terms', f'''
Marketvale seller terms — summary as accepted by {ds.company} (synthetic)
---page---
7. Marketvale may change fees, ranking or delist products on thirty days' notice.
''', 'Marketplace seller terms')
    ds.doc('02-platform-accounts', f'''
Platform accounts schedule for {ds.company} (synthetic), as provided by the seller.

Account MV-20417, the Marketvale seller account, is registered to the founder personally, not to the company.
Account SHOP-5531, the own web store on Storefront Cloud, is registered to the company.
Account AD-7702, the paid social ad account, is registered to the company.
Account AD-7715, the search ad account, is registered to the company.
''', 'Schedule of storefront, marketplace and ad accounts and who each is registered to')
    ds.doc('03-investor-presentation', f'''
{ds.company} — investor presentation, September 2026 (synthetic demo data).

12-month customer lifetime value (LTV): {c} {deck_ltv:.0f}.
Paid customer acquisition cost (CAC): {c} {deck_cac:.2f}.
LTV to CAC ratio of {(deck_ltv / deck_cac).quantize(D("0.1"), ROUND_HALF_UP)}x, among the best in outdoor apparel.
Revenue is diversified across our own web store, the Marketvale marketplace and wholesale partners.
''', 'Investor presentation with lifetime-value and acquisition-cost claims')
    top, share = ds.share_top()
    ds.findings = [
        ('Majority of revenue through one marketplace', f'{top} is {pct(share)} of September 2026 revenue.'),
        ('Repeat purchase declining in recent cohorts', '`orders-by-cohort.csv` — cohorts from 2025-07 keep about 27% of customers in their second month, against about 39% for earlier cohorts.'),
        ('Acquisition cost rising on paid social', '`ad-spend.csv` — paid-social spend rises every month while new customers fall.'),
        ('Claim contradicted: Customer lifetime value', f'the investor presentation states a 12-month LTV of {c} {deck_ltv:.0f}; on a contribution-margin basis the exports give {c} {q(ltv_contrib)} ({per.quantize(D("0.01"), ROUND_HALF_UP)} orders per customer × {c} {q(c_contrib / c_orders)} contribution per order). The stated figure is the same orders valued at gross sales ({c} {q(ltv_gross)}).'),
        ('Claim verified: Paid customer acquisition cost', f'{c} {deck_cac:.2f}: ad spend ÷ attributed new customers, `ad-spend.csv`, twelve months to September 2026.'),
        ('Platform account held personally: Marketvale marketplace (MV-20417)', f'{pct(mv_share)} of net sales in the twelve months to September 2026 ran through it (`channel-orders.csv`); `documents/02-platform-accounts.pdf` says it is registered to the founder personally.'),
        (f'Aged inventory: {pct(aged_share)} of stock older than 180 days', f'`inventory.csv` — {money(c, inv_aged)} of {money(c, inv_total)} at landed cost was received more than 180 days before 30 September 2026; priced as a write-down.'),
        ('Acquisition cost rising every year, 2021–2025', f'blended CAC — advertising (`pnl.csv`) ÷ new customers (`channel-orders.csv`) — {", ".join(f"{y} {c} {q(cac_y[y])}" for y in years)}. A single year looks unremarkable.'),
        ('Contribution margin compressing every year, 2021–2025', f'`channel-orders.csv` — consumer contribution margin {", ".join(f"{y} {pct(cm(y))}" for y in years)}.'),
        ('Discount rate rising every year, FY2021–FY2025', f'`channel-orders.csv` — discounts ÷ gross sales by calendar year: {", ".join(f"FY{y} {pct(disc_rate(y))}" for y in years)}; growth is being bought with discounts.'),
        ('P&L trend, 2021–2025', 'every imported year side by side: revenue, growth, margins and the advertising, fulfilment and fee ratios.'),
        ('Gross margin and Operating margin down across 2021–2025', f'`pnl.csv` — gross margin {pct(gm("2021"))} to {pct(gm("2025"))}, operating margin {pct(om("2021"))} to {pct(om("2025"))}.'),
        ('Advertising and marketing growing faster than revenue, 2021–2025', f'`pnl.csv` — {pct(MKT["2021"])} of revenue in FY2021 to {pct(MKT["2025"])} in FY2025.'),
    ]
    ds.notes = ds.notes + ['`channel-orders.csv` runs January 2021 to September 2026, so each of FY2021–FY2025 is a complete year (five years of history, read side by side on **Finances**); the channel revenue in it ties to the P&L year by year.',
                           'The P&L (`pnl.csv`) imports through Sources like any extract; the multi-year checks read every year it holds. A single year still imports: the trend then reports that year alone.',
                           'Pactlab reads exports and documents only: it never logs in to the marketplace, storefront or ad platforms.']

def property_units(ds, buildings, per_building, arrears_building, occupied_share=None):
    """The units of a garden-style community: rent roll, inspections and delinquency. Shared by the
    Multifamily pack and the Multifamily syndication pack (T-106); the random draws are in a fixed
    order, so each pack's data is reproduced byte for byte."""
    rng = ds.rng
    rows, inspect, delinq = [], [], []
    ltl_sum, mkt_sum, repair = D(0), D(0), D(0)
    for b in buildings:
        for n in range(1, per_building + 1):
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
            bal = ds.amt(rng.choice([0, 0, 0, 0, 0, 1450, 2900])) if b == arrears_building and not vacant else (ds.amt(1450) if rng.random() < 0.03 and not vacant else D(0))
            rows.append([unit, b, typ, sqft, 'vacant' if vacant else 'occupied', '' if vacant else f'{start}-01', '' if vacant else lease_end, '0.00' if vacant else f'{in_place:.2f}', f'{market:.2f}', f'{bal:.2f}'])
            if bal > 0: delinq.append([unit, b, f'{bal:.2f}', 30 if bal < ds.amt(2000) else 60])
            cond = rng.choices(['good', 'fair', 'poor'], [5, 3, 2 if b != 'A' else 1])[0]
            cost = ds.amt({'good': 0, 'fair': 2800, 'poor': 9500}[cond])
            repair += cost
            inspect.append([unit, b, cond, f'{cost:.2f}'])
    if occupied_share is not None:
        # Five years of history (T-183): occupancy has slipped to this share by September 2026. The units
        # vacated are drawn from their own generator, so every draw above is unchanged.
        live = [r for r in rows if r[4] == 'occupied']
        target = int(whole(D(len(rows)) * occupied_share))
        vacated = set(r[0] for r in random.Random(f'{ds.pack}:{ds.cur}:history').sample(live, max(len(live) - target, 0)))
        for r in rows:
            if r[0] in vacated:
                r[4:8] = ['vacant', '', '', '0.00']; r[9] = '0.00'
        ds.customers = [cu for cu in ds.customers if cu[0].rsplit('-', 1)[-1] not in vacated]
        delinq = [d for d in delinq if d[0] not in vacated]
        ltl_sum = sum((D(r[8]) - D(r[7]) for r in rows if r[4] == 'occupied'), D(0))
        mkt_sum = sum((D(r[8]) for r in rows if r[4] == 'occupied'), D(0))
    ds.ext('rent-roll', ['unit', 'building', 'type', 'sqft', 'status', 'lease_start', 'lease_end', 'in_place_rent', 'market_rent', 'balance_due'], rows, 'Rent roll at 30 September 2026')
    ds.ext('delinquency', ['unit', 'building', 'balance_due', 'days_past_due'], delinq, 'Delinquent balances at 30 September 2026')
    ds.ext('unit-inspections', ['unit', 'building', 'condition', 'estimated_repair_cost'], inspect, 'Unit-condition inspections with repair estimates')
    return rows, delinq, ltl_sum, mkt_sum, repair

def property_t12(ds):
    t12 = []
    for mo in LAST12:
        rent = sum(m2.get(mo, D(0)) for _, _, m2 in ds.customers)
        other = ds.amt(4200); opex = q(rent * D('0.43'))
        t12.append([mo, f'{rent:.2f}', f'{other:.2f}', f'{opex:.2f}', f'{(rent + other - opex):.2f}'])
    ds.ext('t12', ['month', 'rental_income', 'other_income', 'operating_expenses', 'net_operating_income'], t12, 'Trailing-twelve-month operating statement (T-12)')
    return t12, sum(D(r[4]) for r in t12)

# Five years of history (T-183): October 2021 to September 2026, fiscal years ending in September, so
# FY2026 is the T-12. Every figure is derived, not drawn, so the published files stay reproducible.
HIST = []
y, m = 2021, 10
while (y, m) <= (2026, 9):
    HIST.append(f'{y}-{m:02d}'); m += 1
    if m == 13: y, m = y + 1, 1
HIST_YEARS = ['2022', '2023', '2024', '2025', '2026']
def fy_of(mo): return str(int(mo[:4]) + (1 if int(mo[5:]) >= 10 else 0))
# Planted (T-183): occupancy slips from about 95% to about 89% over three years; FY2026 holds at the rent roll's.
HIST_OCCUPANCY = {'2022': D('0.955'), '2023': D('0.950'), '2024': D('0.930'), '2025': D('0.910')}
HIST_SEASON = [D(x) for x in ['-0.004', '-0.006', '-0.008', '-0.008', '-0.006', '-0.002', '0.002', '0.006', '0.008', '0.008', '0.006', '0.004']]
RENT_STEP = D('1.032')  # the rent-growth step each lease year, every October
# FY2026 line shares of revenue; earlier years deflate at each line's growth. Repairs and maintenance grow 20%
# a year to FY2025 (planted: outpacing rent), then are deferred by a fifth in FY2026 (planted: the NOI jump).
HIST_LINES = [('Payroll and on-site staff', D('0.110'), D('1.035')), ('Utilities', D('0.060'), D('1.035')), ('Insurance', D('0.050'), D('1.035')),
              ('Property taxes', D('0.100'), D('1.030')), ('Administrative and marketing', D('0.025'), D('1.030'))]
RM_FY2025_SHARE, RM_GROWTH, RM_DEFERRED = D('0.107'), D('1.20'), D('0.80')
MGMT_FEE, REFUND_SHARE, REFUND_MONTH = D('0.035'), D('0.012'), '2026-06'
UTIL_SEASON = [D(x) for x in ['0.9', '1.1', '1.3', '1.4', '1.3', '1.1', '0.9', '0.8', '0.8', '0.8', '0.8', '0.8']]
RM_SEASON = [D(x) for x in ['0.8', '0.8', '0.7', '0.7', '0.8', '0.9', '1.0', '1.2', '1.3', '1.3', '1.3', '1.2']]

def spread(total, weights):
    """A year's amount over its twelve months by weight, the last month taking the rounding."""
    out, acc, wsum = [], D(0), sum(weights)
    for w in weights[:-1]:
        v = q(total * w / wsum); out.append(v); acc += v
    return out + [q(total - acc)]

def property_history(ds, rows):
    """Five fiscal years of operating statements, occupancy and rent, and rent-roll snapshots, ending with
    the T-12, which is the last twelve months of it (so `t12.csv` still equals what it always meant)."""
    n = len(rows)
    occ26 = sum(1 for r in rows if r[4] == 'occupied')
    rent26 = sum((mo.get(LAST, D(0)) for _, _, mo in ds.customers), D(0))   # the billed rent of every occupied unit, a month
    avg26 = rent26 / occ26
    other26 = ds.amt(4200)
    occupied, rent, other, avg_rent = {}, {}, {}, {}
    for i, mo in enumerate(HIST):
        fy = fy_of(mo)
        if fy == '2026':
            occupied[mo], rent[mo] = occ26, rent26
        else:
            occupied[mo] = int(whole(D(n) * (HIST_OCCUPANCY[fy] + HIST_SEASON[i % 12])))
            rent[mo] = q(occupied[mo] * avg26 / RENT_STEP ** (2026 - int(fy)))
        other[mo] = q(other26 / D('1.03') ** (2026 - int(fy)))
        avg_rent[mo] = q(rent[mo] / occupied[mo])
    revenue = {fy: sum((rent[mo] + other[mo] for mo in HIST if fy_of(mo) == fy), D(0)) for fy in HIST_YEARS}
    rev26 = revenue['2026']
    annual = {}
    for name, share, growth in HIST_LINES:
        for fy in HIST_YEARS:
            annual[(name, fy)] = q(rev26 * share / growth ** (2026 - int(fy)))
    rm25 = rev26 * RM_FY2025_SHARE
    for fy in HIST_YEARS:
        annual[('Repairs and maintenance', fy)] = q(rm25 * RM_DEFERRED if fy == '2026' else rm25 / RM_GROWTH ** (2025 - int(fy)))
    lines = {}   # (line, month) -> amount
    for fy in HIST_YEARS:
        months = [mo for mo in HIST if fy_of(mo) == fy]
        for name, _, _ in HIST_LINES + [('Repairs and maintenance', None, None)]:
            weights = UTIL_SEASON if name == 'Utilities' else RM_SEASON if name == 'Repairs and maintenance' else [D(1)] * 12
            for mo, v in zip(months, spread(annual[(name, fy)], weights)):
                lines[(name, mo)] = v
        for mo in months:
            lines[('Management fee', mo)] = q((rent[mo] + other[mo]) * MGMT_FEE)
            lines[('Insurance premium refund (one-off)', mo)] = -q(rev26 * REFUND_SHARE) if mo == REFUND_MONTH else D('0.00')
    names = ['Payroll and on-site staff', 'Repairs and maintenance', 'Utilities', 'Insurance', 'Insurance premium refund (one-off)', 'Property taxes', 'Management fee', 'Administrative and marketing']
    opex = {mo: sum((lines[(nm, mo)] for nm in names), D(0)) for mo in HIST}
    # The monthly operating statements (a long file: one row per line per month) and the same by year (years as columns).
    monthly = []
    for mo in HIST:
        monthly.append(['Rental revenue', mo, f'{rent[mo]:.2f}'])
        monthly.append(['Other property revenue (fees and parking)', mo, f'{other[mo]:.2f}'])
        for nm in names:
            monthly.append([nm, mo, f'{lines[(nm, mo)]:.2f}'])
    ds.ext('operating-statements-monthly', ['account', 'month', 'amount'], monthly, 'Operating statements by month, October 2021 to September 2026 (one row per line per month)')
    by_year = lambda f: [f'{sum((f(mo) for mo in HIST if fy_of(mo) == fy), D(0)):.2f}' for fy in HIST_YEARS]
    pnl_rows = [['Rental revenue'] + by_year(lambda mo: rent[mo]), ['Other property revenue (fees and parking)'] + by_year(lambda mo: other[mo])]
    pnl_rows += [[nm] + by_year(lambda mo, nm=nm: lines[(nm, mo)]) for nm in names]
    ds.ext('pnl', ['Line'] + [f'FY{fy}' for fy in HIST_YEARS], pnl_rows, 'Operating statement by fiscal year (October to September), FY2022 to FY2026')
    # Occupancy and rent by month, the whole property; concessions rise in FY2026.
    concessions = {mo: q(occupied[mo] * ds.amt(14 if fy_of(mo) == '2026' else 6)) for mo in HIST}
    ds.ext('occupancy-history', ['period', 'unit_type', 'units', 'occupied_units', 'average_rent', 'concessions'],
           [[mo, 'All', n, occupied[mo], f'{avg_rent[mo]:.2f}', f'{concessions[mo]:.2f}'] for mo in HIST], 'Occupancy and average in-place rent by month, October 2021 to September 2026')
    # Quarterly rent-roll snapshots for the last two years; the last is today's rent roll.
    hrng = random.Random(f'{ds.pack}:{ds.cur}:snapshots')
    vacant_now = [r for r in rows if r[4] != 'occupied']
    hrng.shuffle(vacant_now)
    snaps = []
    for as_of in ['2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']:
        mo, fy = as_of[:7], fy_of(as_of[:7])
        back = set(r[0] for r in vacant_now[:occupied[mo] - occ26])
        for r in rows:
            live = r[4] == 'occupied' or r[0] in back
            base = D(r[7]) if r[4] == 'occupied' else q(D(r[8]) * D('0.93'))
            snaps.append([as_of, r[0], r[2], 'occupied' if live else 'vacant', f'{q(base / RENT_STEP ** (2026 - int(fy))) if live else D("0.00"):.2f}'])
    ds.ext('rent-roll-history', ['as_of', 'unit', 'type', 'status', 'in_place_rent'], snaps, 'Rent-roll snapshots at each quarter end, December 2024 to September 2026')
    # The T-12: the last twelve months of the history.
    t12 = [[mo, f'{rent[mo]:.2f}', f'{other[mo]:.2f}', f'{opex[mo]:.2f}', f'{(rent[mo] + other[mo] - opex[mo]):.2f}'] for mo in LAST12]
    ds.ext('t12', ['month', 'rental_income', 'other_income', 'operating_expenses', 'net_operating_income'], t12, 'Trailing-twelve-month operating statement (T-12)')
    # The figures the checks read, computed the way the calculator does (decimal, four places), for the README.
    def fy_sum(f, fy): return sum((f(mo) for mo in HIST if fy_of(mo) == fy), D(0))
    noi = {fy: revenue[fy] - fy_sum(lambda mo: opex[mo], fy) for fy in HIST_YEARS}
    expenses = {fy: fy_sum(lambda mo: opex[mo], fy) for fy in HIST_YEARS}
    occ_avg = {fy: (D(fy_sum(lambda mo: D(occupied[mo]), fy)) / (n * 12)).quantize(D('0.0001')) for fy in HIST_YEARS}
    occ_low = {fy: min(D(occupied[mo]) / n for mo in HIST if fy_of(mo) == fy).quantize(D('0.0001')) for fy in HIST_YEARS}
    rent_avg = {fy: (fy_sum(lambda mo: avg_rent[mo] * occupied[mo], fy) / fy_sum(lambda mo: D(occupied[mo]), fy)).quantize(D('0.01')) for fy in HIST_YEARS}
    cagr = lambda a, b: ((D(b) / D(a)) ** (D(1) / 4) - 1).quantize(D('0.0001'))
    rm = {fy: fy_sum(lambda mo: lines[('Repairs and maintenance', mo)], fy) for fy in HIST_YEARS}
    margin = {fy: (noi[fy] / revenue[fy]).quantize(D('0.0001')) for fy in HIST_YEARS}
    growth = [noi[HIST_YEARS[i]] / noi[HIST_YEARS[i - 1]] - 1 for i in range(1, 5)]
    spike = growth[-1] - sum(growth[:-1]) / 3
    h = dict(t12=t12, t12_noi=sum(D(r[4]) for r in t12), revenue=revenue, noi=noi, expenses=expenses, occ_avg=occ_avg, occ_low=occ_low, rent_avg=rent_avg,
             noi_cagr=cagr(noi['2022'], noi['2026']), revenue_cagr=cagr(revenue['2022'], revenue['2026']), rent_cagr=cagr(rent_avg['2022'], rent_avg['2026']),
             rm_cagr=cagr(rm['2022'], rm['2026']), opex_cagr=cagr(expenses['2022'], expenses['2026']), rm=rm, margin=margin, growth=growth, spike=spike,
             expense_ratio=(expenses['2026'] / revenue['2026']).quantize(D('0.0001')), refund=q(rev26 * REFUND_SHARE),
             vacancy_3y=(1 - sum(occ_avg[fy] for fy in HIST_YEARS[-3:]) / 3).quantize(D('0.0001')),
             monthly_rows=len(monthly), pnl_lines=len(pnl_rows))
    # The planted defects must fire, or the README would promise findings the checks never draft.
    assert occ_avg['2022'] - occ_avg['2026'] >= D('0.03') and occ_avg['2026'] < D('0.90'), (ds.pack, ds.cur, occ_avg)
    assert h['rm_cagr'] - h['rent_cagr'] >= D('0.02') and h['opex_cagr'] - h['rent_cagr'] < D('0.02'), (ds.pack, ds.cur, h['rm_cagr'], h['opex_cagr'], h['rent_cagr'])
    assert spike >= D('0.05') and growth[-1] > 0, (ds.pack, ds.cur, growth)
    h['margin_drift'] = margin['2026'] - margin['2022'] <= D('-0.03')
    return h

def history_readme(ds, h):
    """The P&L step, the planted findings and the hand-computed figures the history checks must reproduce."""
    c = ds.cur
    fy = lambda y: f'FY{y}'
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2022 to FY2026).',
                   '2. Under **What each line is**, keep the two revenue lines as **Revenue** and every other line as **Operating expense** (the insurance refund is a credit, entered negative).',
                   f'3. **Check every row**, then **Import {h["pnl_lines"] * 5} rows**.', '',
                   '**You should see:** on **Home → Property metrics**, a **History** strip under net operating income, occupancy and average rent, each with five points and "FY2022–FY2026 (5 of 5 years)"; on **Finances**, the five years side by side.', '']
    occ = ', '.join(f'{fy(y)} {pct(h["occ_avg"][y])}' for y in HIST_YEARS)
    found = [
        (f'Occupancy eroding, FY2022–FY2026', f'planted: `occupancy-history.csv` — average occupancy {occ}; below 90% in FY2026. The rent roll alone shows only today.'),
        (f'Repairs and maintenance growing faster than rent, FY2022–FY2026', f'planted: `pnl.csv` and `occupancy-history.csv` — repairs and maintenance {pct(h["rm_cagr"])} a year ({money(c, h["rm"]["2022"])} to {money(c, h["rm"]["2026"])}) against average rent {pct(h["rent_cagr"])} a year.'),
        (f'NOI jump in FY2026 above the history\'s trend', f'planted: `pnl.csv` — NOI up {pct(h["growth"][-1])} in FY2026 against an average of {pct(sum(h["growth"][:-1]) / 3)} a year before it, from deferred repairs and a one-off insurance refund of {money(c, h["refund"])}; concessions rose too. The "dressed for sale" pattern.'),
        ('P&L trend, 2022–2026', '`pnl.csv` — the five years side by side, a record for review.'),
    ]
    if h['margin_drift']:
        found.append(('Operating margin down across 2022–2026', f'`pnl.csv` — NOI margin {pct(h["margin"]["2022"])} in FY2022 to {pct(h["margin"]["2026"])} in FY2026.'))
    ds.findings = ds.findings + found
    ds.notes = ds.notes + [
        'History (T-183): five fiscal years, October to September, FY2022 to FY2026; FY2026 is the T-12, so `t12.csv` equals the last twelve months of `operating-statements-monthly.csv` and of `pnl.csv`\'s FY2026 column, and the September 2026 month of `occupancy-history.csv` matches `rent-roll.csv`.',
        f'Figures the history checks reproduce: NOI growth {pct(h["noi_cagr"])} a year and revenue growth {pct(h["revenue_cagr"])} a year (FY2022–FY2026); average in-place rent {", ".join(f"{fy(y)} {money(c, h["rent_avg"][y], True)}" for y in HIST_YEARS)} ({pct(h["rent_cagr"])} a year); occupancy {occ}; expense ratio {pct(h["expense_ratio"])} in FY2026; trailing three-year vacancy {pct(h["vacancy_3y"])}.',
        '`operating-statements-monthly.csv` is the same statement as a long file (one row per line per month); it imports through the same P&L import. `rent-roll-history.csv` holds quarterly rent-roll snapshots for the last two years.',
    ]

def multifamily(ds):
    ds.kind, ds.kind_label = 'rent', 'unit rent charge'
    ds.summary = f'{ds.company} owns Larkfield Commons, a 96-unit garden-style apartment community in three buildings (A, B, C).'
    rows, delinq, ltl_sum, mkt_sum, repair = property_units(ds, 'ABC', 32, 'C', occupied_share=D('0.885'))
    history = property_history(ds, rows)
    noi = history['t12_noi']
    om_noi = whole(noi * D('1.11'))
    budget = ds.amt(1500) * 96
    c_share = D(sum(1 for d in delinq if d[1] == 'C')) / max(len(delinq), 1)
    c = ds.cur
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
    history_readme(ds, history)

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

    # --- T-161: the healthcare evidence set, scaled to the clinic, and what concentrates in one: the owner, a referrer, a lease.
    rng = ds.rng
    klass = {'Insurer Bluepoint': 'commercial', 'Insurer Harrowgate': 'commercial', 'Government scheme': 'medicaid', 'Patients — self-pay': 'self_pay'}
    yield_usd = {'commercial': D('118'), 'medicaid': D('74'), 'self_pay': D('96')}
    # Remittances run January 2021 to September 2026 (five years, T-184b); months before 2023 come from their own
    # random generator, so the later rows are unchanged.
    hrng = random.Random(f'clinics-history:{ds.cur}')
    r_months, (yy, mm) = [], (2021, 1)
    while (yy, mm) <= (2026, 9):
        r_months.append(f'{yy}-{mm:02d}'); mm += 1
        if mm == 13: yy, mm = yy + 1, 1
    first_billed = MONTHS[0]
    hist = [mo for mo in r_months if mo < '2023-01']
    pre = [mo for mo in r_months if '2023-01' <= mo < first_billed]
    remit = []   # [month, payer, class, claims, denied, billed, collected, ar] — a steady mix, flat denials and days in AR
    for mo in r_months:
        g = rng if mo >= '2023-01' else hrng
        back = 0 if mo >= first_billed else len(pre) - pre.index(mo) if mo in pre else len(pre) + len(hist) - hist.index(mo)
        for _, name, monthly in ds.customers:
            payer = name.replace(' (synthetic)', '')
            collected = q(monthly[mo]) if mo >= first_billed else q(monthly[first_billed] / (D('1.005') ** back))
            cl = klass[payer]
            claims = whole(collected / (ds.amt(yield_usd[cl]) * (D(1) + D(g.randint(-10, 10)) / 1000)))
            denied = whole(claims * D('0.048') * (D(1) + D(g.randint(-30, 30)) / 1000))
            billed = q(collected * D('1.31'))
            ar = q(billed * D(36) / D('30.4') * (D(1) + D(g.randint(-15, 15)) / 1000))
            remit.append([mo, name, cl, claims, denied, billed, collected, ar])
    ds.ext('remittances', ['month', 'payer', 'payer_class', 'claims', 'denied_claims', 'billed', 'collected', 'ar_balance'],
           [[r[0], r[1], r[2], f'{r[3]:.0f}', f'{r[4]:.0f}', f'{r[5]:.2f}', f'{r[6]:.2f}', f'{r[7]:.2f}'] for r in remit],
           'Remittances by month and payer: claims, denials, charges billed, cash collected and receivables at month end')
    def year_of(y): return [r for r in remit if r[0].startswith(y)]
    def days_in_ar(y):
        rows = year_of(y)
        return sum(r[7] for r in rows if r[0] == f'{y}-12') / (sum(r[5] for r in rows) / 365)

    # Service lines by provider, the last twelve months. P01 is the selling owner and the only provider of
    # implants, the highest-margin line (planted (c)); associates share every other line.
    lines = [  # line, share of collections, direct-cost ratio, providers (owner first when the owner works the line)
        ('Implants', D('0.17'), D('0.34'), ['P01']),
        ('Restorative dentistry', D('0.29'), D('0.46'), ['P01', 'P02', 'P05', 'P06']),
        ('Hygiene', D('0.22'), D('0.52'), ['P03', 'P04', 'P09']),
        ('Physiotherapy', D('0.32'), D('0.55'), ['P13', 'P14', 'P17', 'P18', 'P21']),
    ]
    site_of = {'P01': 'Site 1', 'P02': 'Site 1', 'P03': 'Site 1', 'P04': 'Site 2', 'P05': 'Site 2', 'P06': 'Site 4', 'P09': 'Site 3',
               'P13': 'Site 4', 'P14': 'Site 5', 'P17': 'Site 5', 'P18': 'Site 6', 'P21': 'Site 6'}
    sl, by_provider = [], {}
    for mo in LAST12:
        total = sum(r[6] for r in remit if r[0] == mo)
        allotted = D(0)
        for li, (line, share, cost, refs) in enumerate(lines):
            line_total = total - allotted if li == len(lines) - 1 else q(total * share)
            allotted += line_total
            weights = [D(3) if ref == 'P01' and line != 'Implants' else D(rng.randint(8, 12)) for ref in refs]
            given = D(0)
            for i, ref in enumerate(refs):
                amount = line_total - given if i == len(refs) - 1 else q(line_total * weights[i] / sum(weights))
                given += amount
                visits = whole(amount / ds.amt(310 if line == 'Implants' else 120 if line == 'Restorative dentistry' else 85))
                sl.append([mo, line, ref, f'{visits:.0f}', f'{amount:.2f}', f'{q(amount * cost):.2f}'])
                v, c_ = by_provider.get((mo, ref), (D(0), D(0)))
                by_provider[(mo, ref)] = (v + visits, c_ + amount)
    ds.ext('service-lines', ['month', 'service_line', 'provider_ref', 'visits', 'collected', 'direct_cost'], sl,
           'Collections and direct costs by month, service line and pseudonymous provider, from the schedule and billing exports')
    owner_total = sum(D(r[4]) for r in sl if r[2] == 'P01')
    sl_total = sum(D(r[4]) for r in sl)
    margin = {line: 1 - cost for line, _, cost, _ in lines}
    implants_share = sum(D(r[4]) for r in sl if r[1] == 'Implants') / sl_total
    # Before October 2025 (T-184b) collections by clinician follow the remittances, split as the last twelve months
    # split them; visits at the clinic's average collected per visit.
    prov_share = {}
    for (mo, ref), (v, c_) in by_provider.items(): prov_share[ref] = prov_share.get(ref, D(0)) + c_
    prov_total = sum(prov_share.values())
    for mo in r_months:
        if mo in LAST12: continue
        total = sum(r[6] for r in remit if r[0] == mo)
        given = D(0)
        for i, ref in enumerate(sorted(prov_share)):
            amount = total - given if i == len(prov_share) - 1 else q(total * prov_share[ref] / prov_total)
            given += amount
            by_provider[(mo, ref)] = (whole(amount / ds.amt(118)), amount)
    ds.ext('clinician-collections', ['month', 'provider_ref', 'site', 'visits', 'collected'],
           [[mo, ref, f'{site_of[ref]} (synthetic)', f'{v:.0f}', f'{c_:.2f}'] for (mo, ref), (v, c_) in sorted(by_provider.items())],
           'Collections by clinician and month, pseudonymous, from the practice-management system, January 2021 to September 2026')

    # Visits by referral source: Harbourside Hospital refers 58% of visits (planted (a)).
    sources = [('Harbourside Hospital orthopaedics (synthetic)', 'hospital', D('0.58')), ('Northgate Physician Group (synthetic)', 'physician group', D('0.13')),
               ('Bluepoint plan network (synthetic)', 'plan', D('0.09')), ('Self-referral', 'self-referral', None)]
    refs_rows = []
    for mo in LAST12:
        visits = 1180 + rng.randint(-40, 40)
        given = 0
        for name, kind, share in sources:
            n = visits - given if share is None else int(whole(visits * share))
            given += n
            refs_rows.append([mo, name, kind, n, int(whole(n * D('0.22')))])
    ds.ext('referrals', ['month', 'referral_source', 'source_type', 'visits', 'new_patients'], refs_rows, 'Visits by referral source and month, from the schedule export')
    top_share = D(sum(r[3] for r in refs_rows if r[1].startswith('Harbourside'))) / D(sum(r[3] for r in refs_rows))

    # The credentialing register and the payer contracts: all current (the T-160 checks run and stay quiet).
    juris = {'USD': 'Ohio', 'EUR': 'Netherlands', 'GBP': 'England'}[c]
    month_names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    providers = sorted({r[2] for r in sl})
    creds, verify = [], []
    for i, ref in enumerate(providers):
        board = 'physiotherapy' if ref >= 'P13' else 'dental'
        expiry = f'{2027 + i % 2}-{(i % 12) + 1:02d}-28'
        creds.append([f'CR-{i + 1:02d}01', ref, 'state_licence', juris, f'{juris} {board} board (synthetic)', 'active', expiry])
        y_, m_, d_ = expiry.split('-')
        verify.append(f'{ref}: {board} licence, {juris} — active, expires on {int(d_)} {month_names[int(m_) - 1]} {y_}.')
    ds.ext('credentialing-register', ['credential_ref', 'provider_ref', 'kind', 'jurisdiction', 'issuer', 'status', 'expires_on'], creds, 'Credentialing register: a licence per pseudonymous provider')
    ds.ext('payer-contracts', ['contract_id', 'payer', 'payer_class', 'effective_on', 'expires_on', 'auto_renews'], [
        ['BP-2023', 'Insurer Bluepoint (synthetic)', 'commercial', '2023-01-01', '2028-12-31', 'yes'],
        ['HG-2024', 'Insurer Harrowgate (synthetic)', 'commercial', '2024-07-01', '2029-06-30', 'no'],
        ['GS-ENR-118', 'Government scheme (synthetic)', 'medicaid', '2019-04-01', '', 'no']], 'Payer contract and enrolment register')

    # Five fiscal years of P&L (T-184b). Patient revenue is the cash collected; supplies outpace revenue every
    # year, which FY2025 alone does not show (planted (d)); falling administration keeps the operating margin level.
    years = ['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']
    patient = [sum((r[6] for r in year_of(y[2:])), D(0)) for y in years]
    other = [q(ds.amt(9000) * D(f)) for f in ('0.94', '0.97', '1', '1.03', '1.06')]
    rev = [patient[i] + other[i] for i in range(5)]
    ratios = {
        'Cost of care: clinical staff': [D('0.41'), D('0.41'), D('0.41'), D('0.41'), D('0.41')],
        'Clinical and dental supplies': [D('0.045'), D('0.056'), D('0.068'), D('0.084'), D('0.103')],
        'Laboratory fees': [D('0.031'), D('0.031'), D('0.031'), D('0.031'), D('0.030')],
        'Rent and occupancy': [D('0.076'), D('0.075'), D('0.074'), D('0.073'), D('0.072')],
        'General and administrative': [D('0.150'), D('0.133'), D('0.118'), D('0.103'), D('0.085')],
    }
    pnl_rows = [['Net patient service revenue'] + [f'{x:.2f}' for x in patient], ['Other operating revenue'] + [f'{x:.2f}' for x in other]]
    for name, rs in ratios.items():
        pnl_rows.append([name] + [f'{q(rev[i] * rs[i]):.2f}' for i in range(5)])
    supplies = [q(rev[i] * ratios['Clinical and dental supplies'][i]) for i in range(5)]
    ds.ext('pnl', ['Line'] + years, pnl_rows, 'Profit and loss by fiscal year, FY2021 to FY2025')
    ds.pnl_step = ['Open the **Sources** tab, scroll to **Industry data** and click **Upload profit and loss (p&l)**.', '',
                   '1. Choose `pnl.csv` → **Upload and map columns**. Pactlab reads the five years across the columns (FY2021 to FY2025).',
                   '2. Say what each line is: the two lines ending in *revenue* are **Revenue**, `Cost of care: clinical staff` is **Cost of revenue**, and the rest are **Operating expenses**.',
                   f'3. **Check every row**, then **Import {len(pnl_rows) * 5} rows**.', '',
                   '**You should see:** the import succeed. The **Practice** tab shows the P&L year by year, **Finances** the five years side by side with visits, the commercial share and the denial rate, and the checks in the next step read every year.', '']

    deck_ar = days_in_ar('2025').quantize(D('1'), ROUND_HALF_UP)
    ds.doc('02-confidential-information-memorandum', f"""
{ds.company} — confidential information memorandum, September 2026 (synthetic demo data).

Six dental and physiotherapy clinics across {juris}, founded and still run by their owner.
P01 is the selling owner and principal dentist, and performs every implant procedure.
There is no succession plan in place for the owner's patients.
Days in accounts receivable at 31 December 2025: {deck_ar} days.
The parties have agreed a target closing date of 30 November 2026.
""", 'Confidential information memorandum, with the owner, the closing date and a days-in-AR claim')
    ds.doc('03-lease-harbour-street', f"""
Lease of premises at 12 Harbour Street, Site 1 (synthetic), between Harbour Street Holdings (synthetic) as landlord and {ds.company} as tenant.

The term began on 1 February 2018 and ends on 31 January 2028.
There is no option to renew or extend the term.
The tenant may not assign this lease, or undergo a change of control, without the landlord's prior written consent.
---page---
Rent: {money(c, ds.amt(14500))} per month, reviewed every three years.
""", 'Lease of the flagship clinic at 12 Harbour Street')
    verified = '\n'.join(verify)
    ds.doc('04-licence-verification', f"""
Licence verification report for {ds.company} (synthetic).

Verified on 28 September 2026 against the issuing boards' public registers. Providers are listed by pseudonymous reference.
---page---
{verified}
""", "Primary-source verification of every provider's licence, by pseudonymous reference")

    ds.findings = [
        ('One provider carries Site 3', f'P07 earns {pct(site3_p07 / site3_total)} of Site 3 revenue in `patient-volume.csv` — a retention risk after closing.'),
        ('High-complexity coding above policy', '`coding-summary.csv` shows 31–36% of visits at the highest code against the 15% expected by `documents/01-coding-policy.pdf`.'),
        ('Imaging equipment past its useful life', 'two panoramic X-ray units in `equipment-schedule.csv` (2014 and 2015, ten-year lives). Price as remediation.'),
        (f'{pct(top_share)} of visits come from one referral source: Harbourside Hospital orthopaedics (synthetic)', f'recomputed from `referrals.csv`: Harbourside Hospital referred {pct(top_share)} of visits in the twelve months to September 2026.'),
        ('Clinic lease ends 14 months after closing, with no renewal option', '`documents/03-lease-harbour-street.pdf` — the term ends on 31 January 2028, 14 months after the 30 November 2026 target closing in `documents/02-confidential-information-memorandum.pdf`; no option to renew. Price as relocation or renegotiation risk.'),
        ('Clinic lease: assignment on a sale needs the landlord’s consent', '`documents/03-lease-harbour-street.pdf` — assignment or a change of control needs the landlord’s written consent: a closing condition.'),
        ('The selling owner is the only provider of the highest-margin service line: Implants', f'`service-lines.csv` — implants are {pct(implants_share)} of collections at a {pct(margin["Implants"])} margin after direct costs, and only P01, the selling owner, collects on them. P01 delivers {pct(owner_total / sl_total)} of collections overall.'),
        ('Claim verified: Days in accounts receivable', f'{deck_ar} days at 31 December 2025, recomputed from `remittances.csv` ({days_in_ar("2025").quantize(D("0.1"), ROUND_HALF_UP)}).'),
        ('P&L trend, 2021–2025', 'every imported year side by side: revenue, growth, margins and the supplies, laboratory, clinical staff and occupancy ratios.'),
        ('Clinical and dental supplies growing faster than revenue, 2021–2025', f'`pnl.csv` — from {pct(ratios["Clinical and dental supplies"][0])} of revenue in FY2021 to {pct(ratios["Clinical and dental supplies"][4])} in FY2025 ({money(c, supplies[0])} to {money(c, supplies[4])}); FY2025 alone looks ordinary.'),
    ]
    assert D('0.575') < top_share < D('0.585'), top_share
    assert owner_total / sl_total < D('0.3'), 'the owner share stays under the no-succession threshold'
    ds.notes = ['Providers are pseudonymous (P01, P02, …); P01, the selling owner, is named only by that reference. Pactlab never sends people data to a model.',
                '`remittances.csv` and `clinician-collections.csv` run January 2021 to September 2026, so each of FY2021–FY2025 is a complete year (five years of history, read side by side on **Finances**); the clinic\'s visits and payer mix stay steady.',
                'The remittances, collections by clinician, credentialing register and payer contracts are the healthcare pack’s own imports, reused as they are; the clinic adds service lines, referrals and the lease.',
                'The P&L (`pnl.csv`) imports through Sources like any extract; the multi-year checks read every year it holds. A single year still imports: the trend then reports that year alone.',
                'Diligence support only: the pack checks documents, dates and arithmetic. It does not assess the quality of care, whether the referral arrangement is lawful, or what the lease means in law.']

def venture(ds):
    """Founder-side (T-083): a seed-stage SaaS startup preparing to raise; the founder is the user."""
    ds.kind, ds.kind_label = 'subscription', 'customer subscription'
    ds.summary = f'{ds.company} is a seed-stage SaaS startup: scheduling and invoicing for field-service teams, raising a seed round from angels, an accelerator and venture funds.'
    teams = [('Brightline Plumbing', 13500), ('Copperfield Electric', 11800), ('Northgate HVAC', 10400), ('Tidewater Roofing', 9200), ('Juniper Landscapes', 8100),
             ('Ashby Pest Control', 7300), ('Marlow Cleaning Co', 6600), ('Fernhill Glazing', 6000), ('Oriel Locksmiths', 5400), ('Kestrel Pools', 4900),
             ('Wrenfield Joinery', 4500), ('Halden Solar', 4200), ('Pembury Paving', 4100), ('Quarry Lane Movers', 4000)]
    for i, (n, base) in enumerate(teams):
        ds.customer(f'{ds.prefix}-cus-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.012', noise=D('0.02')))
    c = ds.cur
    billed = ds.billed_arr()
    deck_arr = (billed * D('1.05') / 10000).quantize(D('1'), ROUND_HALF_UP) * 10000
    safes = [('SAFE-1', 'I-1', 250000, 8000000, '', 'yes', '2024-11-15'), ('SAFE-2', 'I-2', 300000, 10000000, '', 'no', '2025-03-10'), ('SAFE-3', 'I-3', 400000, 6000000, '20', 'no', '2025-09-01')]
    rows = [
        ['CS-1', 'F-1', 'founder', 'common', 4500000, '', '', '', 'no', 'no', 'yes', '2023-02-01'],
        ['CS-2', 'F-2', 'founder', 'common', 3500000, '', '', '', 'no', 'no', 'yes', '2023-02-01'],
        ['CS-3', 'A-1', 'advisor', 'common', 250000, '', '', '', 'no', 'no', 'yes', '2024-01-15'],
        ['CS-4', 'E-01', 'employee', 'common', 750000, '', '', '', 'no', 'no', 'yes', '2024-04-01'],
        ['OP-1', 'E-02', 'employee', 'option', 600000, '', '', '', 'no', 'no', 'yes', '2025-02-01'],
        ['POOL', 'POOL', 'pool', 'pool_unallocated', 900000, '', '', '', 'no', 'no', 'no', '2024-01-15'],
    ] + [[sid, ref, 'investor', 'safe', '', f'{ds.amt(p):.2f}', f'{ds.amt(cap):.2f}', disc, mfn, 'yes', 'no', on] for sid, ref, p, cap, disc, mfn, on in safes]
    ds.ext('cap-table', ['security_id', 'holder_ref', 'holder_type', 'instrument', 'shares', 'principal', 'valuation_cap', 'discount_pct', 'mfn', 'pro_rata', 'vesting', 'issued_on'], rows,
           'Cap table, one row per security (pseudonymous holders)')
    safe_total = sum(ds.amt(p) for _, _, p, *_ in safes)
    fin, cash = [], ds.amt(1500000)
    burns = [ds.amt(b) for b in (92000, 95000, 98000, 101000, 104000, 107000, 110000, 113000, 116000, 119000, 122000, 125000)]
    balances = []
    for burn in reversed(burns):
        balances.append(cash); cash += burn
    for mo, burn, bal in zip(LAST12, burns, reversed(balances)):
        fin.append([mo, f'{bal:.2f}', f'{burn:.2f}'])
    ds.ext('monthly-financials', ['month', 'cash_balance', 'net_burn'], fin, 'Cash balance and net burn by month')
    runway = ds.amt(1500000) / (sum(burns[-3:]) / 3)
    ds.doc('01-investor-deck', f"""
{ds.company} — seed round investor deck, September 2026 (synthetic)

Loopwise schedules jobs and sends invoices for field-service teams in one place.
---page---
ARR at 30 September 2026: {c} {deck_arr:,.0f}
Runway: 18 months at current burn
SAFEs outstanding: {c} {safe_total:,.0f}
Customers: 14 paying teams; no customer is more than 15% of revenue.
""", 'Seed round investor deck with headline metrics')
    ds.doc('02-certificate-of-incorporation', f"""
{ds.company} — certificate of incorporation (synthetic)
---page---
Article IV. Authorized: 15,000,000 shares of Common Stock.
Issued and outstanding: 9,000,000 shares of Common Stock as of 30 September 2026.
""", 'Certificate of incorporation with issued shares')
    ds.doc('03-contractor-agreement-northbeam', f"""
Independent contractor agreement — {ds.company} and Northbeam Studio (synthetic)
---page---
3. Intellectual property. Contractor hereby assigns to the Company all right, title and interest in all inventions and work product created under this agreement.
""", 'Contractor agreement with IP assignment')
    ds.doc('04-contractor-agreement-quillfield', f"""
Independent contractor agreement — {ds.company} and Quillfield Design (synthetic)
---page---
2. Services. Contractor will design the mobile app screens and deliver the design files.
4. Payment. The Company pays monthly against invoices.
""", 'Contractor agreement for app design')
    ds.doc('05-83b-confirmations', """
Section 83(b) election confirmations (synthetic)
---page---
Holder F-1: election filed 14 February 2023, receipt on file.
Holder F-2: election filed 14 February 2023, receipt on file.
""", 'Founders 83(b) election confirmations')
    ds.doc('06-term-sheet-harborline', f"""
Seed term sheet — Harborline Ventures and {ds.company} (synthetic, non-binding)
---page---
Investment: {c} {ds.amt(2000000):,.0f} at a pre-money valuation of {c} {ds.amt(10000000):,.0f}.
Liquidation preference: 1x non-participating.
Board: two founder directors and one investor director.
""", 'Seed term sheet received from a venture fund')
    ds.doc('07-safe-register', '\n'.join([f'{ds.company} — SAFE register (synthetic)', '---page---'] + [f'{sid}: {c} {ds.amt(p):,.0f}, valuation cap {c} {ds.amt(cap):,.0f}{", discount " + disc + "%" if disc else ""}{", most-favoured-nation" if mfn == "yes" else ""}, signed {on}.' for sid, _, p, cap, disc, mfn, on in safes]),
           'Register of SAFEs signed before this round')
    ds.findings = [
        ('Deck ARR contradicted by billing', f'the deck states {c} {deck_arr:,.0f}; `invoice-lines.csv` bills {c} {billed:,.0f} ARR for September 2026 (`documents/01-investor-deck.pdf` page 2).'),
        ('SAFE stack converts into more than expected', 'SAFE-1 has a most-favoured-nation clause, so it takes SAFE-3\'s lower cap (`cap-table.csv`, `documents/07-safe-register.pdf`).'),
        ('IP assignment gap', 'the Quillfield Design agreement has no IP assignment (`documents/04-contractor-agreement-quillfield.pdf`).'),
        ('Runway shorter than the deck says', f'the deck states 18 months; `monthly-financials.csv` gives {runway:.1f} months at the last three months\' burn.'),
        ('Cap table reconciles to the corporate record', 'confirmed value (+1, founder-confidential): 9,000,000 issued shares in `cap-table.csv` match `documents/02-certificate-of-incorporation.pdf`.'),
        ('Board composition after the round', 'informational: two founder directors and one investor director (`documents/06-term-sheet-harborline.pdf` page 2).'),
    ]
    ds.notes = [
        'Founder-side pack: the founder is the Pactlab user and investors are the counterparty. Drags are what an investor will find; cushions stay confidential until the founder shares them.',
        'Holders in the cap table are pseudonymous references (F-1, E-02, I-3); no names.',
    ]

def waterfall(price, loan, rate, equity, hold, noi1, growth, cap, selling, pref, tiers, acq, am, disp):
    """The investor waterfall, as Pactlab recomputes it (packages/calculations syndication/waterfall.ts,
    syndication-waterfall-1): annual periods, interest-only debt, fees first, a European waterfall with
    IRR hurdles. Kept here so the README can state what the PPM gets wrong; the acceptance test checks
    the app agrees. Returns (irr %, equity multiple, average cash-on-cash %), each to 2 dp."""
    from decimal import localcontext, ROUND_HALF_EVEN
    with localcontext() as ctx:
        ctx.prec = 40
        one, zero = D(1), D(0)
        reserves = equity - (price - loan) - price * acq
        hurdles = [pref] + [h for h, _ in tiers if h is not None]
        bal = [equity for _ in hurdles]
        def dist(cash):
            rest, lp, gp = cash, zero, zero
            to_pref = min(rest, max(zero, bal[0])); lp += to_pref; rest -= to_pref
            for i, (h, g) in enumerate(tiers):
                if rest <= 0: break
                share = one - g
                piece = rest if h is None else min(rest, max(zero, bal[i + 1] - lp) / share)
                lp += piece * share; gp += piece * g; rest -= piece
            for k in range(len(bal)): bal[k] -= lp
            return lp, gp
        flows, op_lp = [-equity], zero
        debt, fee = loan * rate, equity * am
        for y in range(1, hold + 1):
            bal[:] = [b * (one + r) for b, r in zip(bal, hurdles)]
            cash = noi1 * (one + growth) ** (y - 1) - debt - fee
            lp = zero
            if cash > 0: lp, _ = dist(cash)
            else: reserves += cash
            op_lp += lp; flows.append(lp)
        sale = noi1 * (one + growth) ** hold / cap
        net = max(zero, sale - sale * selling - sale * disp - loan + reserves)
        lp, _ = dist(net)
        flows[-1] += lp
        npv = lambda r: sum(f / (one + r) ** t for t, f in enumerate(flows))
        lo, hi = D('-0.99'), D(10)
        n_lo = npv(lo)
        for _ in range(200):
            mid = (lo + hi) / 2
            v = npv(mid)
            if v == 0 or hi - lo < D('1e-12'): lo = hi = mid; break
            if (v > 0) == (n_lo > 0): lo, n_lo = mid, v
            else: hi = mid
        irr = (lo + hi) / 2
        two = lambda x: x.quantize(D('0.01'), ROUND_HALF_EVEN)
        distributed = sum(flows[1:])
        return two(irr * 100), two(distributed / equity), two(op_lp / hold / equity * 100)

def syndication(ds):
    """Sponsor-side (T-106): Ashgrove Residential buys Briarwood Commons and raises the equity from accredited investors."""
    ds.kind, ds.kind_label = 'rent', 'unit rent charge'
    ds.seller, ds.buyer = f'Briarwood Commons Owner {ds.c["suffix"]}', ds.company
    ds.summary = (f'{ds.company} is a multifamily sponsor buying Briarwood Commons, a 204-unit garden-style community in six buildings (A–F), '
                  f'and raising the equity from accredited investors under Rule 506(c). The seller is {ds.seller}.')
    # The seller's own pitch: it never mentions the sponsor's raise (the wall holds in the demo too).
    ds.sale_summary = f'{ds.seller} is selling Briarwood Commons, a 204-unit garden-style apartment community in six buildings (A–F).'
    rows, delinq, ltl_sum, mkt_sum, repair = property_units(ds, 'ABCDEF', 34, 'C', occupied_share=D('0.885'))
    history = property_history(ds, rows)
    noi = history['t12_noi']
    c = ds.cur
    hundred_k = lambda x: (D(x) / 100000).quantize(D('1'), ROUND_HALF_UP) * 100000
    price = hundred_k(noi / D('0.06'))
    loan = hundred_k(price * D('0.65'))
    equity = hundred_k(price - loan + price * D('0.02') + price * D('0.015'))
    tiers = [(D('0.15'), D('0.30')), (None, D('0.40'))]
    irr, multiple, coc = waterfall(price, loan, D('0.05'), equity, 5, noi, D('0.03'), D('0.06'), D('0.02'), D('0.08'), tiers, D('0.02'), D('0.02'), D('0.01'))
    stated_irr = (irr + D('4.6')).quantize(D('0.1'), ROUND_HALF_UP)
    occupied = sum(1 for r in rows if r[4] == 'occupied')
    occupancy = (D(occupied) / len(rows) * 100).quantize(D('0.1'), ROUND_HALF_UP)
    om_noi = whole(noi * D('1.11'))
    budget = ds.amt(1500) * 204
    c_share = D(sum(1 for d in delinq if d[1] == 'C')) / max(len(delinq), 1)
    ds.offering = dict(price=price, loan=loan, equity=equity, irr=irr, stated_irr=stated_irr, multiple=multiple, coc=coc, occupancy=occupancy)
    ds.ext('track-record', ['deal', 'units', 'acquired_on', 'exited_on', 'status', 'projected_irr_pct', 'actual_irr_pct', 'projected_multiple', 'actual_multiple'], [
        ['Cedar Hollow Apartments (synthetic)', 148, '2017-03-15', '2022-06-30', 'realized', '16.0', '21.0', '1.80', '2.05'],
        ['Maple Run Townhomes (synthetic)', 96, '2018-05-01', '2023-09-15', 'realized', '15.0', '17.6', '1.75', '1.92'],
        ['Harlow Court (synthetic)', 120, '2019-02-01', '2024-04-30', 'realized', '15.5', '15.2', '1.80', '1.78'],
        ['Stonebridge Flats (synthetic)', 176, '2019-08-01', '2024-11-30', 'realized', '17.0', '', '1.90', ''],
        ['Willow Park (synthetic)', 210, '2022-04-01', '', 'held', '16.5', '', '1.85', ''],
    ], "Sponsor's track record: prior deals, projected and actual")
    ds.doc('01-offering-memorandum', f"""
Briarwood Commons — seller's offering memorandum (synthetic)

204 units in six buildings. Stabilized net operating income: {money(c, om_noi)}.
---page---
Capital plan: {money(c, budget)} ({money(c, ds.amt(1500))} per door) covers all deferred maintenance.
Rents are shown at pro-forma market levels.
""", "Seller's offering memorandum with stated NOI and capital plan")
    ds.doc('02-private-placement-memorandum', f"""
Briarwood Investors LLC — confidential private placement memorandum (synthetic)

Offering of membership interests under Rule 506(c) of Regulation D. Accredited investors only.
Sponsor and manager: {ds.company}. Property: Briarwood Commons, 204 units.
---page---
The offering

Purchase price: {money(c, price)}. Senior loan: {money(c, loan)}, interest-only at 5% a year.
Equity raised from investors: {money(c, equity)}. Planned hold: 5 years.
Occupancy at acquisition: {occupancy}%.
NOI growth assumption: 3% per year. Exit cap rate assumption: 6%.
---page---
Summary of fees paid to the Manager

Acquisition fee: 2% of the purchase price, paid at closing.
Asset management fee: 2% of equity raised, paid each year.
Disposition fee: 1% of the sale price, paid at sale.
No other fees are paid to the Manager or its affiliates.
---page---
Distributions

Preferred return: 8% per year to the investors, cumulative.
Thereafter, 70% to the investors and 30% to the Manager until the investors reach a 15% IRR.
Thereafter, 60% to the investors and 40% to the Manager.
---page---
Projected returns (not a guarantee)

Projected investor IRR: {stated_irr}%.
Projected equity multiple: {multiple}x.
Projected average cash-on-cash return: {coc}%.
""", 'Private placement memorandum: the offering, fee summary, distributions and projected returns')
    ds.doc('03-operating-agreement', f"""
Operating agreement of Briarwood Investors LLC (synthetic)

Manager: {ds.company}. Investor Members: the accredited investors admitted under the offering.
---page---
Article 7. Compensation of the Manager

7.1 Acquisition fee: 2% of the purchase price of the Property, paid at closing.
7.2 Asset management fee: 2% of the capital contributed by the Investor Members, each year.
7.3 Disposition fee: 1% of the gross sale price of the Property.
7.4 Loan guarantee fee: 1% of the original loan amount, paid at closing.
---page---
Article 8. Distributions

8.1 Preferred return: 8% per year, compounding annually, until the Investor Members have received their capital and the preferred return.
8.2 Thereafter, 70% to the Investor Members and 30% to the Manager until the Investor Members reach a 15% IRR.
8.3 Thereafter, 60% to the Investor Members and 40% to the Manager.
""", 'Operating agreement: fees, preferred return and promote')
    ds.doc('04-investor-deck', f"""
{ds.company} — Briarwood Commons investor presentation (synthetic)

A 204-unit garden-style community, bought below replacement cost.
---page---
Our track record

Cedar Hollow Apartments delivered a 21.4% investor IRR.
Maple Run Townhomes delivered a 17.9% investor IRR.
Stonebridge Flats delivered a 19.2% investor IRR.
""", "Sponsor's investor deck with its track record")
    ds.findings = [
        ('Offering memorandum NOI above the T-12', f"the seller's memorandum states {money(c, om_noi)}; `t12.csv` sums to {money(c, noi)}."),
        ('Deferred maintenance above the capital plan', f'`unit-inspections.csv` estimates {money(c, repair)} of repairs against a {money(c, budget)} capital plan.'),
        ('Delinquency concentrated in Building C', f'{pct(c_share)} of delinquent units in `delinquency.csv` are in Building C.'),
        ('Loss-to-lease (upside, not price)', f'occupied units are {pct(ltl_sum / mkt_sum)} below market rent in `rent-roll.csv`.'),
        ('Stated investor IRR inconsistent with the recomputed waterfall', f'planted defect (a), on the **Syndication** tab: the PPM states {stated_irr}%; the waterfall recomputed from the operating agreement on the base case gives {irr}% (`documents/02-private-placement-memorandum.pdf` page 5).'),
        ('Track-record claim with no actuals behind it: Stonebridge Flats', 'planted defect (b), on the **Syndication** tab: the deck claims 19.2%; `track-record.csv` has no actual return for it (`documents/04-investor-deck.pdf` page 2).'),
        ('Fee in the operating agreement missing from the PPM: loan guarantee fee', 'planted defect (c), on the **Syndication** tab: 1% of the loan in `documents/03-operating-agreement.pdf` page 2; the PPM fee summary (page 3) omits it.'),
    ]
    ds.syndication_step = [
        'Open the **Syndication** tab (it appears only on a multifamily syndication pact).', '',
        '1. Under **The offering**, enter:', '',
        '   | Field | Enter |', '   |---|---|',
        f'   | Purchase price | `{price:.0f}` |', f'   | Loan | `{loan:.0f}` |', '   | Interest rate (%) | `5` |',
        f'   | Equity raised | `{equity:.0f}` |', '   | Hold (years) | `5` |', '   | Selling costs (%) | `2` |',
        '   | Year-1 NOI | leave empty (the T-12 is used) |', '   | Exemption | **Rule 506(c)** |',
        '   | NOI growth (%), downside / base / upside | `1` / `3` / `4.5` |', '   | Exit cap rate (%), downside / base / upside | `6.5` / `6` / `5.5` |', '',
        '   → **Save the offering**.',
        '2. Under **Read the offering documents**, click **Read with AI** for `02-private-placement-memorandum.pdf` (PPM), `03-operating-agreement.pdf` (Operating agreement) and `04-investor-deck.pdf` (Investor deck).',
        '3. Under **To confirm**, check each proposed term or claim against its quote, then **Confirm** it (or correct the figure first, or **Reject** it). Only confirmed items feed the waterfall.',
        '4. Click **Run offering checks**.', '',
        f'**You should see:** **Waterfall check** with the base case recomputed from the operating agreement (investor IRR {irr}%, against the PPM\'s {stated_irr}%), downside and upside alongside, each labelled as a scenario computed from stated assumptions; the **Track record** table with Stonebridge Flats\' actual IRR shown as not documented; and three offering drafts on **Findings**.', '']
    ds.notes = [
        'Sponsor-side pack: you are the sponsor. The property side is the Multifamily pack, unchanged; the offering side reads the PPM, operating agreement and deck on the **Syndication** tab: **Read with AI** on each, confirm what it proposes, then **Run offering checks**.',
        f'Offering terms for the **Syndication** tab: purchase price `{price:.0f}`, loan `{loan:.0f}` at `5`%, equity raised `{equity:.0f}`, hold `5` years, selling costs `2`%, Rule 506(c); paths (NOI growth / exit cap %): downside `1` / `6.5`, base `3` / `6`, upside `4.5` / `5.5`. Leave year-1 NOI empty to use the T-12.',
        f'The waterfall recomputed on the base case: investor IRR {irr}%, equity multiple {multiple}x, average cash-on-cash {coc}%. The multiple and cash-on-cash the PPM states agree; the IRR does not.',
        'Planted defect (d), a property finding the sponsor does not publish to investors, arrives with the investor view (T-106 PR 2).',
        'Diligence support only: not legal advice, no accreditation determination, no securities-offering or broker-dealer function.',
    ]
    history_readme(ds, history)

def music(ds):
    """Music rights (T-140): a publishing and masters catalog of 120 works with four semi-annual statements and planted defects."""
    ds.kind, ds.kind_label = 'sync_licence', 'direct licence'
    ds.summary = f'{ds.company} owns a catalog of 120 song copyrights and recorded masters, administered by a third party and sold for its royalty income.'
    rng, c = ds.rng, ds.cur
    periods = ['2024-12-31', '2025-06-30', '2025-12-31', '2026-06-30']
    words_a = ['Harbour', 'Silver', 'Northern', 'Paper', 'Velvet', 'Midnight', 'Copper', 'Glass', 'Summer', 'Hollow', 'Neon', 'River', 'Quiet', 'Golden', 'Wild', 'Distant', 'Amber', 'Static', 'Lantern', 'Open']
    words_b = ['Lights', 'Roads', 'Hearts', 'Skies', 'Lines', 'Rooms', 'Waves', 'Fields', 'Echoes', 'Signals', 'Gardens', 'Streets', 'Letters', 'Shores', 'Engines', 'Hours']
    societies = ['Cardinal PRS (synthetic)', 'Northbeam Rights (synthetic)']
    writers = [f'WR-{i:03d}' for i in range(1, 31)]
    works, splits, grants, lines = [], [], [], []
    hit, over, leaks = 'W-0042', 'W-0077', ['W-0018', 'W-0063']
    exposed = set()
    used = {'Harbour Lights'}
    for i in range(1, 121):
        wid = f'W-{i:04d}'
        while True:
            title = f'{rng.choice(words_a)} {rng.choice(words_b)}'
            if wid == hit or title not in used: break
        if wid == hit: title = 'Harbour Lights'
        used.add(title)
        recording = i > 100
        year = 2012 if wid == hit else (1979 + (i * 7) % 46)
        if wid in leaks: year = 2016 + (i % 3)
        us = 'no' if i % 6 == 0 and wid != hit else 'yes'
        society = societies[i % 2]
        works.append([wid, title, 'recording' if recording else 'composition', '' if recording else f'T-{900000000 + i:09d}-{i % 10}', f'QZ-K7S-{year % 100:02d}-{i:05d}' if recording else '', '' if recording else society, f'{ds.company}', year, us])
        # Writers and splits (compositions); masters are works made for hire.
        n = 1 if recording else 2 if wid == hit else 1 + (i % 3)
        team = [writers[(i * 3 + k * 7) % 30] for k in range(n)]
        shares = {1: [100], 2: [50, 50], 3: [40, 30, 30]}[n]
        if wid == over: shares = [55, 50]; team = team[:2]
        if not recording:
            for k, (w, sh) in enumerate(zip(team, shares)):
                splits.append([f'S-{i:04d}-{k + 1}', wid, w, sh, 'split_sheet'])
                if i % 10 == 3:
                    splits.append([f'S-{i:04d}-{k + 1}P', wid, w, sh, 'statement'])
        grants.append([f'G-{i:04d}-R', wid, 'registration', f'{year}-03-01', '', '', '', f'PA{1000000 + i * 37:010d}'])
        if recording:
            grants.append([f'G-{i:04d}-H', wid, 'work_for_hire', f'{year}-01-15', '', '', '', f'Recording agreement RA-{i:04d}'])
        elif wid != hit:
            for k, w in enumerate(team):
                grants.append([f'G-{i:04d}-A{k + 1}', wid, 'assignment', f'{year}-02-01', '', '', w, f'Assignment {wid}/{k + 1}'])
            # §203: executed 1986-06-30 to 2001-06-30 opens inside a 10-year hold from 2026-06-30 and has not lapsed.
            if us == 'yes' and 1987 <= year <= 2001: exposed.add(wid)
        grants.append([f'G-{i:04d}-M', wid, 'administration', '2019-07-01', '', '', '', 'Administration agreement AA-2019'])
        # Income: a base by age, decaying a little each half-year; the hit is the largest by far.
        age = 2026 - year
        base = D(60000) if wid == hit else D(rng.randint(900, 2600)) * (D('1.6') if age <= 10 else D('1'))
        decay = D('0.94') if age <= 10 else D('0.985')
        for p, period in enumerate(periods):
            amount = base * decay ** p
            if recording:
                lines.append([f'L-{wid}-{period}-st', period, wid, 'streaming', 'Lattice Digital Distribution (synthetic)', amount * D('0.7')])
                lines.append([f'L-{wid}-{period}-nr', period, wid, 'neighbouring', 'Fernway Neighbouring Rights (synthetic)', amount * D('0.3')])
            else:
                if wid not in leaks:
                    lines.append([f'L-{wid}-{period}-pf', period, wid, 'performance', society, amount * D('0.55')])
                lines.append([f'L-{wid}-{period}-mc', period, wid, 'mechanical', 'Keystone Mechanical Agency (synthetic)', amount * D('0.45')])
            if wid == hit:
                lines.append([f'L-{wid}-{period}-sy', period, wid, 'sync', 'Direct licences', D(4000)])
    # Scale the exposed works so their grants carry about 30% of trailing income.
    trailing = lambda keep: sum((l[5] for l in lines if l[1] > '2025-06-30' and keep(l[2])), D(0))
    factor = (D('0.30') * trailing(lambda w: w not in exposed)) / (D('0.70') * trailing(lambda w: w in exposed))
    for l in lines:
        if l[2] in exposed: l[5] = l[5] * factor
        l[5] = ds.amt(l[5])
    rows = [[*l[:5], f'{l[5]:.2f}'] for l in lines]
    ds.ext('works-register', ['work_id', 'title', 'work_type', 'iswc', 'isrc', 'pro', 'publisher', 'release_year', 'us_work'], works, 'Works and rights register: one row per composition or master')
    ds.ext('writer-splits', ['split_id', 'work_id', 'writer_ref', 'share_pct', 'source'], splits, 'Writer splits from the split sheets, and as statements pay them (pseudonymous writer references)')
    ds.ext('chain-of-title', ['grant_id', 'work_id', 'grant_type', 'executed_on', 'publication_date', 'copyright_secured_on', 'grantor_ref', 'reference'], grants, 'Chain of title: registrations, assignments, administration and work-for-hire agreements')
    ds.ext('royalty-statements', ['line_id', 'period_end', 'work_id', 'income_source', 'payer', 'amount'], rows, 'Royalty statement lines by work, period and income source, net to the catalog owner')
    # Direct sync licences billed by the owner (the billing export).
    for j, (name, months) in enumerate([('Brightlane Films (synthetic)', ['2025-02', '2025-11', '2026-05']), ('Pixelcourt Games (synthetic)', ['2025-08', '2026-03']), ('Orchard Lane Advertising (synthetic)', ['2024-12', '2025-09', '2026-07'])]):
        ds.customer(f'{ds.prefix}-lic-{j + 1:03d}', name, {mo: ds.amt(6500 + 1500 * j) for mo in months})
    # Figures the README and the checks state.
    in_trailing = lambda l: l[1] > '2025-06-30'
    total = sum((l[5] for l in lines if in_trailing(l)), D(0))
    by_work = {}
    for l in lines:
        if in_trailing(l): by_work[l[2]] = by_work.get(l[2], D(0)) + l[5]
    exposed_income = sum((v for w, v in by_work.items() if w in exposed), D(0))
    hit_income = by_work[hit]
    ledger = ds.amt(412500)
    lien = ds.amt(1500000)
    over_writers = [row[2] for row in splits if row[1] == over and row[4] == 'split_sheet']
    # The ask: about fourteen times trailing statement income, before diligence.
    ds.ask = sig2(total * 14)
    ds.doc('01-catalog-summary', f"""
{ds.company} — catalog sale summary (synthetic)

The catalog: 120 works — 100 song copyrights and 20 recorded masters — released between 1979 and 2024, administered by Keystone Music Administration (synthetic).
---page---
Rights and income

The seller owns the copyrights and masters outright, by assignment from the writers and under recording agreements.
There are no unrecouped advances outstanding against the catalog.
The catalog is sold free of liens and encumbrances.
Income is reported semi-annually by the administrator; statements for the last two years are in the data room.
""", 'The seller\'s catalog sale summary')
    ds.doc('02-split-sheet-w0077', f"""
Split sheet — {over} {works[76][1]} (synthetic)

Writers and shares as signed:
---page---
Split sheet {over}: {over_writers[0]} 55%, {over_writers[1]} 50%.
Signed by both writers on 1 March {works[76][7]}.
""", 'Split sheet for one composition, as signed')
    ds.doc('03-administration-agreement', f"""
Administration agreement AA-2019 — {ds.company} and Keystone Music Administration (synthetic)
---page---
4.1 The Administrator collects all income from the catalog worldwide and accounts to the Owner semi-annually.
6.2 The Administrator paid the Owner an advance of {money(c, ds.amt(600000))}, recoupable from the Owner's share of income before any payment to the Owner.
""", 'Administration agreement, with the advance and recoupment terms')
    ds.doc('04-administration-ledger', f"""
Keystone Music Administration (synthetic) — account statement for {ds.company}

Statement period ending 2026-06-30.
---page---
Account summary

Income credited this period, net of the administration fee, is applied first to the advance.
Unrecouped balance carried forward: {money(c, ledger)}.
""", 'The administrator\'s account statement and advance ledger')
    ds.doc('05-lien-search', f"""
Lien and UCC search report — {ds.company} (synthetic)
---page---
Results

One record found. A UCC-1 financing statement was filed in favour of Northgate Credit Partners (synthetic), securing obligations up to {money(c, lien)} against the catalog and its income.
""", 'Lien and UCC search over the selling entity')
    ds.findings = [
        ('Chain-of-title gap: Harbour Lights', f'planted defect (a): {hit} earned {money(c, hit_income)} in the year to June 2026 ({pct(hit_income / total)} of trailing income), but `chain-of-title.csv` holds a registration and no assignment for it.'),
        ('Termination exposure inside the hold period', f'planted defect (b): grants behind {pct(exposed_income / total)} of trailing income ({len(exposed)} works, {money(c, exposed_income)} a year) become terminable under §203 before a 10-year hold ends.'),
        (f'Split mismatch: {works[76][1]}', f'planted defect (c): the split sheet for {over} totals 105% in `writer-splits.csv` (and `documents/02-split-sheet-w0077.pdf`).'),
        ('Unrecouped advance not disclosed', f'planted defect (d): `documents/04-administration-ledger.pdf` page 2 shows {money(c, ledger)} unrecouped; the catalog summary says there are none. Priced off the price.'),
        ('Income concentration: Harbour Lights', f'{hit} is {pct(hit_income / total)} of trailing income — above the 15% the pack flags.'),
        ('Royalty leakage: registered works with no performance income', f'{leaks[0]} and {leaks[1]} earn mechanicals but no performance income while works of the same age do.'),
        ('Undisclosed encumbrance: Northgate Credit Partners (synthetic)', f'`documents/05-lien-search.pdf` page 2: a UCC-1 filing securing {money(c, lien)}; the catalog summary says the catalog is free of liens. An indemnity.'),
    ]
    ds.music_step = [
        'Open the **Catalog** tab (it appears only on a music rights pact).', '',
        f'**You should see:** the works register (120 works), trailing net income of {money(c, total)} for the year to 30 June 2026 by source and catalog age, the decay-adjusted income the royalty multiple applies to, and **Termination exposure**: {pct(exposed_income / total)} of trailing income behind grants that become terminable inside the 10-year hold.', '',
        '1. Under **Read the rights documents**, click **Read with AI** for `02-split-sheet-w0077.pdf` and `04-administration-ledger.pdf`.',
        '2. Under **To confirm**, check each proposed entry against its quote, then **Confirm** it (or correct it first, or **Reject** it). Only confirmed entries join the register and the math.',
        '3. Click **Run catalog checks**: it runs the same rules as Findings, over the confirmed entries too, and adds nothing already drafted.', '']
    ds.notes = [
        'Buyer-side pack: you are a catalog buyer. The register, splits, chain of title and statements are CSV imports; rights documents are read on the **Catalog** tab, where a person confirms each entry before it counts.',
        f'For the **Valuation** tab, the method is shown as **Royalty multiple**: use the decay-adjusted income from the **Catalog** tab as the income, and price the termination exposure finding as its own line (the exposed income × your multiple).',
        'Termination windows follow 17 U.S.C. §203 and §304(c) as the Catalog tab states; whether a notice is or could be validly served is for counsel.',
        'Diligence support only: not legal advice. Pactlab makes no determination that title is good or that a termination notice is valid.',
    ]

def month_end(mo):
    yy, mm = map(int, mo.split('-'))
    nxt = (yy + 1, 1) if mm == 12 else (yy, mm + 1)
    import datetime
    return (datetime.date(nxt[0], nxt[1], 1) - datetime.timedelta(days=1)).isoformat()

def energy(ds):
    """Energy generation & rights (T-142): one coal plant and a mineral, royalty and working-interest portfolio, with planted defects."""
    ds.kind, ds.kind_label = 'power_sales', 'power sale'
    plant_name = 'Cinder Ridge Station (synthetic)'
    ds.summary = f'{ds.company} sells a 600 MW coal-fired plant, {plant_name}, together with a portfolio of oil and gas mineral, royalty and working interests in 20 wells.'
    rng, c = ds.rng, ds.cur
    offtaker, pool = 'Valley Electric Cooperative (synthetic)', 'Midcontinent Power Pool (synthetic)'
    ppa_end = '2028-06-30'
    # The plant register.
    ds.ext('plant-register', ['plant_id', 'name', 'fuel', 'capacity_mw', 'commissioned_year', 'capacity_factor_pct', 'ppa_counterparty', 'ppa_expires_on'],
           [['PL-001', plant_name, 'coal', '600', '1981', '52', offtaker, ppa_end]], 'Plant register: capacity, fuel, age, capacity factor and PPA')
    # Plant production: about half capacity, 80% sold under the PPA; and the billing export of the same sales.
    plant_rows, ppa_sales, pool_sales = [], {}, {}
    for i, mo in enumerate(MONTHS):
        mwh = whole(D(600) * D(730) * (D('0.50') + D(rng.randint(-3, 3)) / D(100)))
        contracted, merchant = whole(mwh * D('0.8')), mwh - whole(mwh * D('0.8'))
        rev_c, rev_m = ds.amt(contracted * D('42')), ds.amt(merchant * D(rng.randint(30, 55)))
        end = month_end(mo)
        plant_rows.append([f'PR-PL001-{mo}-C', 'PL-001', end, 'power', f'{contracted}', f'{rev_c:.2f}', 'contracted'])
        plant_rows.append([f'PR-PL001-{mo}-M', 'PL-001', end, 'power', f'{merchant}', f'{rev_m:.2f}', 'merchant'])
        ppa_sales[mo], pool_sales[mo] = rev_c, rev_m
    ds.customer(f'{ds.prefix}-off-001', offtaker, ppa_sales)
    ds.customer(f'{ds.prefix}-pool-002', pool, pool_sales)
    # Interests, one lease each, plus undeveloped leases not held by production.
    wells = ['Ridgeback', 'Cottonwood', 'Bluestem', 'Mesquite', 'Red Fork', 'Saltgrass', 'Blackjack', 'Prairie Hen', 'Caddo', 'Wolf Creek']
    operators = ['Plainsview Operating (synthetic)', 'Hardpan Energy (synthetic)', 'Ochre Basin Resources (synthetic)']
    interests, leases, prod = [], [], []
    error_id = 'OG-007'
    for i in range(1, 21):
        iid, lid = f'OG-{i:03d}', f'LS-{i:03d}'
        name = f'{wells[(i - 1) % 10]} {i}H (synthetic)'
        kind = ['mineral', 'royalty', 'working', 'mineral'][i % 4]
        royalty = [D('0.1875'), D('0.2'), D('0.25')][i % 3]
        orri = D('0.03') if kind == 'working' else D('0')
        share = D('0.25') if kind == 'working' else D('0.5')
        if iid == error_id: kind, share, royalty, orri = 'mineral', D('0.5'), D('0.1875'), D('0')
        nri = share * (1 - royalty - orri) if kind == 'working' else share * royalty
        stated = D('0.125') if iid == error_id else nri
        acres = D(rng.randint(12, 32) * 10)
        interests.append([iid, name, f'Section {i + 4}, T{10 + i % 5}N, R{20 + i % 7}W (synthetic)', lid, kind, f'{share}', f'{stated:.8f}', operators[i % 3]])
        leases.append([lid, f'LR-{i:03d}', f'{acres}', f'{royalty}', f'{orri}' if orri else '', f'{2008 + i % 10}-04-01', f'{2013 + i % 10}-04-01', 'yes'])
        # Production: oil and gas declining about 10% a year (gross, 8/8ths).
        oil0, gas0 = D(rng.randint(900, 2200)), D(rng.randint(4000, 12000))
        for k, mo in enumerate(MONTHS):
            f = D('0.9') ** (D(k) / D(12))
            oil, gas = whole(oil0 * f), whole(gas0 * f)
            end = month_end(mo)
            prod.append([f'PR-{iid}-{mo}-O', iid, end, 'oil', f'{oil}', f'{ds.amt(oil * D(70)):.2f}', ''])
            prod.append([f'PR-{iid}-{mo}-G', iid, end, 'gas', f'{gas}', f'{ds.amt(gas * D("2.80")):.2f}', ''])
    held = sum((D(l[2]) for l in leases), D(0))
    # About 25% of all net acres: undeveloped leases, not held by production, expiring within 18 months of 30 September 2026.
    expiring = ['2026-12-31', '2027-03-31', '2027-06-30', '2027-09-30', '2027-12-31', '2028-03-31']
    target = held / D(3)  # exposed = 1/4 of the total when exposed = held / 3
    per = whole(target / len(expiring))
    for j, end in enumerate(expiring):
        acres = per if j < len(expiring) - 1 else whole(target) - per * (len(expiring) - 1)
        leases.append([f'LS-{21 + j:03d}', f'LR-{21 + j:03d}', f'{acres}', '0.1875', '', f'{2023 + j % 2}-01-01', end, 'no'])
    total_acres = sum((D(l[2]) for l in leases), D(0))
    exposed_acres = sum((D(l[2]) for l in leases if l[7] == 'no'), D(0))
    ds.ext('interest-register', ['interest_id', 'name', 'legal_description', 'lease_id', 'interest_type', 'interest_share', 'division_order_nri', 'operator'], interests, 'Interest register: mineral, royalty and working interests with the division-order decimal')
    ds.ext('lease-schedule', ['lease_id', 'lessor_ref', 'net_acres', 'royalty_rate', 'overriding_royalty', 'effective_on', 'expires_on', 'held_by_production'], leases, 'Lease schedule: net acres, royalty chain, primary term and whether production holds each lease')
    ds.ext('production-history', ['record_id', 'asset_id', 'period_end', 'product', 'volume', 'gross_revenue', 'sales_type'], plant_rows + prod, 'Production history: plant generation and revenue by contract type, and well volumes and gross revenue')
    # The seller's liability schedule: the ARO is booked at 60% of the study, and the ash pond is not on it.
    aro, booked_aro, ash = ds.amt(42000000), ds.amt(25200000), ds.amt(18400000)
    liabilities = [['LB-001', 'PL-001', 'aro', 'Plant retirement obligation', f'{booked_aro:.2f}'],
                   ['LB-002', 'PL-001', 'remediation', 'Coal yard runoff remediation', f'{ds.amt(1100000):.2f}']]
    for i in (3, 7, 11, 15, 19):
        liabilities.append([f'LB-{i + 100:03d}', f'OG-{i:03d}', 'aro', 'Well plugging and abandonment', f'{ds.amt(85000):.2f}'])
    ds.ext('liability-schedule', ['liability_id', 'asset_id', 'kind', 'description', 'booked_amount'], liabilities, 'The seller\'s liability schedule: environmental and retirement obligations as booked')
    err = next(r for r in interests if r[0] == error_id)
    trailing_rev = sum((D(r[5]) for r in prod if r[1] == error_id and r[2] > '2025-09-30'), D(0))
    yearly = (D('0.125') - D('0.09375')) * trailing_rev
    pdp, pdnp, pud = 1240, 310, 880
    ds.ask = sig2(ds.amt(190000000))
    ds.ask_note = 'This is the seller\'s ask for the plant and the interests together. The demo shows how far the evidence supports it.'
    ds.doc('01-sale-summary', f"""
{ds.company} — sale summary (synthetic)

The package: {plant_name}, a 600 MW coal-fired plant commissioned in 1981, and mineral, royalty and working interests in 20 producing wells.
---page---
Assets and obligations

The plant sells most of its output to {offtaker} under a long-term power purchase agreement.
The seller's liability schedule lists the environmental and retirement obligations it carries for the plant and the wells.
Leases on the producing wells are held by production.
""", 'The seller\'s sale summary')
    ds.doc('02-title-opinion', f"""
Division-order title opinion — {ds.company} interests (synthetic)
---page---
Opinion

Ownership of the mineral, royalty and working interests in Schedule A is vested of record in {ds.company}, subject to the leases listed there.
""", 'Division-order title opinion over the interests')
    ds.doc('03-division-order-og007', f"""
Division order — {err[1]} ({error_id}) (synthetic)
---page---
Owner: {ds.company}. Interest type: mineral (royalty). Decimal interest: 0.12500000.
Operator: {err[7]}.
""", 'The operator\'s division order for one well')
    ds.doc('04-power-purchase-agreement', f"""
Power purchase agreement — {plant_name} and {offtaker}
---page---
2.1 The Buyer purchases 80% of the net output of {plant_name} at the contract price.
2.4 This agreement terminates on 30 June 2028.
""", 'The plant\'s power purchase agreement')
    ds.doc('05-reserve-report', f"""
Third-party reserve report — {ds.company} oil and gas interests (synthetic)

Prepared by Lantern Petroleum Engineers (synthetic) as of 30 September 2026.
---page---
Reserves and values

Net PDP reserves: {pdp:,} MBOE.
Net PDNP reserves: {pdnp:,} MBOE.
Net PUD reserves: {pud:,} MBOE.
PDP discounted at 10%: {money(c, ds.amt(24600000))}.
PDNP discounted at 10%: {money(c, ds.amt(4100000))}.
PUD discounted at 10%: {money(c, ds.amt(7300000))}.
The forecast assumes an annual decline of 12% for the producing wells.
""", 'Third-party reserve report: reserves by category, values and the decline assumed')
    ds.doc('06-ash-pond-closure-plan', f"""
Ash pond closure plan — {plant_name}
---page---
Closure cost

The closure plan for {plant_name} ash pond estimates closure and groundwater remediation costs of {money(c, ash)}.
""", 'Closure and remediation plan for the plant\'s coal ash pond')
    ds.doc('07-decommissioning-study', f"""
Decommissioning study — {plant_name}
---page---
Cost to retire

The decommissioning study for {plant_name} estimates the cost to retire and decommission the plant at {money(c, aro)}.
""", 'Decommissioning study for the plant')
    ds.findings = [
        (f'Unbooked environmental liability: Coal ash (CCR) closure at {plant_name}', f'planted defect (a): `documents/06-ash-pond-closure-plan.pdf` page 2 estimates {money(c, ash)}; `liability-schedule.csv` books nothing for the ash pond. A remediation cost.'),
        (f'ARO shortfall: {plant_name}', f'planted defect (b): the decommissioning study estimates {money(c, aro)}; the schedule books {money(c, booked_aro)} (60%), {money(c, aro - booked_aro)} short — underfunded by 40%. An escrow.'),
        ('Lease expiry risk: acreage not held by production', f'planted defect (c): {pct(exposed_acres / total_acres)} of the net acres ({exposed_acres:.0f} of {total_acres:.0f}) are not held by production and expire by 31 March 2028, within 18 months.'),
        (f'Royalty decimal error: {err[1]}', f'planted defect (d): the division order for {error_id} pays 0.12500000; the lease chain (0.5 × 3/16) supports 0.09375000 — overpaid by about {money(c, yearly)} a year.'),
        (f'PPA cliff: {plant_name}', f'the PPA with {offtaker} ends on {ppa_end}, inside the 5-year hold: 80% of the plant\'s revenue turns merchant.'),
    ]
    ds.energy_step = [
        'Open the **Assets** tab (it appears only on an energy generation & rights pact).', '',
        f'**You should see:** the plant and the 20 interests, contract coverage of about 80% on the plant, production declining about 10% a year, **Lease expiry**: {pct(exposed_acres / total_acres)} of the net acres not held by production inside the 5-year hold, one **division-order decimal** off the lease chain, and the **Liabilities** table: the ash pond unbooked and the ARO 40% short.', '',
        '1. Under **Read the reports**, click **Read with AI** for `05-reserve-report.pdf`, `06-ash-pond-closure-plan.pdf` and `07-decommissioning-study.pdf`.',
        '2. Under **To confirm**, check each proposed entry against its quote, then **Confirm** it (or correct it first, or **Reject** it). Only confirmed entries count: the reserves appear under **Reserves** as the report states them.',
        '3. Click **Run energy checks**: it runs the same rules as Findings, over the confirmed entries too, and adds nothing already drafted.', '']
    ds.notes = [
        'Buyer-side pack: you are buying the plant and the interests. Registers, the lease schedule, production and the liability schedule are CSV imports; the reserve report and environmental reports are read on the **Assets** tab, where a person confirms each entry before it counts.',
        'For the **Valuation** tab: **Reserve-based DCF** for the interests (the reserve report\'s categories and values on the **Assets** tab), or **Capacity value ($/kW)** for the plant — enter the net capacity in kW (600000) and a price per kW.',
        'Reserves are the third-party engineer\'s, cited as such; Pactlab never estimates reserves. A missing report is a gap finding.',
        'Diligence support only: not legal, engineering or regulatory advice. Pactlab makes no title determination and certifies no reserves.',
    ]

def spv(ds):
    """An organizer pools investors into one SPV for a startup's seed round (T-141). Planted defects:
    (a) the round summary's post-round share count leaves out the SAFE conversion; (b) carry is 20% in the
    operating agreement and 15% in the investor summary; (c) a side letter waives one investor's fee and the
    summary discloses none; (d) one investor in a 506(c) vehicle is only self-certified (entered on the SPV tab)."""
    ds.kind, ds.kind_label = 'subscription', 'customer subscription'
    c = ds.cur
    ds.seller, ds.buyer = f'Lumen Labs {ds.c["suffix"]}', ds.company
    vehicle = 'Halyard Lumen Seed SPV LLC (synthetic)'
    ds.summary = (f'{ds.company} is an SPV organizer pooling five investors into {vehicle}, which takes one line in the seed round of {ds.seller}, '
                  'a field-service scheduling startup. Offered under Rule 506(c).')
    teams = [('Brightline Plumbing', 14000), ('Copperfield Electric', 12000), ('Northgate HVAC', 10500), ('Tidewater Roofing', 9500), ('Juniper Landscapes', 8500),
             ('Ashby Pest Control', 8000), ('Marlow Cleaning Co', 7500), ('Fernhill Glazing', 7000), ('Oriel Locksmiths', 6500), ('Kestrel Pools', 6000),
             ('Wrenfield Joinery', 5500), ('Halden Solar', 5000)]
    for i, (n, base) in enumerate(teams):
        ds.customer(f'{ds.prefix}-cus-{i + 1:03d}', f'{n} (synthetic)', ramp(ds.rng, ds.amt(base), '0.01', noise=D('0.01')))
    billed = ds.billed_arr()
    claimed_arr = (billed / 10000).quantize(D('1'), ROUND_HALF_UP) * 10000
    # The startup's cap table before the round: 8,000,000 shares, one SAFE (pseudonymous holders).
    price = ds.amt(1)
    principal, cap = ds.amt(300000), ds.amt(6000000)
    rows = [
        ['CS-1', 'F-1', 'founder', 'common', 3500000, '', '', '', 'no', 'no', 'yes', '2023-03-01'],
        ['CS-2', 'F-2', 'founder', 'common', 2500000, '', '', '', 'no', 'no', 'yes', '2023-03-01'],
        ['CS-3', 'E-01', 'employee', 'common', 400000, '', '', '', 'no', 'no', 'yes', '2024-05-01'],
        ['OP-1', 'E-02', 'employee', 'option', 600000, '', '', '', 'no', 'no', 'yes', '2025-01-15'],
        ['POOL', 'POOL', 'pool', 'pool_unallocated', 1000000, '', '', '', 'no', 'no', 'no', '2024-05-01'],
        ['SAFE-1', 'I-1', 'investor', 'safe', '', f'{principal:.2f}', f'{cap:.2f}', '20', 'no', 'yes', 'no', '2025-06-01'],
    ]
    ds.ext('cap-table', ['security_id', 'holder_ref', 'holder_type', 'instrument', 'shares', 'principal', 'valuation_cap', 'discount_pct', 'mfn', 'pro_rata', 'vesting', 'issued_on'], rows,
           'The startup\'s cap table before the round, one row per security (pseudonymous holders)')
    pre_shares, new_shares = 8000000, 3000000
    conversion = int(principal / (cap / pre_shares))  # converts at the cap price: 400,000 shares
    post_true, post_stated = pre_shares + conversion + new_shares, pre_shares + new_shares
    burns = [ds.amt(b) for b in (80000, 82000, 85000, 88000, 90000, 92000, 94000, 96000, 98000, 100000, 100000, 100000)]
    cash, balances = ds.amt(1800000), []
    for burn in reversed(burns):
        balances.append(cash); cash += burn
    ds.ext('monthly-financials', ['month', 'cash_balance', 'net_burn'], [[mo, f'{bal:.2f}', f'{burn:.2f}'] for mo, burn, bal in zip(LAST12, burns, reversed(balances))],
           'The startup\'s cash balance and net burn by month')
    seats = [('INV-01', 'Marlowe Family Office (synthetic)', 600000, 'THIRD_PARTY_VERIFIED'), ('INV-02', 'Pinecrest Angels LLC (synthetic)', 500000, 'THIRD_PARTY_VERIFIED'),
             ('INV-03', 'Quayle Partners (synthetic)', 450000, 'THIRD_PARTY_VERIFIED'), ('INV-04', 'Rowan Okafor (synthetic)', 250000, 'SELF_CERTIFIED'),
             ('INV-05', 'Sable Point Capital (synthetic)', 150000, 'THIRD_PARTY_VERIFIED')]
    organizer = ds.amt(50000)
    commitments = sum(ds.amt(a) for _, _, a, _ in seats) + organizer
    fee, expenses = commitments * D('0.02'), ds.amt(25000)
    invested = commitments - fee - expenses
    ds.doc('01-round-summary', f"""
ROUND SUMMARY — Seed round of {ds.seller} (synthetic)

The startup's own summary of the round, as shared with the SPV organizer.
---page---
Pre-money valuation: {c} {pre_shares * price:,.0f}.
Round size: {c} {new_shares * price:,.0f}.
Price per share: {c} {price:.2f}.
New shares issued: {new_shares:,}.
Fully diluted shares after the round: {post_stated:,}.
ARR: {c} {claimed_arr:,.0f}.
Runway: 18 months.
Net revenue retention: 128%.
Prior round: SAFE with a valuation cap of {c} {cap:,.0f} and a 20% discount, with pro-rata rights.
""", 'The startup\'s round summary: size, price, valuation and its headline claims')
    ds.doc('02-safe-1', f"""
SIMPLE AGREEMENT FOR FUTURE EQUITY — {ds.seller} (synthetic)
---page---
Instrument: SAFE-1.
Purchase Amount: {c} {principal:,.0f}.
Valuation Cap: {c} {cap:,.0f}.
Discount Rate: 20%.
Most favoured nation: no.
Pro rata rights: yes.
Signed 1 June 2025.
""", 'The signed SAFE from the startup\'s earlier round')
    ds.doc('03-spv-operating-agreement', f"""
OPERATING AGREEMENT OF {vehicle.upper()}

{ds.company} is the Manager of the vehicle.
---page---
Management Fee: 2% of capital commitments, charged once at closing.
Carried Interest: 20% of net profits.
Expenses: up to {c} {expenses:,.0f} of organizational expenses, borne by the Members.
Organizer Commitment: {c} {organizer:,.0f} alongside the Members.
This offering is made under Rule 506(c) of Regulation D.
""", 'The vehicle\'s operating agreement: fee, carry, expenses and the offering exemption')
    ds.doc('04-spv-investor-summary', f"""
SUMMARY OF TERMS for investors in {vehicle}
---page---
Management fee: 2% of commitments, charged once.
Carry: 15%.
Expenses: capped at {c} {expenses:,.0f}.
Side letters: none.
""", 'The summary of terms given to investors')
    ds.doc('05-side-letter-inv-03', f"""
SIDE LETTER to the operating agreement of {vehicle}
---page---
Investor reference: INV-03.
Management fee: waived for this investor.
Information rights: quarterly reports.
""", 'A side letter with one investor')
    ds.doc('06-form-d', f"""
FORM D — Notice of Exempt Offering of Securities (synthetic)
---page---
Issuer: {vehicle}.
Filed with the SEC on 2 October 2026.
""", 'The vehicle\'s Form D filing confirmation')
    ds.ask = pre_shares * price
    ds.ask_note = 'This is the round\'s stated pre-money: the price the vehicle buys in at. The demo shows how far the evidence supports the round.'
    ds.findings = [
        ('Cap table does not add up after the round', f'planted defect (a): the round summary states {post_stated:,} fully diluted shares after the round; the cap table with SAFE-1 converted gives {post_true:,} — exactly the {conversion:,} shares SAFE-1 converts into.'),
        ('Carried interest in the operating agreement differs from the investor summary', 'planted defect (b): 20% in `documents/03-spv-operating-agreement.pdf`, 15% in `documents/04-spv-investor-summary.pdf`.'),
        ('Side letter grants preferential terms the summary does not disclose', 'planted defect (c): `documents/05-side-letter-inv-03.pdf` waives INV-03\'s fee; the summary says "Side letters: none." Organizer-side only.'),
        ('Accreditation gap in a 506(c) vehicle', 'planted defect (d): INV-04 is recorded as self-certified in a Rule 506(c) vehicle (from the seats you enter on the SPV tab).'),
        ('Stated pre-money ties to the cap table', f'confirmed: {c} {price:.2f} × 8,000,000 pre-round shares is the stated pre-money.'),
        ('Prior-round terms match the signed instruments', 'confirmed: the summary\'s SAFE cap and discount match `documents/02-safe-1.pdf`.'),
        ('Round claim verified: ARR', f'the summary\'s ARR ties to `invoice-lines.csv` (billed {money(c, billed)} for September 2026).'),
        ('Round claim verified: Runway', '18 months agrees with `monthly-financials.csv`.'),
        ('Round claim not verified: Net revenue retention', 'a gap: nothing in the evidence checks the 128% claim. Ask the startup for the cohort data.'),
    ]
    ds.spv_step = [
        'Open the **SPV** tab (it appears only on a startup equity SPV).', '',
        f'1. Under **The vehicle**, enter Vehicle name `{vehicle}`, and the exits (× post-money) Downside `0.5`, Base `3`, Upside `10` → **Save the vehicle**.',
        '2. Under **Investor seats**, add each seat (one at a time) → **Add seat**:', '',
        '   | Investor | Reference | Commitment | Accreditation |', '   |---|---|---|---|',
        *[f'   | {label} | `{ref}` | `{ds.amt(amount):.0f}` | **{ {"THIRD_PARTY_VERIFIED": "Verified by a third party", "SELF_CERTIFIED": "Self-certified"}[status]}** |' for ref, label, amount, status in seats], '',
        '3. Click **Run SPV checks**. Drafts appear on **Findings**; a person decides each.',
        f'4. **You should see** under **Vehicle economics**: commitments {money(c, commitments)} (the seats plus the organizer\'s {money(c, organizer)}), management fee {money(c, fee)}, expenses {money(c, expenses)}, invested {money(c, invested)}; carry 20% in the agreement against 15% in the summary.',
        f'5. Under **Round verification**: the cap table gives {post_true:,} shares after the round against the summary\'s {post_stated:,}; SAFE-1 converts into {conversion:,} shares at its cap.',
        '6. Under **Investor view**, click **Preview** and then **Publish version 1**. The published view holds the round claims, the cap-table check, the vehicle economics and the return scenarios — never the side letter, the seats or any other investor.', '']
    ds.notes = [
        'Organizer-side pack: you run the vehicle. Investors are seated as guests and see only their own seat and the published investor view; the startup sees the vehicle as one investor and never the investor list.',
        'Accreditation is tracked, never determined: record what a verification specialist found, with a link and an evidence pointer.',
        'Return scenarios are computed from the exit paths you state — never a projection or a promise.',
        'Diligence support only: not legal advice. Pactlab performs no securities-offering, broker-dealer or investment-adviser function.',
    ]

PACKS = [
    ('software-saas', 'Brightwave Software', software), ('fintech', 'Tallyport Payments', fintech), ('healthcare', 'Riverside Care Partners', healthcare),
    ('telecom-media', 'Northlake Fibre', telecom), ('professional-services', 'Sablestone Consulting', services), ('pharma-biotech', 'Calvera Pharmaceuticals', pharma),
    ('ecommerce-dtc', 'Ridgeline Outfitters', ecommerce), ('hotels', 'Harbourview Hotel Holdings', hotels), ('multifamily', 'Larkfield Residential', multifamily),
    ('commercial-property', 'Quayside Estates', commercial), ('hospitals', 'St. Brennan Health', hospitals), ('small-clinics', 'Clearbrook Clinics', clinics),
    ('venture-raise', 'Loopwise', venture), ('multifamily-syndication', 'Ashgrove Residential', syndication), ('music-rights', 'Fairlight Songs', music),
    ('energy-generation', 'Cinder Ridge Energy', energy),
    ('startup-spv', 'Halyard Syndicate', spv),
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
