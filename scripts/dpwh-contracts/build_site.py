"""The site's contractor files, from DPWH's contract list (fetch.py) and the GAA links (match.py).

Every contract with a contractor counts, FY2016–FY2026, straight from DPWH's list. Only the link from a contract to a
GAA line is ours (match.py), and the pages say so. A joint-venture contract counts in full for each partner.

    python build_site.py CONTRACTS_PARQUET LINKS_DIR MPB_LINES_CSV OUT_DIR

OUT_DIR (data/hgab/2027/contractors, published with upload:hgab --only=contractors):
  index.json       every contractor with its figures (cols + rows, offices and regions as dictionaries)
  c/NN.json        each contractor's contracts, in 64 files by a hash of its key (src/lib/hgab-contractors.ts)
  mpb-links.json   the contract and contractors of each multi-purpose building line on the map, FY2020–FY2026
  contractors.csv  the index as a spreadsheet
  summary.json     sources, totals, the builder's checks and each output's SHA-256
"""
import csv, hashlib, io, json, re, sys, unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import duckdb

CONTRACTS, LINKS_DIR, MPB_CSV, OUT = sys.argv[1], Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
YEARS = list(range(2016, 2027))
SHARDS = 64
STATUSES = ['Completed', 'On-Going', 'Not Yet Started', 'Terminated', 'For Procurement']
METHODS = ['one_to_one', 'bundle']
# "NAME (12345)", "NAME ([REVOKED] 12345)", "[REVOKED] NAME (12345)", "NAME (OECO_27310)"; a name with no number is
# keyed by the name
PARTY = re.compile(r'^(.*?)\s*\((?:\[([^\]]+)\]\s*)?((?:OECO_)?\d+)\)\s*$')


def fnv1a(s):
    """32-bit FNV-1a over UTF-8, the shard hash (the page computes the same in TypeScript)."""
    h = 0x811C9DC5
    for b in s.encode('utf-8'):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def shard_of(key):
    return fnv1a(key) % SHARDS


def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:60]


def parties(s):
    out = []
    for part in re.split(r'\s+/\s+', (s or '').strip()):
        part = part.strip()
        if not part:
            continue
        m = PARTY.match(part)
        if m:
            name, tag, pid = m.groups()
            # the tag can also come first: "[REVOKED] NAME (12345)"
            lead = re.match(r'^\[([^\]]+)\]\s*(.*)$', name.strip())
            if lead:
                tag, name = tag or lead.group(1), lead.group(2)
            out.append((pid, name.strip(), pid, tag))
        else:
            out.append(('n-' + slug(part), part, None, None))
    # a contractor named twice on one contract counts once
    seen, uniq = set(), []
    for p in out:
        if p[0] not in seen:
            seen.add(p[0]); uniq.append(p)
    return uniq


def cents(x):
    return round(float(x or 0), 2)


con = duckdb.connect()
C = con.sql(f"""select contractId, description, contractor, budget, status, progress, location.province office,
  location.region region, try_cast(infraYear as int) yr, startDate, completionDate
  from read_parquet('{CONTRACTS}') order by contractId""").fetchall()
meta = json.loads(Path(CONTRACTS).with_name('contracts.meta.json').read_text())
L = con.sql(f"""select contract_id, line_id, fiscal_year, gaa_title, gaa_php, method
  from read_parquet('{LINKS_DIR / 'links.parquet'}') order by contract_id, line_id""").fetchall()
match_summary = json.loads((LINKS_DIR / 'summary.json').read_text())
mpb_ids = {r['line_id'] for r in csv.DictReader(open(MPB_CSV, encoding='utf-8-sig'))
           if 2020 <= int(r['fiscal_year']) <= 2026}

lines_of = defaultdict(list)
for cid, lid, fy, title, gphp, method in L:
    lines_of[cid].append((lid, title, int(gphp), method))

offices, regions = [], []
office_ix, region_ix = {}, {}


def ix(table, index, v):
    v = v or ''
    if v not in index:
        index[v] = len(table); table.append(v)
    return index[v]


