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
        self.ask = None
        self.ask_note = None
        self.pnl = None  # (header, rows, {line: kind as Pactlab shows it}): a P&L by year, imported on Sources (T-161)

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
            self.doc('99-data-room-extracts', '\n---page---\n'.join(pages), 'Every CSV extract in this folder as one paged PDF, so findings can cite a page', 'Financial')
        for name, (text, _, _) in self.docs.items():
            open(os.path.join(d, 'documents', f'{name}.md'), 'w').write(text)
        if self.pnl:
            header, rows, kinds = self.pnl
            b = io.StringIO(); ww = csv.writer(b, lineterminator='\n'); ww.writerow(header); ww.writerows(rows)
            open(os.path.join(d, 'pnl.csv'), 'w').write(b.getvalue())
            # What each line is, for scripted imports (the demo organization); a person picks them on screen.
            b = io.StringIO(); ww = csv.writer(b, lineterminator='\n'); ww.writerow(['line', 'kind']); ww.writerows([[line, PNL_KIND_IDS[kind]] for line, kind in kinds.items()])
            open(os.path.join(d, 'pnl-line-kinds.csv'), 'w').write(b.getvalue())
        # VDR index
        b = io.StringIO(); ww = csv.writer(b, lineterminator='\n')
        ww.writerow(['doc_id', 'title', 'file', 'data_class', 'as_of'])
        ww.writerow([f'{self.prefix.upper()}-001', 'Invoice lines, Oct 2024 – Sep 2026', 'invoice-lines.csv', 'Financial', '2026-09-30'])
        i = 1
        for name, (_, _, desc) in self.extracts.items():
            i += 1; ww.writerow([f'{self.prefix.upper()}-{i:03d}', desc, f'{name}.csv', 'Financial', '2026-09-30'])
        if self.pnl:
            i += 1; ww.writerow([f'{self.prefix.upper()}-{i:03d}', 'Profit and loss by fiscal year', 'pnl.csv', 'Financial', '2026-09-30'])
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
               f'**Fictional target.** {self.summary}', f'Based in {self.c["city"]}, {self.c["country"]}; reports in {c}. Data runs October 2024 to September 2026.', '',
               '> Synthetic demo data. Every company, person, address, account and figure here is invented.', '',
               '## Before you start', '',
               '- Download this whole folder (on GitHub: **Code → Download ZIP** at the top of the repository, then unzip).',
               '- Sign in to Pactlab. The steps take about 15 minutes.',
               f'- You upload **{1 + len(imports) + (1 if self.pnl else 0)} CSV file{"s" if imports or self.pnl else ""}** and **{len(pdfs)} PDF{"s" if len(pdfs) != 1 else ""}**. Nothing else.',
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
        if self.pnl:
            header, rows, kinds = self.pnl
            heading('Upload the P&L, by year')
            out += [f'`pnl.csv` holds the profit and loss for fiscal years {", ".join(header[1:])}, one column per year. Pactlab reads every year, so the trend across them shows.', '',
                    '1. On **Sources**, under **Industry data**, click **Upload profit and loss (p&l)** → `pnl.csv` → **Upload and map columns**.',
                    '2. The line names and the years are read from the file. Under **What each line is**, choose:', '',
                    '   | Line | What it is |', '   |---|---|']
            out += [f'   | `{line}` | **{kind}** |' for line, kind in kinds.items()]
            out += ['', f'3. Click **Check every row**, then **Import {len(rows) * (len(header) - 1)} rows**.', '',
                    '**You should see:** the statement for each year, adding up. **Quality of earnings** and **Valuation** read every imported year.', '']
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
            else:
                out.append(f'| `{name}.csv` | {desc} ({len(rows)} rows) | **No** — it is already inside `documents/99-data-room-extracts.pdf`, which you upload |')
        if self.pnl:
            out.append(f'| `pnl.csv` | Profit and loss by fiscal year ({len(self.pnl[1])} lines × {len(self.pnl[0]) - 1} years) | **Yes** — P&L step |')
            out.append('| `pnl-line-kinds.csv` | What each P&L line is, as you choose it on screen | **No** — the P&L step lists the same |')
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
    'fintech': {'loan-tape': 'Loan tape', 'aml-alerts': 'AML alerts'},
    'multifamily': {'rent-roll': 'Rent roll', 't12': 'T-12 operating statement', 'delinquency': 'Delinquency report', 'unit-inspections': 'Unit inspections'},
    'healthcare': {'claims-summary': 'Claims summary', 'provider-roster': 'Provider roster'},
    'telecom-media': {'subscribers-by-month': 'Subscribers by month'},
    'professional-services': {'timesheets-summary': 'Timesheets summary', 'headcount-movements': 'Headcount movements'},
    'pharma-biotech': {'patent-schedule': 'Patent schedule', 'pipeline': 'Pipeline'},
    'ecommerce-dtc': {'orders-by-cohort': 'Orders by cohort', 'ad-spend': 'Ad spend'},
    'commercial-property': {'rent-roll': 'Commercial rent roll', 'cam-reconciliation': 'CAM reconciliation'},
    'hotels': {'operating-history': 'Operating history', 'str-benchmark': 'STR benchmark'},
    'small-clinics': {'patient-volume': 'Patient volume', 'equipment-schedule': 'Equipment schedule', 'coding-summary': 'Coding summary', 'claims-summary': 'Claims summary',
                      'provider-roster': 'Provider roster', 'service-lines': 'Service-line margins', 'visit-summary': 'Visits by provider and referral'},
    'hospitals': {'census': 'Census', 'payer-mix': 'Payer mix'},
    'venture-raise': {'cap-table': 'Cap table', 'monthly-financials': 'Monthly financials'},
    'multifamily-syndication': {'rent-roll': 'Rent roll', 't12': 'T-12 operating statement', 'delinquency': 'Delinquency report', 'unit-inspections': 'Unit inspections', 'track-record': 'Sponsor track record'},
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
# The P&L step's line kinds as Pactlab shows them, and their ids.
PNL_KIND_IDS = {'Revenue': 'REVENUE', 'Cost of revenue': 'COGS', 'Operating expense': 'OPEX', 'Other income': 'OTHER_INCOME', 'Other expense': 'OTHER_EXPENSE'}
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

