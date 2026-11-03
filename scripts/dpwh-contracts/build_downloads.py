"""The contractor data as downloads, with a manifest for developers: data/hgab/2027/contractors/downloads/.

    python build_downloads.py WORK_DIR SITE_DIR GAA_CSV
      WORK_DIR  data/dpwh-contracts (fetch.py, match.py, qa.py)
      SITE_DIR  data/hgab/2027/contractors (build_site.py; the downloads go in its downloads/)

Jason (2026-11-03): "upload me the manifest.json for our published data so we can make it easy for fellow developers to
hand over". manifest.json follows the line-by-line downloads' manifest (explorer/downloads/manifest.json: `files`
entries with key, title, about, rows, csv, parquet, columns) and adds what a developer needs to pick the data up: the
sources, the matching rules, the accuracy check, the totals by year, how to rebuild and check it, a URL per file, and the
JSON files the site's pages read.
"""
import gzip, hashlib, json, os, shutil, subprocess, sys, zipfile
from datetime import datetime, timezone
from pathlib import Path
import duckdb

WORK, SITE, GAA_CSV = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
OUT = SITE / 'downloads'
ASSETS = 'https://budget-assets.bettergov.ph'
BASE = f'{ASSETS}/hgab/2027/contractors/downloads'
PORTAL = 'https://transparency.dpwh.gov.ph/?project='
REPO = Path(__file__).resolve().parents[2]
OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.iterdir():
    f.unlink()

con = duckdb.connect()
meta = json.loads((WORK / 'contracts.meta.json').read_text())
match = json.loads((WORK / 'gaa-2020-2026' / 'summary.json').read_text())
qa = json.loads((WORK / 'gaa-2020-2026' / 'qa.json').read_text())
site = json.loads((SITE / 'summary.json').read_text())
q = lambda s: s.replace("'", "''")


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def ref(p):
    h = sha(p)
    return {'file': p.name, 'bytes': p.stat().st_size, 'sha256': h, 'url': f'{BASE}/{p.name}?v={h[:12]}'}


def write(name, sql, csv='plain'):
    """One table as Parquet and CSV (UTF-8 with BOM; `gzip` for the large one)."""
    con.sql(f"create or replace table t as {sql}")
    pq = OUT / f'{name}.parquet'
    con.sql(f"copy t to '{q(str(pq))}' (format parquet, compression zstd)")
    plain = OUT / f'{name}.csv'
    con.sql(f"copy t to '{q(str(plain))}' (format csv, header true)")
    body = plain.read_bytes()
    if csv == 'gzip':
        out = OUT / f'{name}.csv.gz'
        with gzip.open(out, 'wb', compresslevel=9) as fh:
            fh.write(b'\xef\xbb\xbf' + body)
        plain.unlink()
    else:
        plain.write_bytes(b'\xef\xbb\xbf' + body)
        out = plain
    cols = [r[0] for r in con.sql('describe t').fetchall()]
    rows = con.sql('select count(*) from t').fetchall()[0][0]
    return ref(out), ref(pq), cols, rows


# 1. DPWH's contract list, every field, one row per contract
contracts = WORK / 'contracts.parquet'
c_csv, c_pq, c_cols, c_rows = write('dpwh-contracts-2016-2026', f"""
  select contractId contract_id, '{PORTAL}' || contractId dpwh_url, description, category,
    componentCategories component_categories, status, budget contract_php, amountPaid amount_paid_php,
    progress progress_percent, location.province dpwh_office, location.region region, contractor,
    startDate start_date, completionDate completion_date, try_cast(infraYear as int) infra_year,
    programName program_name, sourceOfFunds source_of_funds,
    try_cast(regexp_extract(sourceOfFunds, 'GAA (\\d{{4}})', 1) as int) gaa_year,
    latitude, longitude, reportCount report_count, hasSatelliteImage has_satellite_image, isLive is_live,
    livestreamUrl livestream_url, livestreamVideoId livestream_video_id, livestreamDetectedAt livestream_detected_at
  from read_parquet('{q(str(contracts))}') order by contractId""", csv='gzip')

# 2. Every contractor, with its figures (contractors.csv, as the site publishes it)
k_csv, k_pq, k_cols, k_rows = write('dpwh-contractors-2016-2026', f"""
  select * from read_csv('{q(str(SITE / 'contractors.csv'))}', header=true,
    types={{'license_id': 'VARCHAR', 'other_names': 'VARCHAR', 'marked_revoked_in_dpwh_list': 'VARCHAR'}})""")