who = {}                          # key → figures
names = defaultdict(Counter)      # key → name → contracts
contracts_of = defaultdict(list)  # key → contract rows for its shard
contract_parties = {}
with_contractor = 0
amount_with_contractor = 0.0
for cid, desc, contractor, budget, status, progress, office, region, yr, start, done in C:
    ps = parties(contractor)
    if not ps:
        continue
    with_contractor += 1
    amount_with_contractor += cents(budget)
    keys = [p[0] for p in ps]
    contract_parties[cid] = keys
    oi, ri = ix(offices, office_ix, office), ix(regions, region_ix, region)
    si = STATUSES.index(status) if status in STATUSES else -1
    links = lines_of.get(cid, [])
    for key, name, pid, tag in ps:
        names[key][name] += 1
        w = who.setdefault(key, dict(id=pid, tagged=0, n=0, php=0.0, jv_n=0, jv_php=0.0, status=[0] * 4,
                                     years_php=[0.0] * len(YEARS), years_n=[0] * len(YEARS),
                                     office_php=Counter(), office_n=Counter(), regions=set(), lines={}, linked=0))
        w['tagged'] += tag == 'REVOKED'
        w['n'] += 1; w['php'] += cents(budget)
        if len(ps) > 1:
            w['jv_n'] += 1; w['jv_php'] += cents(budget)
        if 0 <= si < 4:
            w['status'][si] += 1
        if yr in YEARS:
            w['years_php'][yr - YEARS[0]] += cents(budget); w['years_n'][yr - YEARS[0]] += 1
        w['office_php'][oi] += cents(budget); w['office_n'][oi] += 1
        w['regions'].add(ri)
        if links:
            w['linked'] += 1
            for lid, _, gphp, _ in links:
                w['lines'][lid] = gphp
        contracts_of[key].append([cid, yr, desc or '', oi, cents(budget), si, progress, str(start or '') or None,
                                  str(done or '') or None, [k for k in keys if k != key],
                                  [[lid, title, gphp, METHODS.index(m)] for lid, title, gphp, m in links]])

# index
COLS = ['key', 'name', 'id', 'revoked', 'contracts', 'php', 'jv_contracts', 'jv_php', 'completed', 'ongoing',
        'not_started', 'terminated', 'first_year', 'last_year', 'years_php', 'years_n', 'offices', 'top_office',
        'top_office_php', 'regions', 'linked_contracts', 'linked_lines', 'linked_gaa_php', 'aliases']
rows = []
for key, w in who.items():
    common = names[key].most_common()
    yrs = [YEARS[i] for i, n in enumerate(w['years_n']) if n]
    top = max(w['office_php'].items(), key=lambda kv: (kv[1], -kv[0]))[0]
    rows.append([key, common[0][0], w['id'], w['tagged'] > 0, w['n'], round(w['php'], 2), w['jv_n'], round(w['jv_php'], 2),
                 *w['status'], yrs[0] if yrs else None, yrs[-1] if yrs else None,
                 [round(x, 2) for x in w['years_php']], w['years_n'], len(w['office_php']), top,
                 round(w['office_php'][top], 2), len(w['regions']), w['linked'], len(w['lines']),
                 sum(w['lines'].values()), [n for n, _ in common[1:6]]])
rows.sort(key=lambda r: (-r[5], r[0]))
built_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'c').mkdir(exist_ok=True)
index = dict(schema=1, built_at=built_at, years=YEARS, statuses=STATUSES, offices=offices, regions=regions,
             contracts_downloaded=meta['downloaded_to'], cols=COLS, rows=rows)


