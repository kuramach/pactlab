#!/usr/bin/env python3
"""Case 1 (T-092): a synthetic two-chain grocery merger shaped like the Kroger-Albertsons failure.

Everything here is invented — companies, people, places, figures. The shape is
taken from the public record (see README.md): a 650-site divestiture cap with a
579-site package, a package skewed to weaker and loosely connected stores, a
remedy buyer that is mostly a wholesaler, regulator feedback left unanswered, a
headline price pledge nobody can verify, and heavy union overlap.
Deterministic: same files every run.
Usage: python3 demo-data/cases/case-01-grocery/generate.py
"""
import csv, json, os, random
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
rng = random.Random('case-01-grocery')
D = Decimal

ACQUIRER, TARGET = 'Meridian Markets', 'Harvest Lane Foods'
ACQ_BANNERS = ['Meridian', 'FreshWay']
TGT_BANNERS = ['Harvest Lane', 'Bayview Market', 'Corner Pantry']
REGIONS = ['Northwest', 'Mountain', 'Southwest', 'Pacific', 'Plains', 'Lakes']
RIVALS = ['Greenfield Grocers', 'ValuStop', 'Orchard & Oak', 'Pricewise Club']

sites = []
def add(party, firm, market, region, banner, full, sales, perf, union, cba, dc, systems):
    sites.append(dict(site_id=f'S{len(sites) + 1:05d}', party=party, firm=firm, market=market, region=region, banner=banner,
                      full_service='yes' if full else 'no', sales=f'{sales:.0f}', performance=f'{perf:.4f}',
                      unionized='yes' if union else 'no', cba_id=cba or '', distribution_center=dc, systems=systems))

markets = []
for r, region in enumerate(REGIONS):
    for m in range(20):
        markets.append((f'{region} Metro {m + 1:02d}', region))

# 100 of the 120 local markets overlap. In 12 the two chains are the only full-service
# grocers; in about 30% of the others one chain is only a minor presence (so not every
# overlap market meets the presumption — a realistic map, not a wall of red).
order = list(range(len(markets)))
rng.shuffle(order)
overlap = [markets[i] for i in sorted(order[:100])]
only_two = set(name for name, _ in overlap[:12])
minor = set(name for name, _ in overlap[12:] if rng.random() < 0.3)
for name, region in markets:
    r = REGIONS.index(region)
    cba = f'Food & Commercial Workers Local {100 + r} (synthetic)'
    in_overlap = (name, region) in overlap
    for party, firm, banners, dc_prefix, sysname in (('ACQUIRER', ACQUIRER, ACQ_BANNERS, 'MDC', 'Meridian POS'), ('TARGET', TARGET, TGT_BANNERS, 'HDC', 'HarvestOne')):
        if not in_overlap and party == 'TARGET':
            continue
        if in_overlap and name in minor:
            # A minor overlap: one small Harvest Lane store beside a lighter Meridian footprint.
            count = 1 if party == 'TARGET' else rng.randint(3, 5)
        elif in_overlap:
            count = rng.randint(6, 12)
        else:
            count = rng.randint(4, 10)
        for _ in range(count):
            banner = banners[rng.randrange(len(banners))]
            small = in_overlap and name in minor and party == 'TARGET'
            sales = D(rng.randint(6, 10) if small else rng.randint(14, 42)) * D(1_000_000)
            perf = (D(rng.randint(380, 820)) / D(10_000))
            union = in_overlap and rng.random() < 0.78
            add(party, firm, name, region, banner, True, sales, perf, union, cba if union else None, f'{dc_prefix}-{region}', sysname)
    # Real local markets: most keep two to four full-service rivals of comparable size.
    rivals = 0 if name in only_two else rng.randint(2, 4)
    for k in range(rivals):
        firm = RIVALS[(r + k) % len(RIVALS)]
        for _ in range(rng.randint(4, 12)):
            add('RIVAL', firm, name, region, firm, True, D(rng.randint(12, 36)) * D(1_000_000), D(rng.randint(300, 700)) / D(10_000), False, None, f'R-{firm}', 'rival')
    # Small-format stores sell groceries but are not full-service competitors.
    for _ in range(rng.randint(1, 4)):
        add('RIVAL', 'Corner Convenience Co.', name, region, 'Corner Convenience', False, D(rng.randint(1, 4)) * D(1_000_000), D('0.0300'), False, None, 'R-conv', 'rival')