# 3. Each GAA line and the contract matched to it
links = WORK / 'gaa-2020-2026' / 'links.parquet'
l_csv, l_pq, l_cols, l_rows = write('gaa-2020-2026-dpwh-line-contracts', f"""
  select fiscal_year, line_id, gaa_title, gaa_office, gaa_php, contract_id, '{PORTAL}' || contract_id dpwh_url,
    contractor, contractor_names, contractor_pcab_ids, contract_php, contract_description, contract_office,
    contract_region, status, progress progress_percent, cast(start_date as date) start_date,
    cast(completion_date as date) completion_date, source_of_funds, method, searched, title_score, amount_ratio, candidates
  from read_parquet('{q(str(links))}') order by fiscal_year, line_id, contract_id""")

# 4. Every DPWH capital-outlay line of the GAA, FY2020–FY2026, matched or not
lines = WORK / 'gaa-2020-2026' / 'lines.parquet'
g_csv, g_pq, g_cols, g_rows = write('gaa-2020-2026-dpwh-lines', f"""
  select * from read_parquet('{q(str(lines))}') order by fiscal_year, line_id""")

# 5. The accuracy sample, as qa.py wrote it
acc = OUT / 'match-accuracy-sample.json'
shutil.copyfile(WORK / 'gaa-2020-2026' / 'qa.json', acc)

