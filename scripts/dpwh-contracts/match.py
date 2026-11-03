"""Link DPWH GAA project lines (capital outlays, FY2020–FY2026) to DPWH contracts, to name the contractor.

Inputs: the GAA extract (data/18/full_extract.csv) and the contract list (fetch.py → contracts.parquet). Only list
fields are used: title, office, amount, fund source. A contract's fund source names its GAA year ("Regular Infra - GAA
2023 SSP"), so a line is compared only with contracts funded from the same year's GAA.

  one_to_one  one contract for the line: titles agree (token set ≥ 90) and the contract is 50–102% of the line
  bundle      one contract whose title takes in 2+ lines; the contract is 50–102% of the lines together
  none        no contract found; never filled with a guess

Two guards on top of the titles: a road line's first station (K0367 + 770) must be among the contract's stations when
the contract lists any (and its description is not cut off at 255 characters), and a Package or Phase number must not
contradict the contract's. Several contracts adding up to one line ("splits") were tried and left out: a sample check
against the contracts' component titles found only a third of them right.

District office lines are compared with that office's contracts first, then the region's (stricter: ≥ 95). Central
Office lines name no implementing office, so they are compared with every contract of the year. Except in a bundle, each
contract links to one line. Pairs are taken best first: title score, then how close the amount is to a typical award (97%).

    python match.py GAA_CSV CONTRACTS_PARQUET OUT_DIR
"""
import json, os, re, sys, unicodedata
from datetime import datetime, timezone
from pathlib import Path
import duckdb, numpy as np, pandas as pd
from rapidfuzz import fuzz, process

GAA_CSV, CONTRACTS, OUT = sys.argv[1], sys.argv[2], Path(sys.argv[3])
YEARS = range(int(os.environ.get('FROM', 2020)), int(os.environ.get('TO', 2026)) + 1)
TITLE_MIN, REGION_TITLE_MIN = 90, 95
RATIO_MIN, RATIO_MAX, RATIO_TYPICAL = 0.5, 1.02, 0.97
OUT.mkdir(parents=True, exist_ok=True)

# GAA region codes (uacs_reg_id) → the contract list's region names
REGION = {'13': 'National Capital Region', '14': 'Cordillera Administrative Region', '01': 'Region I', '02': 'Region II',
          '03': 'Region III', '04': 'Region IV-A', '17': 'MIMAROPA Region', '05': 'Region V', '06': 'Region VI',
          '07': 'Region VII', '08': 'Region VIII', '09': 'Region IX', '10': 'Region X', '11': 'Region XI',
          '12': 'Region XII', '16': 'Region XIII', '18': 'Negros Island Region'}
REGION_ALIAS = {'Region IV-B': 'MIMAROPA Region'}

ABBR = [(r'\bBRGYS?\b|\bBGYS?\b', 'BARANGAY'), (r'\bBLDGS?\b', 'BUILDING'), (r'\bMPB\b', 'MULTI PURPOSE BUILDING'),
        (r'\bMULTIPURPOSE\b', 'MULTI PURPOSE'), (r'\bRD\b', 'ROAD'), (r'\bBR\b', 'BRIDGE'), (r'\bCONST\b', 'CONSTRUCTION'),
        (r'\bREHAB\b', 'REHABILITATION'), (r'\bIMPROV\b|\bIMPV\b', 'IMPROVEMENT'), (r'\bNATL\b|\bNAT L\b', 'NATIONAL'),
        (r'\bSTA\b', 'STATION'), (r'\bMUN\b', 'MUNICIPALITY'), (r'\bPROV\b', 'PROVINCE'), (r'\bES\b', 'ELEMENTARY SCHOOL'),
        (r'\bNHS\b', 'NATIONAL HIGH SCHOOL'), (r'\bCS\b', 'CENTRAL SCHOOL'), (r'\bSTO\b', 'SANTO'), (r'\bSTA\b', 'SANTA')]
STOP = {'OF', 'THE', 'AND', 'AT', 'IN', 'ALONG', 'FOR', 'TO', 'WITH', 'INCLUDING', 'VARIOUS', 'CONSTRUCTION', 'BARANGAY',
        'CITY', 'PROVINCE', 'MUNICIPALITY'}


def norm_title(s):
    s = unicodedata.normalize('NFKD', s if isinstance(s, str) else '').encode('ascii', 'ignore').decode().upper()
    s = re.sub(r'[^A-Z0-9+]+', ' ', s)
    for a, b in ABBR:
        s = re.sub(a, b, s)
    return ' '.join(t for t in s.split() if t not in STOP)


def office_key(o):
    o = re.sub(r'\s*\(formerly.*\)', '', o.lower() if isinstance(o, str) else '')
    return o.replace('district engineering office', 'deo').strip()


