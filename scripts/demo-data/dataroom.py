#!/usr/bin/env python3
"""Arrange each demo dataset as a seller's data room (T-098): <pack>/<CUR>/dataroom/ and dataroom.zip.

Runs after build.sh has made the PDFs. Everything is invented and deterministic.
What a seller actually hands over: inconsistent file names, folders that do not
always match the content, and deliberate tests for Pactlab's intake —
  - a balance sheet filed under Legal (the content decides, not the folder),
  - the same agreement saved twice (shown once),
  - a year summary mixing profit and cash flow (the AI should ask),
  - gaps: no cash flow statement, and one structured export left out.
Each README gains an "Intake test" section listing what Pactlab should conclude.
Usage: python3 scripts/demo-data/dataroom.py <out_dir>
"""
import csv, os, shutil, sys, zipfile
from decimal import Decimal

OUT = sys.argv[1]
STAMP = (2026, 9, 30, 0, 0, 0)

# Structured exports → what intake should file them as (import target labels, as Pactlab shows them).
EXPORT_LABELS = {
    'invoice-lines': 'Invoice lines',
    'loan-tape': 'Loan tape', 'aml-alerts': 'AML alerts',
    'rent-roll': 'Rent roll', 't12': 'T-12 operating statement', 'delinquency': 'Delinquency report', 'unit-inspections': 'Unit inspections',
    'claims-summary': 'Claims summary', 'provider-roster': 'Provider roster',
    'subscribers-by-month': 'Subscribers by month',
    'timesheets-summary': 'Timesheets summary', 'headcount-movements': 'Headcount movements',
    'patent-schedule': 'Patent schedule', 'pipeline': 'Pipeline',
    'orders-by-cohort': 'Orders by cohort', 'ad-spend': 'Ad spend',
    'cam-reconciliation': 'CAM reconciliation',
    'operating-history': 'Operating history', 'str-benchmark': 'STR benchmark',
    'patient-volume': 'Patient volume', 'equipment-schedule': 'Equipment schedule', 'coding-summary': 'Coding summary',
    'census': 'Census', 'payer-mix': 'Payer mix',
    'cap-table': 'Cap table', 'monthly-financials': 'Monthly financials',
}
COMMERCIAL_RENT_ROLL = {'commercial-property'}

# Document name keywords → (folder, category label intake should settle on). First match wins.
DOCUMENT_RULES = [
    ('balance-sheet', ('04 Legal', 'Balance sheet')),          # deliberately misfiled
    ('lease', ('03 Commercial/Leases', 'Lease')),
    ('loan', ('04 Legal', 'Loan agreement')), ('facility', ('04 Legal', 'Loan agreement')), ('credit', ('04 Legal', 'Loan agreement')),
    ('contractor', ('03 Commercial/Suppliers', 'Supplier contract')), ('supplier', ('03 Commercial/Suppliers', 'Supplier contract')),
    ('vendor', ('03 Commercial/Suppliers', 'Supplier contract')), ('partner', ('03 Commercial/Suppliers', 'Supplier contract')),
    ('reseller', ('03 Commercial/Suppliers', 'Supplier contract')), ('wholesale', ('03 Commercial/Suppliers', 'Supplier contract')),
    ('agreement', ('03 Commercial/Customers', 'Customer contract')), ('contract', ('03 Commercial/Customers', 'Customer contract')),
    ('order-form', ('03 Commercial/Customers', 'Customer contract')), ('msa', ('03 Commercial/Customers', 'Customer contract')),
    ('incorporation', ('01 Corporate', 'Corporate record')), ('minutes', ('01 Corporate', 'Corporate record')),
    ('83b', ('01 Corporate', 'Corporate record')), ('safe-register', ('01 Corporate', 'Corporate record')), ('term-sheet', ('01 Corporate', 'Corporate record')),
    ('policy', ('05 Policies', 'Policy')), ('insurance', ('05 Policies', 'Policy')), ('privacy', ('05 Policies', 'Policy')), ('security', ('05 Policies', 'Policy')),
]