COLUMNS = {
    'dpwh-contracts-2016-2026': {
        'contract_id': 'DPWH contract ID, as its contract list has it (e.g. 23AE0052).',
        'dpwh_url': 'DPWH’s own page for the contract on its transparency portal.',
        'description': 'Contract description, as listed (DPWH cuts it at 255 characters).',
        'category': 'Infrastructure type, as listed.',
        'component_categories': 'Infrastructure types of the contract’s components, as listed.',
        'status': 'Completed, On-Going, Not Yet Started, Terminated or For Procurement.',
        'contract_php': 'Contract amount in pesos, as listed (centavos kept). Not a payment.',
        'amount_paid_php': 'Amount paid, as listed (mostly 0 in the list).',
        'progress_percent': 'Physical progress, percent, as listed.',
        'dpwh_office': 'The DPWH office holding the contract ("La Union 1st DEO", "Region V").',
        'region': 'Region, as listed.',
        'contractor': 'Contractor(s) with license numbers in brackets; joint-venture partners separated by " / "; '
                      'some licenses tagged "[REVOKED]". Empty for contracts not yet awarded.',
        'start_date': 'Start date, as listed.',
        'completion_date': 'Completion date, as listed.',
        'infra_year': 'DPWH’s year for the contract.',
        'program_name': 'Regular Infra or Outside Infra, as listed.',
        'source_of_funds': 'Fund source, as listed ("Regular Infra - GAA 2023 SSP").',
        'gaa_year': 'The GAA year named in source_of_funds; empty when it names none.',
        'latitude': 'Latitude, as listed.',
        'longitude': 'Longitude, as listed.',
        'report_count': 'Reports on the contract in DPWH’s portal, as listed.',
        'has_satellite_image': 'Whether DPWH’s portal has a satellite image, as listed.',
        'is_live': 'Whether DPWH’s portal shows a live stream, as listed.',
        'livestream_url': 'Live stream address, as listed.',
        'livestream_video_id': 'Live stream video ID, as listed.',
        'livestream_detected_at': 'When the live stream was detected, as listed.',
    },
    'dpwh-contractors-2016-2026': {
        'contractor': 'Contractor name: the one most of its contracts list.',
        'license_id': 'License number as DPWH lists it (OECO_… for a foreign contractor); empty when none is given.',
        'marked_revoked_in_dpwh_list': '"yes" when DPWH’s list tags the license "[REVOKED]".',
        'contracts': 'Contracts naming the contractor, FY2016–FY2026.',
        'contract_amount_php': 'Their contract amount. A joint-venture contract counts in full for each partner.',
        'joint_venture_contracts': 'Of those, contracts naming another contractor too.',
        'joint_venture_amount_php': 'Their contract amount.',
        'completed': 'Contracts completed.', 'ongoing': 'Contracts ongoing.', 'not_yet_started': 'Contracts not yet started.',
        'terminated': 'Contracts terminated.',
        'first_year': 'First year with a contract (DPWH’s year).', 'last_year': 'Last year with a contract.',
        **{f'amount_{y}_php': f'Contract amount in {y}.' for y in range(2016, 2027)},
        'dpwh_offices': 'DPWH offices that awarded its contracts.',
        'main_office': 'The office with the largest amount.', 'main_office_amount_php': 'That office’s amount.',
        'regions': 'Regions with a contract.',
        'contracts_linked_to_gaa_lines': 'Contracts matched to a GAA line, FY2020–FY2026.',
        'gaa_lines_linked_2020_2026': 'GAA lines those contracts carry.',
        'gaa_lines_amount_php': 'Those lines’ GAA amount.',
        'other_names': 'Other names its contracts list, up to five.',
        'page': 'Its page on budget.bettergov.ph.',
    },
    'gaa-2020-2026-dpwh-line-contracts': {
        'fiscal_year': 'GAA year of the line.',
        'line_id': '"gaa:<year>:<UACS code>" (":<office>" added for the 2 codes split over two offices); the same IDs as '
                   'the multi-purpose buildings map.',
        'gaa_title': 'The line’s title in the GAA.', 'gaa_office': 'The office the GAA lists for the line.',
        'gaa_php': 'The line’s GAA amount, pesos.',
        'contract_id': 'The DPWH contract matched to the line.', 'dpwh_url': 'DPWH’s own page for that contract.',
        'contractor': 'Contractor(s), as listed.', 'contractor_names': 'Contractor names, "; " between partners.',
        'contractor_pcab_ids': 'License numbers, "; " between partners.',
        'contract_php': 'Contract amount; for a cluster, the whole contract, shared with its other lines.',
        'contract_description': 'Contract description, as listed.', 'contract_office': 'The office holding the contract.',
        'contract_region': 'Region, as listed.', 'status': 'Contract status, as listed.',
        'progress_percent': 'Physical progress, as listed.', 'start_date': 'Start date.', 'completion_date': 'Completion date.',
        'source_of_funds': 'Fund source; its GAA year is the line’s year.',
        'method': 'one_to_one (one contract for the line) or bundle (one contract for several lines, a DPWH "cluster").',
        'searched': 'Where the contract was found: same office, same region, or all offices (Central Office lines).',
        'title_score': 'Title agreement, rapidfuzz token-set ratio (90 or more; 95 within the region).',
        'amount_ratio': 'Contract amount over the line’s (over the lines’ together for a cluster), 0.5 to 1.02.',
        'candidates': 'Contracts that qualified for the line; 1 means it was the only one.',
    },
    'gaa-2020-2026-dpwh-lines': {
        'fiscal_year': 'GAA year.', 'line_id': 'Line ID, as in the line-contracts table.',
        'pap': 'UACS program, activity or project code.', 'gaa_title': 'Title in the GAA.',
        'gaa_office': 'The office the GAA lists.', 'region': 'Region of the GAA operating unit.',
        'gaa_php': 'GAA amount, pesos (capital outlays).',
        'match': 'one_to_one, bundle or none: whether a contract was matched, and how.',
        'contracts': 'Contracts matched (0 or 1).', 'contract_ids': 'The contract ID, if any.',
        'contractors': 'Its contractor(s), "; " between partners.',
        'contract_php': 'The contract amount; for a cluster, the whole contract.',
    },
}
for key, cols in [('dpwh-contracts-2016-2026', c_cols), ('dpwh-contractors-2016-2026', k_cols),
                  ('gaa-2020-2026-dpwh-line-contracts', l_cols), ('gaa-2020-2026-dpwh-lines', g_cols)]:
    assert list(COLUMNS[key]) == cols, (key, set(cols) ^ set(COLUMNS[key]))

