"""Download the DPWH contract list from our API (api.dpwh.bettergov.ph, a cached proxy over DPWH's transparency
portal) into OUT/raw/page-NNNN.json.gz, then write OUT/contracts.parquet: one row per contract, list fields only.

The list has the contractor; the per-contract detail (components, bidders, documents) is not fetched.
    python fetch.py OUT [--limit 5000] [--reuse]   (--reuse: keep pages already downloaded)
"""
import argparse, gzip, json, sys, time, urllib.request, hashlib
from datetime import datetime, timezone
from pathlib import Path
import duckdb

API = 'https://api.dpwh.bettergov.ph/projects'
ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('--limit', type=int, default=5000); ap.add_argument('--reuse', action='store_true')
a = ap.parse_args()
out = Path(a.out); raw = out / 'raw'; raw.mkdir(parents=True, exist_ok=True)

def get(page):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(f'{API}?page={page}&limit={a.limit}', timeout=180) as r:
                return json.load(r)['data']
        except Exception as e:
            print(f'  page {page}: {e}; retry {attempt + 1}', file=sys.stderr); time.sleep(5 * (attempt + 1))
    sys.exit(f'page {page} failed')

page, pages, total, summary = 1, None, None, None
while pages is None or page <= pages:
    f = raw / f'page-{page:04d}.json.gz'
    if a.reuse and f.exists():
        d = json.load(gzip.open(f))
    else:
        d = get(page)
        with gzip.open(f, 'wt') as fh: json.dump(d, fh)
        time.sleep(0.5)
    pg = d['pagination']; pages = pg['totalPages']; total = pg['totalCount']; summary = summary or d.get('summary')
    print(f'page {page}/{pages}: {len(d["data"])} rows', flush=True)
    page += 1
for f in sorted(raw.glob('page-*.json.gz')):
    if int(f.stem.split('-')[1].split('.')[0]) > pages: f.unlink()   # stale pages from a longer earlier run

# one contract per line, then DuckDB (reading the page files whole runs out of memory)
rows = out / 'contracts.jsonl.gz'
with gzip.open(rows, 'wt') as fh:
    for f in sorted(raw.glob('page-*.json.gz')):
        for r in json.load(gzip.open(f))['data']:
            fh.write(json.dumps(r) + '\n')
con = duckdb.connect()
con.sql(f"create table c as select * from read_json('{rows}', format='newline_delimited', sample_size=-1)")
cols = [r[0] for r in con.sql('describe c').fetchall()]
n, ids = con.sql('select count(*), count(distinct contractId) from c').fetchall()[0]
print(f'rows {n:,}, distinct contract ids {ids:,}, API total {total:,}')
if ids != total:
    sys.exit(f'contract ids {ids:,} != API total {total:,}: the list changed while paging; run again')
con.sql(f"""copy (select * from c qualify row_number() over (partition by contractId order by contractId) = 1 order by contractId)
  to '{out}/contracts.parquet' (format parquet, compression zstd)""")
pages_at = sorted(datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(timespec='seconds')
                  for f in raw.glob('page-*.json.gz'))
meta = dict(source=API, downloaded_from=pages_at[0], downloaded_to=pages_at[-1],
            page_size=a.limit, pages=pages, contracts=ids, api_summary=summary, columns=cols,
            sha256=hashlib.sha256((out / 'contracts.parquet').read_bytes()).hexdigest())
(out / 'contracts.meta.json').write_text(json.dumps(meta, indent=1) + '\n')
print(json.dumps({k: meta[k] for k in ('contracts', 'pages', 'api_summary')}))