def contractors(s):
    """'A (123) / B (456)' → [('A', '123'), ('B', '456')]; PCAB ids in brackets."""
    out = []
    for part in re.split(r'\s+/\s+', s if isinstance(s, str) else ''):
        m = re.match(r'^(.*?)\s*\((\d+)\)\s*$', part.strip())
        out.append((m.group(1), m.group(2)) if m else (part.strip(), ''))
    return [p for p in out if p[0]]


ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10}


def stations(s):
    """'K0367 + 770', 'K0084+(-966)' → ['367+770', '84+-966'] in order."""
    s = s if isinstance(s, str) else ''
    return [f'{int(a)}+{int(b.replace(" ", ""))}' for a, b in
            re.findall(r'K\s*(\d{1,4})\s*\+\s*\(?\s*(-?\s*\d+)\s*\)?', s.upper())]


def numbering(s):
    """{'PACKAGE': '2', 'PHASE': '3'} from 'Package 2', 'Phase III', 'Pkg. 2'."""
    out = {}
    for k, v in re.findall(r'\b(PACKAGE|PKG|PHASE)\.?\s*([0-9]+|[IVX]+\b|[A-Z]\b)', (s if isinstance(s, str) else '').upper()):
        out.setdefault('PACKAGE' if k == 'PKG' else k, str(ROMAN.get(v, int(v) if v.isdigit() else v)))
    return out


con = duckdb.connect()
G = con.sql(f"""
  select try_cast(year as int) fy, prexc_fpap_id pap, operunit, any_value(dsc) title, any_value(uacs_oper_dsc) office,
         any_value(uacs_reg_id) region_code, round(sum(try_cast(amt as double)) * 1000)::bigint gaa_php
  from read_csv('{GAA_CSV}', all_varchar=true)
  where uacs_exp_cd = '6' and try_cast(amt as double) > 0 and try_cast(year as int) between {YEARS[0]} and {YEARS[-1]}
  group by all order by fy, pap, operunit""").df()
multi = G.groupby(['fy', 'pap']).operunit.transform('nunique') > 1
G['line_id'] = 'gaa:' + G.fy.astype(str) + ':' + G.pap + np.where(multi, ':' + G.operunit, '')
assert G.line_id.is_unique
C = con.sql(f"""
  select contractId contract_id, description, contractor, budget::double contract_php, status, progress,
         location.province office, location.region region, programName program, sourceOfFunds source_of_funds,
         infraYear infra_year, startDate start_date, completionDate completion_date, latitude, longitude,
         try_cast(regexp_extract(sourceOfFunds, 'GAA (\\d{{4}})', 1) as int) fy
  from read_parquet('{CONTRACTS}')""").df()
C['region'] = C.region.replace(REGION_ALIAS)
C = C[C.fy.between(YEARS[0], YEARS[-1])].reset_index(drop=True)
G['n'] = G.title.map(norm_title); C['n'] = C.description.map(norm_title)
G['ok'] = G.office.map(office_key); C['ok'] = C.office.map(office_key)
G['region'] = G.region_code.map(REGION)
G_START = G.title.map(lambda t: (stations(t) or [None])[0]).to_dict()
G_NUM = G.title.map(numbering).to_dict()
C_ST = C.description.map(lambda t: set(stations(t))).to_dict()
C_CUT = C.description.map(lambda t: isinstance(t, str) and len(t) >= 250).to_dict()
C_NUM = C.description.map(numbering).to_dict()


def agrees(li, ci):
    """Stations and package/phase numbers do not contradict (see the module notes)."""
    start = G_START[li]
    if start and C_ST[ci] and not C_CUT[ci] and start not in C_ST[ci]:
        return False
    a, b = G_NUM[li], C_NUM[ci]
    return all(a[k] == b[k] for k in a.keys() & b.keys())



def closeness(r):
    return 1 - min(abs(r - RATIO_TYPICAL), 0.5) / 0.5


def candidate_pairs(lines, pool, tmin, stage):
    """Every (line, contract) whose titles score ≥ tmin, with the amount ratio."""
    if len(lines) == 0 or len(pool) == 0:
        return []
    out = []
    li, ci = lines.index.to_numpy(), pool.index.to_numpy()
    gaa, amt, texts = lines.gaa_php.to_numpy(float), pool.contract_php.to_numpy(float), pool.n.tolist()
    for s in range(0, len(lines), 2000):
        m = process.cdist(lines.n.iloc[s:s + 2000].tolist(), texts, scorer=fuzz.token_set_ratio, workers=-1,
                          dtype=np.uint8, score_cutoff=tmin)
        i, j = np.nonzero(m)
        out += zip(li[s + i].tolist(), ci[j].tolist(), m[i, j].tolist(), (amt[j] / gaa[s + i]).tolist(),
                   [stage] * len(i))
    return [p for p in out if agrees(p[0], p[1])]