files = [
    dict(key='dpwh-contracts-2016-2026', title='DPWH’s contract list, FY2016–FY2026',
         about='Every contract in DPWH’s list as downloaded, all its list fields, one row per contract; with DPWH’s page for each.',
         rows=c_rows, csv=c_csv, parquet=c_pq, columns=COLUMNS['dpwh-contracts-2016-2026']),
    dict(key='dpwh-contractors-2016-2026', title='Every DPWH contractor, with its figures',
         about='One row per contractor (by license number): contracts, amounts by year, joint ventures, offices, GAA lines matched.',
         rows=k_rows, csv=k_csv, parquet=k_pq, columns=COLUMNS['dpwh-contractors-2016-2026']),
    dict(key='gaa-2020-2026-dpwh-line-contracts', title='GAA lines and the contracts matched to them, FY2020–FY2026',
         about='One row per GAA line and matched contract, with how it was matched. Our match, not DPWH’s record.',
         rows=l_rows, csv=l_csv, parquet=l_pq, columns=COLUMNS['gaa-2020-2026-dpwh-line-contracts']),
    dict(key='gaa-2020-2026-dpwh-lines', title='Every DPWH GAA line, FY2020–FY2026, matched or not',
         about='One row per DPWH capital-outlay line of the GAA, with its match status, contract and contractor.',
         rows=g_rows, csv=g_csv, parquet=g_pq, columns=COLUMNS['gaa-2020-2026-dpwh-lines']),
]
years = match['years']
first5 = [y for y in years if y['fy'] < 2026]
linked = sum(y['one_to_one']['lines'] + y['bundle']['lines'] for y in first5)
qa_strata = qa['strata']
confirmed = sum(v['confirmed'] for v in qa_strata.values())
fetched = sum(v['fetched'] for v in qa_strata.values())
# PIPELINE_COMMIT: the commit holding this pipeline, when the checkout's HEAD is another branch.
commit = os.environ.get('PIPELINE_COMMIT') or subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
notice = ('Independent and unofficial: our reading of DPWH’s contract list and the GAA, not an official record. Contractor '
          'names, license numbers, amounts and statuses are as DPWH’s list publishes them; amounts are contract amounts, '
          'not payments. DPWH does not publish which GAA line a contract carries: the links are our match by title, '
          'office and amount, and may be wrong. A contract, a total or a ranking alone does not establish irregularity '
          'or wrongdoing by any contractor, office or official.')
site_data = [
    dict(path='hgab/2027/contractors/index.json', about='Every contractor with its figures (cols + rows), for /hgab/2027/contractors.'),
    dict(path='hgab/2027/contractors/c/NN.json', about='Each contractor’s contracts, in 64 files by FNV-1a(key) % 64 (src/lib/hgab-contractors.ts shardOf).'),
    dict(path='hgab/2027/contractors/mpb-links.json', about='The matched contract, contractors and awarding office of each multi-purpose building map line.'),
    dict(path='hgab/2027/contractors/summary.json', about='Totals, the match table by year, the builder’s checks and every site file’s SHA-256.'),
    dict(path='hgab/2027/mpb-boards/boards.json', about='The four multi-purpose building leaderboards (src/lib/hgab-leaderboard.ts decodeMpbBoards).'),
]
for d in site_data:
    d['url'] = f"{ASSETS}/{d['path']}"

# README, then the zip (README + every Parquet + the accuracy sample), then the manifest
readme = OUT / 'README.md'
lines_md = [
    '# DPWH contractors and the GAA lines their contracts carry',
    '',
    f"Built {datetime.now(timezone.utc).strftime('%Y-%m-%d')} by budget.bettergov.ph (pipeline `scripts/dpwh-contracts/`, "
    f"commit {commit[:12]}). Start from `manifest.json`: every file, its rows, size, SHA-256, URL and columns.",
    '',
    notice,
    '',
    '## Sources',
    '',
    f"- DPWH’s contract list, from {meta['source']} (BetterGov’s cached proxy over DPWH’s transparency portal, "
    f"repo bettergovph/api.dpwh), downloaded {meta['downloaded_to'][:10]}: {meta['contracts']:,} contracts, FY2016–FY2026.",
    '- The GAA for FY2020–FY2026, DPWH (department 18): every capital-outlay line with an amount, from the site’s GAA extract.',
    '',
    '## How lines were matched to contracts',
    '',
    '- A line is compared with contracts funded from the same year’s GAA (the year in `source_of_funds`).',
    '- `one_to_one`: titles agree (token set ≥ 90 after expanding Brgy, Bldg, MPB…) and the contract is 50–102% of the line.',
    '- `bundle`: one contract whose title takes in several lines, worth 50–102% of them together (DPWH “clusters”).',
    '- District office lines are searched at their office, then their region (≥ 95); Central Office lines in every office.',
    '- Guards: a road line’s first station must be among the contract’s stations; Package and Phase numbers must agree.',
    '- Several contracts for one line (“splits”) were left out: a sample check found a third right. Unmatched lines stay unmatched.',
    '',
    '## Results and accuracy',
    '',
    f"- FY2020–FY2025: {linked:,} of {sum(y['lines'] for y in first5):,} lines matched. FY2026 is low: many of its contracts are still for procurement.",
    f"- Sample check (`match-accuracy-sample.json`): {confirmed} of {fetched} links confirmed by the contracts’ own component "
    'titles, which DPWH writes as “<type of work> - <title as in the GAA>”. By hand, about 1 in 100 one-to-one links is wrong.',
    '',
    '| Year | GAA lines | Matched | In clusters | Share of the amount | Contracts funded |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    *[f"| {y['fy']} | {y['lines']:,} | {y['one_to_one']['lines'] + y['bundle']['lines']:,} | {y['bundle']['lines']:,} | "
      f"{round((1 - y['none']['gaa_php'] / y['gaa_php']) * 100)}% | {y['contracts_funded']:,} |" for y in years],
    '',
    '## Files',
    '',
    *[f"- `{f['parquet']['file']}` / `{f['csv']['file']}`: {f['about']} {f['rows']:,} rows." for f in files],
    f'- `{acc.name}`: the sample check, every link sampled that a component title did not confirm.',
    '',
    '## Conventions',
    '',
    '- CSVs are UTF-8 with a BOM; the contract list’s CSV is gzipped. Parquet holds the same rows with types.',
    '- Pesos: GAA amounts are whole pesos; contract amounts keep centavos. Empty means none, never 0.',
    '- Each file’s link carries `?v=` and the start of its SHA-256: the data host caches files under fixed names.',
    '',
    '## Rebuild and check',
    '',
    '- `npm run build:hgab-contractors` (downloads DPWH’s list again, about 25 minutes; `REUSE=1` keeps the pages), then',
    '  `npm run verify:hgab` (its `contractors/` section). Method: `docs/dpwh-contracts.md` in github.com/bettergovph/ai-budget.',
    '',
    '## Also published (the JSON the site’s pages read)',
    '',
    *[f"- {d['url']}: {d['about']}" for d in site_data],
]
readme.write_text('\n'.join(lines_md) + '\n', encoding='utf-8')
zpath = OUT / 'dpwh-contractors-gaa-2020-2026.zip'
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_STORED) as z:
    for p in [readme, acc, *[OUT / f['parquet']['file'] for f in files]]:
        z.write(p, f'dpwh-contractors-gaa-2020-2026/{p.name}')