def property_units(ds, buildings, per_building, arrears_building):
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

def multifamily(ds):
    ds.kind, ds.kind_label = 'rent', 'unit rent charge'
    ds.summary = f'{ds.company} owns Larkfield Commons, a 96-unit garden-style apartment community in three buildings (A, B, C).'
    rows, delinq, ltl_sum, mkt_sum, repair = property_units(ds, 'ABC', 32, 'C')
    t12, noi = property_t12(ds)
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
    ds.summary = f'{ds.company} runs six dental and physiotherapy clinics with 22 providers, paid by insurers and patients. Its founder, the selling owner, still treats patients at Site 1.'
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

    # The healthcare evidence, scaled to a small roster (T-161): claims by payer with steady denials, credentials all current.
    claims = []
    for mo in LAST12:
        for (n, _), rate in zip(payers, ['4.0', '5.0', '6.0', '2.0']):
            paid = next(m2 for _, nn, m2 in ds.customers if nn == f'{n} (synthetic)')[mo]
            claims.append([mo, f'{n} (synthetic)', 300 + len(n) * 10, f'{q(paid * D("1.25")):.2f}', f'{paid:.2f}', rate])
    ds.ext('claims-summary', ['month', 'payer', 'claims', 'billed', 'paid', 'denial_rate_pct'], claims, 'Monthly claims billed, paid and denial rate by payer')
    team = [('P01', 'General dentistry and implants', '1.0'), ('P02', 'General dentistry', '1.0'), ('P03', 'General dentistry', '0.8'), ('P04', 'Hygiene', '1.0'),
            ('P05', 'Hygiene', '0.6'), ('P06', 'Physiotherapy', '1.0'), ('P13', 'Physiotherapy', '0.8')]
    ds.ext('provider-roster', ['provider_ref', 'specialty', 'fte', 'credential_expiry'], [[ref, spec, fte, f'{2028 + i % 2}-{(i * 2) % 12 + 1:02d}-01'] for i, (ref, spec, fte) in enumerate(team)], 'Provider roster, pseudonymous, with credential expiry dates')

    # Visits by service line, provider and referral source (defects a and c): P01 is the selling owner and the only implant provider.
    sources = [('Harbourside Orthodontic Group (synthetic)', D('0.58')), ('Self-referred', D('0.22')), ('Insurer Bluepoint network (synthetic)', D('0.12')), ('Other local practices', D('0.08'))]
    lines = [('Implants', 'P01', 'owner', 50, 1400), ('General dentistry', 'P01', 'owner', 100, 180), ('General dentistry', 'P02', 'associate', 150, 180),
             ('General dentistry', 'P03', 'associate', 100, 180), ('Hygiene', 'P04', 'associate', 200, 110), ('Hygiene', 'P05', 'associate', 100, 110),
             ('Physiotherapy', 'P06', 'associate', 150, 95), ('Physiotherapy', 'P13', 'contractor', 100, 95)]
    visits, referred, owner_coll, all_coll = [], D(0), D(0), D(0)
    for mo in LAST12:
        for line, ref, role, count, fee in lines:
            for source, share in sources:
                n = int(count * share)
                coll = ds.amt(n * fee)
                visits.append([mo, line, ref, role, source, n, f'{coll:.2f}'])
                referred += n if source.startswith('Harbourside') else 0
                all_coll += coll; owner_coll += coll if role == 'owner' else 0
    total_visits = sum(row[5] for row in visits)
    ds.ext('visit-summary', ['month', 'service_line', 'provider_ref', 'provider_role', 'referral_source', 'visits', 'collections'], visits, 'Visits and collections by service line, pseudonymous provider and referral source')
    margins = {'Implants': D('0.31'), 'General dentistry': D('0.58'), 'Hygiene': D('0.64'), 'Physiotherapy': D('0.70')}  # direct costs ÷ revenue
    yearly = {line: sum(count * fee for l2, _, _, count, fee in lines if l2 == line) * 12 for line in margins}
    service = [[str(year), line, f'{ds.amt(yearly[line] * g):.2f}', f'{ds.amt(yearly[line] * g * margins[line]):.2f}'] for year, g in ((2024, D('0.89')), (2025, D('0.94')), (2026, D('1'))) for line in margins]
    ds.ext('service-lines', ['year', 'service_line', 'revenue', 'direct_costs'], service, 'Revenue and direct costs by service line and fiscal year')

    # Three fiscal years of P&L (defect d): revenue up 6% a year, clinical supplies up 15% a year.
    years = ['2024', '2025', '2026']
    revenue = [D('2450000'), D('2597000'), D('2752820')]
    supplies = [D('220500'), D('253575'), D('291611.25')]
    pnl_lines = [('Patient fees', 'Revenue', revenue), ('Clinical supplies', 'Cost of revenue', supplies), ('Lab fees', 'Cost of revenue', [r * D('0.05') for r in revenue]),
                 ('Associate and staff costs', 'Operating expense', [r * D('0.46') for r in revenue]), ('Rent and occupancy', 'Operating expense', [D('190000')] * 3),
                 ('Other operating costs', 'Operating expense', [r * D('0.085') for r in revenue])]
    ds.pnl = (['Line'] + years, [[name] + [f'{ds.amt(v):.2f}' for v in values] for name, _, values in pnl_lines], {name: kind for name, kind, _ in pnl_lines})
    ratio = [ds.amt(sv) / ds.amt(rv) for sv, rv in zip(supplies, revenue)]

    c = ds.cur
    ds.doc('01-coding-policy', f'''
{ds.company} — coding and billing policy (synthetic)

Highest-complexity codes are expected for about 15% of visits. Higher shares require a documented clinical review.
''', 'Coding and billing policy')
    ds.doc('02-site-1-premises-lease', f'''
Lease of 14 Harbour Row, Site 1 — {ds.company} (synthetic)

Landlord: Harbour Row Estates Ltd (synthetic). Tenant: {ds.company}.
The term of this lease expires on 31 March 2028.
Tenant has no option to renew or extend the term.
The tenant may not assign this lease, including on a sale of the practice, without the landlord's prior written consent.
Base rent: {money(c, ds.amt(15800))} per month.
''', 'Premises lease for Site 1, the flagship practice')
    ds.doc('03-transaction-timetable', f'''
Project Clearbrook — transaction timetable (synthetic)

The target closing date is 31 January 2027.
Exclusivity runs to the target closing date.
---page---
Premises note (synthetic)

Estimated cost to relocate and fit out a replacement site: {money(c, ds.amt(420000))}.
''', 'Transaction timetable, with a premises note')
    ds.findings = [
        ('One provider carries Site 3', f'P07 earns {pct(site3_p07 / site3_total)} of Site 3 revenue in `patient-volume.csv` — a retention risk after closing.'),
        ('High-complexity coding above policy', '`coding-summary.csv` shows 31–36% of visits at the highest code against the 15% expected by `documents/01-coding-policy.pdf`.'),
        ('Imaging equipment past its useful life', 'two panoramic X-ray units in `equipment-schedule.csv` (2014 and 2015, ten-year lives). Price as remediation.'),
        ('Selling owner is the only provider of Implants', f'P01, the selling owner, delivers {pct(owner_coll / all_coll)} of collections in `visit-summary.csv` and is the only provider of Implants, the highest-margin service line in `service-lines.csv`; no succession plan is filed.'),
        (f'One referral source sends {pct(D(referred) / D(total_visits))} of visits', f'Harbourside Orthodontic Group refers {pct(D(referred) / D(total_visits))} of visits in `visit-summary.csv`.'),
        ('Clinic lease ends 14 months after closing with no renewal option', '`documents/02-site-1-premises-lease.pdf` (expires 31 March 2028, no renewal option) against the target closing date in `documents/03-transaction-timetable.pdf`; priced from its relocation estimate.'),
        ('Clinical supplies outpacing revenue', f'`pnl.csv` — supplies grow 15% a year against revenue\'s 6%, from {pct(ratio[0])} to {pct(ratio[2])} of revenue over 2024–2026. Any one year looks normal.'),
    ]
    ds.notes = ['Providers are pseudonymous (P01, P02, …); the selling owner is a role in `visit-summary.csv`, never a name. Pactlab never sends people data to a model.',
                'Referral sources are businesses or "Self-referred"; Pactlab counts visits and makes no judgment on the referral arrangement.']

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
    rows, delinq, ltl_sum, mkt_sum, repair = property_units(ds, 'ABCDEF', 34, 'C')
    t12, noi = property_t12(ds)
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