links, line_status = [], {}
for fy in YEARS:
    g, c = G[G.fy == fy], C[C.fy == fy]
    by_office = dict(tuple(c.groupby('ok'))); by_region = dict(tuple(c.groupby('region')))
    used_line, used_contract = set(), set()

    def assign(pairs, method):
        # best first: title score, then amount closeness to a typical award
        pairs = sorted((p for p in pairs if RATIO_MIN <= p[3] <= RATIO_MAX),
                       key=lambda p: (-(p[2] + 10 * closeness(p[3])), p[0], p[1]))
        rivals = pd.Series([p[0] for p in pairs]).value_counts().to_dict() if pairs else {}
        for li, ci, score, ratio, stage in pairs:
            if li in used_line or ci in used_contract:
                continue
            used_line.add(li); used_contract.add(ci)
            links.append(dict(li=li, ci=ci, method=method, stage=stage, title_score=score, amount_ratio=ratio,
                              candidates=rivals[li]))

    pairs = []
    for ok, lines in g.groupby('ok'):
        if ok == 'central office':
            pairs += candidate_pairs(lines, c, TITLE_MIN, 'all offices')
        elif ok in by_office:
            pairs += candidate_pairs(lines, by_office[ok], TITLE_MIN, 'same office')
    assign(pairs, 'one_to_one')
    # district lines not found at their office: the region's other offices, stricter
    rest = g[~g.index.isin(used_line) & (g.ok != 'central office')]
    pairs = []
    for reg, lines in rest.groupby('region'):
        pool = by_region.get(reg)
        if pool is not None:
            pool = pool[~pool.index.isin(used_contract)]
            pairs += [p for p in candidate_pairs(lines, pool, REGION_TITLE_MIN, 'same region')
                      if G.at[p[0], 'ok'] != C.at[p[1], 'ok']]
    assign(pairs, 'one_to_one')
    # the rest: lines with no single contract, against contracts not yet linked, for bundles
    rest = g[~g.index.isin(used_line)]
    pairs = []
    for ok, lines in rest.groupby('ok'):
        pool = c if ok == 'central office' else by_office.get(ok)
        if pool is not None:
            pool = pool[~pool.index.isin(used_contract)]
            pairs += candidate_pairs(lines, pool, TITLE_MIN, 'all offices' if ok == 'central office' else 'same office')
    per_contract = {}
    for li, ci, score, ratio, stage in pairs:
        per_contract.setdefault(ci, []).append((li, score, stage))
    # bundles: one contract whose title takes in several lines, and the lines add up to it
    for ci, ls in sorted(per_contract.items(), key=lambda kv: (-max(x[1] for x in kv[1]), kv[0])):
        if ci in used_contract:
            continue
        ls = [x for x in ls if x[0] not in used_line and G.at[x[0], 'gaa_php'] * RATIO_MIN <= C.at[ci, 'contract_php']]
        if len(ls) < 2:
            continue
        total = C.at[ci, 'contract_php'] / sum(G.at[x[0], 'gaa_php'] for x in ls)
        if RATIO_MIN <= total <= RATIO_MAX:
            used_contract.add(ci)
            for li, score, stage in ls:
                used_line.add(li)
                links.append(dict(li=li, ci=ci, method='bundle', stage=stage, title_score=score, amount_ratio=total,
                                  candidates=len(ls)))

L = pd.DataFrame(links)
# outputs: one row per link, one row per GAA line
link_rows = []
for r in L.itertuples():
    ln, c = G.loc[r.li], C.loc[r.ci]
    who = contractors(c.contractor)
    link_rows.append(dict(
        fiscal_year=ln.fy, line_id=ln.line_id, gaa_title=ln.title, gaa_office=ln.office, gaa_php=ln.gaa_php,
        contract_id=c.contract_id, contractor=c.contractor, contractor_names='; '.join(n for n, _ in who),
        contractor_pcab_ids='; '.join(i for _, i in who if i), contract_php=round(c.contract_php, 2),
        contract_description=c.description, contract_office=c.office, contract_region=c.region, status=c.status,
        progress=c.progress, start_date=c.start_date, completion_date=c.completion_date,
        source_of_funds=c.source_of_funds, method=r.method, searched=r.stage, title_score=r.title_score,
        amount_ratio=round(r.amount_ratio, 4), candidates=r.candidates))