manifest = dict(
    schema=1,
    built_at=datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    title='DPWH contractors and the GAA lines their contracts carry, FY2016–FY2026',
    base_url=BASE,
    pipeline_commit=commit,
    pipeline=dict(repo='https://github.com/bettergovph/ai-budget', scripts='scripts/dpwh-contracts/',
                  build='npm run build:hgab-contractors', verify='npm run verify:hgab (contractors/ section)',
                  docs='docs/dpwh-contracts.md'),
    notice=notice,
    sources=[
        dict(name='DPWH contract list', url=meta['source'], via='bettergovph/api.dpwh (cached proxy over DPWH’s transparency portal)',
             portal='https://transparency.dpwh.gov.ph', downloaded_from=meta['downloaded_from'], downloaded_to=meta['downloaded_to'],
             contracts=meta['contracts'], api_summary=meta['api_summary']),
        dict(name='GAA FY2020–FY2026, DPWH capital outlays', file='data/18/full_extract.csv (the site’s GAA extract)',
             explorer='https://budget.bettergov.ph/gaa'),
    ],
    method=dict(match=match['rules'], kinds={'one_to_one': 'one contract for the line', 'bundle': 'one contract for several lines'},
                same_year='a line is compared only with contracts funded from the same year’s GAA',
                left_out='several contracts for one line (splits): a sample check found a third right'),
    totals=dict(contracts=meta['contracts'], contracts_with_contractor=site['totals']['contracts_with_contractor'],
                contractors=site['totals']['contractors'], contract_amount_php=site['totals']['amount_php'],
                joint_venture_contracts=site['totals']['joint_venture_contracts'],
                gaa_lines=sum(y['lines'] for y in years), gaa_lines_matched=sum(y['one_to_one']['lines'] + y['bundle']['lines'] for y in years),
                by_year=years),
    accuracy=dict(sampled=fetched, confirmed=confirmed, by_kind=qa_strata,
                  note='Confirmed = a component title of the fetched contract equals the line’s (ratio ≥ 90). Most of the rest '
                       'are the same project worded differently; by hand about 1 in 100 one-to-one links is wrong.'),
    readme=ref(readme),
    zip=ref(zpath),
    accuracy_sample=ref(acc),
    files=files,
    site_data=site_data,
)
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
for f in files:
    print(f"{f['key']:36s} {f['rows']:>8,} rows  csv {f['csv']['bytes'] / 1e6:6.1f} MB  parquet {f['parquet']['bytes'] / 1e6:5.1f} MB")
print(f"zip {zpath.stat().st_size / 1e6:.1f} MB · README · manifest.json → {OUT}")