# The package: 579 sites from the overlap markets, skewed to weaker stores at realistic strength, from mixed banners.
candidates = [s for s in sites if s['party'] != 'RIVAL' and (s['market'], s['region']) in overlap and s['market'] not in minor]
# Realistic strength: weaker stores are favoured, not exclusively chosen (a noisy preference, not a sort).
candidates.sort(key=lambda s: (D(s['performance']) + D(rng.randint(-420, 420)) / D(10_000), s['site_id']))
package = sorted(s['site_id'] for s in candidates[:579])
assert len(package) == 579

def write_csv(name, rows, columns):
    with open(os.path.join(HERE, name), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=columns, lineterminator='\n')
        w.writeheader()
        w.writerows(rows)

write_csv('sites.csv', sites, ['site_id', 'party', 'firm', 'market', 'region', 'banner', 'full_service', 'sales', 'performance', 'unionized', 'cba_id', 'distribution_center', 'systems'])

def dump(name, value):
    with open(os.path.join(HERE, name), 'w') as f:
        json.dump(value, f, indent=2, sort_keys=False)
        f.write('\n')

dump('package.json', dict(id='remedy-1', revision=3, date='2024-04-22', siteIds=package,
                          # Two of twelve distribution centers move with the stores; the buyer's own systems replace the rest.
                          distributionCenters=['HDC-Northwest', 'MDC-Mountain'], systemsTransferred=['HarvestOne'], buyer='Crossdock Wholesale Supply (synthetic)'))
dump('buyer.json', dict(name='Crossdock Wholesale Supply (synthetic)', retailSitesOperated=23, yearsOperatingRetail=3,
                        precedents=[dict(year=2015, note='Tidewell Grocers (synthetic) bought 146 stores divested by Harvest Lane Foods in an earlier merger and filed for bankruptcy within the year',
                                         source='Case brief, "Precedent" (modelled on the 2015 Haggen collapse after the Albertsons-Safeway divestitures)')]))
dump('terms.json', dict(signedOn='2022-10-14', outsideDate='2025-01-14', effortsStandard='REASONABLE_BEST_EFFORTS', divestitureCap=650, currency='USD',
                        terminationFees=[dict(payer='ACQUIRER', amount='600000000', trigger='Failure to obtain antitrust clearance by the outside date')],
                        sources=dict(divestitureCap='merger-agreement.md §6.3(b)', outsideDate='merger-agreement.md §8.1(b)', terminationFees='merger-agreement.md §8.3(a)', effortsStandard='merger-agreement.md §6.3(a)')))
dump('feedback.json', dict(
    rounds=[dict(round=1, date='2023-11-02', regulator='Federal antitrust agency (synthetic)', criticisms=[dict(topic='SIZE', substance='The 413-site proposal leaves too many overlap markets untouched.')]),
            dict(round=2, date='2024-02-12', regulator='Federal antitrust agency (synthetic)', criticisms=[dict(topic='COHERENCE', substance='The package is a patchwork of banners and stores without the distribution and systems to run them as one business.')])],
    revisions=[dict(revision=2, date='2024-01-18', addresses=['SIZE']), dict(revision=3, date='2024-04-22', addresses=['SIZE'])]))
dump('commitments.json', [dict(id='price-pledge', text='Meridian will invest $1 billion in lowering prices after closing.', measurement=None, enforcementParty=None, durationMonths=None)])

with open(os.path.join(HERE, 'merger-agreement.md'), 'w') as f:
    f.write("""AGREEMENT AND PLAN OF MERGER (synthetic excerpt)
between Meridian Markets, Inc. and Harvest Lane Foods, Inc., dated 14 October 2022

§6.3(a) Efforts. Each party shall use its reasonable best efforts to obtain all antitrust clearances as promptly as practicable.
§6.3(b) Divestitures. To obtain clearance, Meridian shall offer to divest stores and related assets, provided that Meridian shall not be required to divest more than 650 stores in the aggregate.
§8.1(b) Outside Date. Either party may terminate this Agreement if the Merger has not been consummated by 14 January 2025.
§8.3(a) Termination Fee. If this Agreement is terminated because antitrust clearance has not been obtained, Meridian shall pay Harvest Lane a fee of $600,000,000.
""")
print(f'sites={len(sites)} package={len(package)}')