links_df = pd.DataFrame(link_rows).sort_values(['fiscal_year', 'line_id', 'contract_id'])
by_line = links_df.groupby('line_id')
lines_df = G[['fy', 'line_id', 'pap', 'title', 'office', 'region', 'gaa_php']].rename(
    columns={'fy': 'fiscal_year', 'office': 'gaa_office', 'title': 'gaa_title'}).set_index('line_id')
lines_df['match'] = by_line.method.first().reindex(lines_df.index).fillna('none')
lines_df['contracts'] = by_line.size().reindex(lines_df.index).fillna(0).astype(int)
lines_df['contract_ids'] = by_line.contract_id.agg('; '.join).reindex(lines_df.index).fillna('')
lines_df['contractors'] = by_line.contractor_names.agg(lambda s: '; '.join(dict.fromkeys(
    n for v in s for n in v.split('; ')))).reindex(lines_df.index).fillna('')
lines_df['contract_php'] = by_line.contract_php.sum().reindex(lines_df.index)
lines_df = lines_df.reset_index()[['fiscal_year', 'line_id', 'pap', 'gaa_title', 'gaa_office', 'region', 'gaa_php',
                                   'match', 'contracts', 'contract_ids', 'contractors', 'contract_php']]

for name, df in (('links', links_df), ('lines', lines_df)):
    df.to_csv(OUT / f'{name}.csv', index=False, encoding='utf-8-sig')
    con.register('df', df)
    con.sql(f"copy df to '{OUT / name}.parquet' (format parquet, compression zstd)")
    con.unregister('df')

# summary + checks
years = []
for fy in YEARS:
    l, c = lines_df[lines_df.fiscal_year == fy], C[C.fy == fy]
    k = links_df[links_df.fiscal_year == fy]
    row = dict(fy=fy, lines=len(l), gaa_php=int(l.gaa_php.sum()), contracts_funded=len(c),
               contracts_funded_php=round(float(c.contract_php.sum()), 2), contracts_linked=int(k.contract_id.nunique()),
               contracts_linked_php=round(float(k.contract_php.sum()), 2))
    for m in ('one_to_one', 'bundle', 'none'):
        s = l[l.match == m]
        row[m] = dict(lines=len(s), gaa_php=int(s.gaa_php.sum()))
    years.append(row)
src = con.sql(f"""select try_cast(year as int) fy, round(sum(try_cast(amt as double)) * 1000)::bigint php
  from read_csv('{GAA_CSV}', all_varchar=true) where uacs_exp_cd = '6' and try_cast(amt as double) > 0
  group by 1""").df().set_index('fy').php
checks = {
    'gaa_totals_equal_source': all(y['gaa_php'] == int(src[y['fy']]) for y in years),
    'line_ids_unique': bool(lines_df.line_id.is_unique),
    'contract_linked_once_unless_bundle': bool(links_df[links_df.method != 'bundle'].contract_id.is_unique and
        not set(links_df[links_df.method == 'bundle'].contract_id) & set(links_df[links_df.method != 'bundle'].contract_id)),
    'match_counts_add_up': all(sum(y[m]['lines'] for m in ('one_to_one', 'bundle', 'none')) == y['lines'] for y in years),
    'links_same_fiscal_year': bool((links_df.fiscal_year == links_df.source_of_funds.str.extract(r'GAA (\d{4})')[0].astype(int)).all()),
    'one_to_one_rule': bool(links_df[links_df.method == 'one_to_one'].amount_ratio.between(RATIO_MIN, RATIO_MAX).all()),
    'bundle_rule': bool(links_df[links_df.method == 'bundle'].groupby('contract_id').line_id.nunique().ge(2).all()),
}
meta = json.loads(Path(CONTRACTS).with_name('contracts.meta.json').read_text())
summary = dict(built_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
               inputs=dict(gaa=GAA_CSV, contracts=CONTRACTS, contracts_downloaded=meta.get('downloaded_to'),
                           contracts_total=meta.get('contracts')),
               rules=dict(title_min=TITLE_MIN, region_title_min=REGION_TITLE_MIN, amount_ratio=[RATIO_MIN, RATIO_MAX]),
               years=years, checks=checks)
(OUT / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
for y in years:
    t = y['lines']
    print(f"FY{y['fy']}: {t:,} lines ₱{y['gaa_php'] / 1e9:,.1f}B | one-to-one {y['one_to_one']['lines'] / t:.1%} "
          f"bundle {y['bundle']['lines'] / t:.1%} none {y['none']['lines'] / t:.1%} | pesos linked "
          f"{1 - y['none']['gaa_php'] / y['gaa_php']:.1%} | contracts linked "
          f"{y['contracts_linked']:,}/{y['contracts_funded']:,}")
print('checks:', checks)
if not all(checks.values()):
    sys.exit('a check failed')
