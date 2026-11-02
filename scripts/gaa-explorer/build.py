"""Export coverage, scope-specific group summaries and original Parquet downloads.
Usage: python scripts/gaa-explorer/build.py --source data/gaa-history
Requires duckdb (see requirements.txt). Does not mutate the source dataset.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import duckdb

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path('data/gaa-history'))
parser.add_argument('--output', type=Path, default=Path('data/gaa-explorer'))
args = parser.parse_args()
assert args.source.resolve() != args.output.resolve()
coverage = json.loads((args.source / 'coverage.json').read_text())
assert [c['year'] for c in coverage] == list(range(2000, 2027))
args.output.mkdir(parents=True, exist_ok=True)
con = duckdb.connect()
manifest = {'schema_version': 1, 'currency': 'PHP', 'years': []}
for entry in coverage:
    year = entry['year']
    source = args.source / 'parquet' / f'gaa-{year}.parquet'
    con.read_parquet(str(source)).create_view('facts', replace=True)
    rows, amount, bad_years = con.execute('select count(*), sum(amount), count(*) filter(where fy != ? or fy is null) from facts', [year]).fetchone()
    assert rows == entry['rows'] and not bad_years, year
    assert amount == entry['amount_pesos'], year
    scopes = []
    for scope, total, count in con.execute('select budget_scope, sum(amount), count(*) from facts group by 1 order by 1').fetchall():
        assert total == entry['scopes'][scope], (year, scope)
        groups = [{'name': name, 'amount': value, 'rows': n} for name, value, n in con.execute('select department_dsc, sum(amount), count(*) from facts where budget_scope = ? group by 1 order by 2 desc, 1', [scope]).fetchall()]
        assert sum(g['amount'] for g in groups) == total
        scopes.append({'id': scope, 'amount': total, 'rows': count, 'groups': groups})
    grains = dict(con.execute('select grain, count(*) from facts group by 1').fetchall())
    assert grains == entry.get('grains', {}), year
    result = {k: entry[k] for k in ['year', 'status', 'rows', 'notes']}
    if 'source_year' in entry:
        result['source_year'] = entry['source_year']
        assert rows == 0
    result.update(scopes=scopes, grains=grains, file=f'gaa-{year}.parquet', sha256=hashlib.file_digest(source.open('rb'), 'sha256').hexdigest())
    shutil.copyfile(source, args.output / result['file'])
    manifest['years'].append(result)
    print(f'{year}: {rows:,} rows; {len(scopes)} separate scopes')
manifest['rows'] = sum(e['rows'] for e in manifest['years'])
combined = args.source / 'gaa-2000-2026.parquet'
assert con.execute('select count(*) from read_parquet(?)', [str(combined)]).fetchone()[0] == manifest['rows']
manifest['download'] = combined.name
manifest['sha256'] = hashlib.file_digest(combined.open('rb'), 'sha256').hexdigest()
shutil.copyfile(combined, args.output / combined.name)
for filename in ['coverage.json', 'coverage.md', 'README.md', 'unavailable-sources.csv']:
    shutil.copyfile(args.source / filename, args.output / filename)
(args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'Validated and exported {manifest["rows"]:,} records across {len(coverage)} years to {args.output}')