def messy(stem):
    """'02-master-services-agreement-northgate' → 'Master services agreement northgate' (how people name files)."""
    words = stem.split('-')
    if words and words[0].isdigit():
        words = words[1:]
    text = ' '.join(words)
    return text[:1].upper() + text[1:]


def rule_for(stem):
    for key, value in DOCUMENT_RULES:
        if key in stem:
            return value
    return ('02 Finance', 'Other')


def company_of(readme):
    first = readme.splitlines()[0] if readme else ''
    return first.lstrip('# ').split(' — ')[0] or 'The company'


def build(dataset_dir, pack, cur):
    room = os.path.join(dataset_dir, 'dataroom')
    shutil.rmtree(room, ignore_errors=True)
    readme_path = os.path.join(dataset_dir, 'README.md')
    readme = open(readme_path).read() if os.path.exists(readme_path) else ''
    company = company_of(readme)
    brand = company.split(' ')[0]
    rows = []      # (path in room, should be filed as, note)

    def put(src, rel, category, note=''):
        dst = os.path.join(room, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        rows.append((rel, category, note))

    # Structured exports, renamed the way a finance team saves them; the last pack export is left out (a gap).
    exports = sorted(f[:-4] for f in os.listdir(dataset_dir) if f.endswith('.csv') and f[:-4] in EXPORT_LABELS)
    pack_exports = [e for e in exports if e != 'invoice-lines']
    omitted = pack_exports[-1] if len(pack_exports) >= 2 else None
    for name in exports:
        if name == omitted:
            continue
        label = 'Commercial rent roll' if name == 'rent-roll' and pack in COMMERCIAL_RENT_ROLL else EXPORT_LABELS[name]
        put(os.path.join(dataset_dir, f'{name}.csv'), f'02 Finance/Exports/{brand} {label.lower()} export Sep26.csv', label)

    # Documents: PDFs where built, otherwise the Markdown they are built from.
    docs_dir = os.path.join(dataset_dir, 'documents')
    stems = sorted({f.rsplit('.', 1)[0] for f in os.listdir(docs_dir)}) if os.path.isdir(docs_dir) else []
    first_contract = None
    for stem in stems:
        if stem.startswith('99-'):
            continue  # the extracts PDF is Pactlab's own convenience copy, not a seller file
        ext = 'pdf' if os.path.exists(os.path.join(docs_dir, f'{stem}.pdf')) else 'md'
        folder, category = rule_for(stem)
        note = 'In the Legal folder, but it is a balance sheet: the content decides.' if category == 'Balance sheet' else ''
        rel = f'{folder}/{messy(stem)}.{ext}'
        put(os.path.join(docs_dir, f'{stem}.{ext}'), rel, category, note)
        if category == 'Customer contract' and first_contract is None:
            first_contract = (os.path.join(docs_dir, f'{stem}.{ext}'), folder, messy(stem), ext)

    # The same agreement saved twice under another name: intake shows it once.
    if first_contract:
        src, folder, name, ext = first_contract
        put(src, f'{folder}/{name} (signed copy).{ext}', 'Duplicate — shown once', 'Same bytes as the agreement above.')

    # Management accounts: revenue is the last twelve months billed in invoice-lines.csv, so the figures agree.
    billed = Decimal(0)
    with open(os.path.join(dataset_dir, 'invoice-lines.csv')) as f:
        for line in csv.DictReader(f):
            if line['period_start'] >= '2025-10-01':
                billed += Decimal(line['amount'])
    costs = (billed * Decimal('0.82')).quantize(Decimal('1'))
    accounts = os.path.join(room, '02 Finance', f'Mgmt accounts FY26 - {brand}.md')
    os.makedirs(os.path.dirname(accounts), exist_ok=True)
    with open(accounts, 'w') as f:
        f.write(f'{company} — management accounts, year to 30 September 2026 (synthetic demo data)\n\n'
                f'Profit and loss ({cur})\n'
                f'Revenue: {billed.quantize(Decimal("1")):,}\n'
                f'Operating costs: {costs:,}\n'
                f'Operating profit: {(billed - costs).quantize(Decimal("1")):,}\n')
    rows.append((os.path.relpath(accounts, room), 'Income statement (P&L)', 'Revenue matches the invoice lines for Oct 2025 – Sep 2026.'))

    # A year summary mixing profit and cash flow: genuinely ambiguous, so the AI should ask.
    summary = os.path.join(room, '02 Finance', f'{brand} FY26 summary.md')
    os.makedirs(os.path.dirname(summary), exist_ok=True)
    with open(summary, 'w') as f:
        f.write(f'{company} — FY26 summary for the board (synthetic demo data)\n\n'
                f'Revenue and operating profit for the year are in the management accounts.\n'
                f'Cash generated from operations, capital expenditure and loan repayments are shown below in {cur}.\n'
                f'Operating cash flow: 610,000. Capital expenditure: 85,000. Loan repayments: 150,000. Closing cash: 310,000.\n')
    rows.append((os.path.relpath(summary, room), 'Pactlab asks: income statement or cash flow statement?', 'Mixes profit and cash flow lines.'))

    # Deterministic zip of the room.
    zip_path = os.path.join(dataset_dir, 'dataroom.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel, _, _ in sorted(rows):
            info = zipfile.ZipInfo(rel, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, open(os.path.join(room, rel), 'rb').read())

    gaps = ['Cash flow statement']
    if omitted:
        gaps.append(EXPORT_LABELS[omitted])
    has_billing = 'invoice-lines' in exports
    section = ['', '## Intake test — hand over the whole data room', '',
               '`dataroom/` is the same material arranged the way a seller hands it over, and `dataroom.zip` is that folder zipped.',
               'Use it to check that Pactlab sorts files on its own and asks only when unsure.', '',
               '1. Open the pact\'s **Diligence** tab, then **Documents**.',
               '2. Drop `dataroom.zip` on the upload box and click **Upload**.' + (' In local and dev Pactlab you can instead connect the synthetic **Brightwave Software** data room under **Data room**, then **Sync now**.' if pack == 'software-saas' else ''),
               '3. Watch each file get its own row. Clear files are filed with no click from you.',
               '4. Answer the one question under **Pactlab needs you**.', '',
               '**You should see** each file filed as:', '',
               '| File in the data room | Pactlab should file it as | Note |', '|---|---|---|']
    section += [f'| `{rel}` | {category} | {note} |' for rel, category, note in sorted(rows)]
    section += ['', '**And on the Intake checklist**, these should show as missing: ' + ', '.join(f'**{g}**' for g in gaps) + '.']
    if has_billing:
        section += ['Once billing is imported, **Customer contract** shows **Some missing** and names the largest billed customers with no contract in the room.']
    section += ['Click **Ask the seller** (or **Copy request for missing items**) to send the list.', '']
    marker = '\n## Intake test'
    base = readme.split(marker)[0].rstrip('\n') + '\n'
    open(readme_path, 'w').write(base + '\n'.join(section))
    return len(rows)


if __name__ == '__main__':
    built = 0
    for pack in sorted(os.listdir(OUT)):
        pack_dir = os.path.join(OUT, pack)
        if not os.path.isdir(pack_dir):
            continue
        for cur in sorted(os.listdir(pack_dir)):
            dataset_dir = os.path.join(pack_dir, cur)
            if os.path.isdir(dataset_dir) and os.path.exists(os.path.join(dataset_dir, 'invoice-lines.csv')):
                build(dataset_dir, pack, cur)
                built += 1
    print(f'data rooms: {built}')
