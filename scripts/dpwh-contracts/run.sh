#!/usr/bin/env bash
# npm run build:hgab-contractors. DPWH's contract list, every contractor's figures, and the DPWH GAA project lines,
# FY2020–FY2026, linked to the contracts that carry them. See docs/dpwh-contracts.md.
#   OUT     working outputs (default: data/dpwh-contracts, a symlink to /data/backups/projects/ai-reports/data/dpwh-contracts)
#   SITE    the site's files (default: data/hgab/2027/contractors; upload:hgab --only=contractors publishes them),
#           with the downloads and their manifest.json in SITE/downloads.
#           Needs the multi-purpose map's lines (npm run build:hgab-mpb-years) for the map's contracts.
#   GAA     the DPWH GAA extract (default: data/18/full_extract.csv)
#   REUSE=1 keep contract-list pages already downloaded (default: download the list again)
#   QA=1    also check a sample of links against the contracts' component titles (a few hundred API requests)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
OUT="${OUT:-$root/data/dpwh-contracts}"
GAA="${GAA:-$root/data/18/full_extract.csv}"
SITE="${SITE:-$root/data/hgab/2027/contractors}"
VENV="${VENV:-/tmp/dpwh-contracts-venv}"
[ -x "$VENV/bin/python" ] || { uv venv -q -p 3.12 "$VENV" && uv pip install -q --python "$VENV/bin/python" duckdb rapidfuzz pandas; }
py="$VENV/bin/python"

echo "== contract list (api.dpwh.bettergov.ph)"
"$py" -I "$here/fetch.py" "$OUT" ${REUSE:+--reuse}
echo "== match FY2020–FY2026"
"$py" -I "$here/match.py" "$GAA" "$OUT/contracts.parquet" "$OUT/gaa-2020-2026"
if [ -n "${QA:-}" ]; then echo "== sample check"; "$py" -I "$here/qa.py" "$OUT/gaa-2020-2026"; fi
echo "== the site's files"
"$py" -I "$here/build_site.py" "$OUT/contracts.parquet" "$OUT/gaa-2020-2026" "$root/data/hgab/2027/mpb-years/lines.csv" "$SITE"
echo "== downloads and manifest.json"
"$py" -I "$here/build_downloads.py" "$OUT" "$SITE" "$GAA"