def dump(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


dump(OUT / 'index.json', index)

# shards: each contractor's contracts, newest first
shards = defaultdict(dict)
for key, cs in contracts_of.items():
    cs.sort(key=lambda r: (-(r[1] or 0), r[0]))
    shards[shard_of(key)][key] = cs
for f in (OUT / 'c').glob('*.json'):
    f.unlink()
for s in range(SHARDS):
    dump(OUT / 'c' / f'{s:02d}.json', dict(schema=1, built_at=built_at, shard=s,
         cols=['contract_id', 'year', 'description', 'office', 'php', 'status', 'progress', 'start', 'completion',
               'partners', 'lines'], line_cols=['line_id', 'title', 'gaa_php', 'method'], methods=METHODS,
         contractors=shards.get(s, {})))

# the map's lines: one contract each (one_to_one or one line of a bundle)
mpb_who, mpb_who_ix, mpb_rows = [], {}, []
name_of = {r[0]: r[1] for r in rows}
by_line = defaultdict(list)
for cid, lid, fy, title, gphp, method in L:
    if lid in mpb_ids:
        by_line[lid].append((cid, method))
budget_of = {r[0]: (cents(r[3]), r[4]) for r in C}
for lid in sorted(by_line):
    for cid, method in by_line[lid]:
        ks = contract_parties.get(cid, [])
        mpb_rows.append([lid, cid, [ix(mpb_who, mpb_who_ix, k) for k in ks], budget_of[cid][0],
                         STATUSES.index(budget_of[cid][1]) if budget_of[cid][1] in STATUSES else -1, METHODS.index(method)])
dump(OUT / 'mpb-links.json', dict(schema=1, built_at=built_at, statuses=STATUSES, methods=METHODS,
     contractors=[[k, name_of[k]] for k in mpb_who], cols=['line_id', 'contract_id', 'contractors', 'php', 'status', 'method'],
     rows=mpb_rows))

# CSV
buf = io.StringIO()
w = csv.writer(buf)
w.writerow(['contractor', 'license_id', 'marked_revoked_in_dpwh_list', 'contracts', 'contract_amount_php',
            'joint_venture_contracts', 'joint_venture_amount_php', 'completed', 'ongoing', 'not_yet_started', 'terminated',
            'first_year', 'last_year', *[f'amount_{y}_php' for y in YEARS], 'dpwh_offices', 'main_office',
            'main_office_amount_php', 'regions', 'contracts_linked_to_gaa_lines', 'gaa_lines_linked_2020_2026',
            'gaa_lines_amount_php', 'other_names', 'page'])
for r in rows:
    d = dict(zip(COLS, r))
    w.writerow([d['name'], d['id'] or '', 'yes' if d['revoked'] else '', d['contracts'], f"{d['php']:.2f}",
                d['jv_contracts'], f"{d['jv_php']:.2f}", d['completed'], d['ongoing'], d['not_started'], d['terminated'],
                d['first_year'] or '', d['last_year'] or '', *[f'{x:.2f}' for x in d['years_php']], d['offices'],
                offices[d['top_office']], f"{d['top_office_php']:.2f}", d['regions'], d['linked_contracts'],
                d['linked_lines'], d['linked_gaa_php'], '; '.join(d['aliases']),
                f"https://budget.bettergov.ph/hgab/2027/contractors/{d['key']}"])
(OUT / 'contractors.csv').write_text('﻿' + buf.getvalue(), encoding='utf-8')

# checks
shard_contracts = sum(len(cs) for sh in shards.values() for cs in sh.values())
unique_amount = {}
for sh in shards.values():
    for cs in sh.values():
        for r in cs:
            unique_amount[r[0]] = r[4]
linked_contracts = {cid for cid, *_ in L}
checks = {
    'every_contract_with_a_contractor_is_listed': len(unique_amount) == with_contractor,
    'contract_amounts_add_up': abs(sum(unique_amount.values()) - amount_with_contractor) < 1,
    'index_counts_equal_shards': sum(r[4] for r in rows) == shard_contracts,
    'keys_unique': len({r[0] for r in rows}) == len(rows),
    'every_linked_contract_has_a_contractor': linked_contracts <= set(contract_parties),
    'map_lines_are_map_lines': {r[0] for r in mpb_rows} <= mpb_ids,
}
outputs = {p.name if p.parent == OUT else f'c/{p.name}': hashlib.sha256(p.read_bytes()).hexdigest()
           for p in sorted([*OUT.glob('*.json'), OUT / 'contractors.csv', *(OUT / 'c').glob('*.json')])
           if p.name != 'summary.json'}
summary = dict(
    schema=1, built_at=built_at,
    source=dict(api=meta['source'], downloaded_from=meta['downloaded_from'], downloaded_to=meta['downloaded_to'],
                contracts=meta['contracts'], api_summary=meta['api_summary']),
    totals=dict(contractors=len(rows), contracts_with_contractor=with_contractor,
                contracts_without_contractor=meta['contracts'] - with_contractor,
                amount_php=round(amount_with_contractor, 2),
                joint_venture_contracts=sum(1 for k in contract_parties.values() if len(k) > 1),
                revoked_contractors=sum(1 for r in rows if r[3]), map_lines_with_contract=len(by_line),
                map_lines_fy2020_2026=len(mpb_ids), years=[YEARS[0], YEARS[-1]]),
    gaa_links=dict(years=match_summary['years'], rules=match_summary['rules'], built_at=match_summary['built_at']),
    shards=SHARDS, checks=checks, outputs=outputs)
(OUT / 'summary.json').write_text(json.dumps(summary, indent=1, ensure_ascii=False) + '\n')
print(json.dumps(summary['totals']))
print('checks:', checks)
if not all(checks.values()):
    sys.exit('a check failed')
