#!/usr/bin/env bash
# Parse the Senate Committee Report on HB 10858 (FY2027 GAB) and map it onto our House bill data.
# See docs/senate-cr-2027.md.
#   SRC   the report's PDFs (General Summary, Annexes A, A-1..A-5, B), unzipped from "Senate CR 2027.zip"
#         (default: /data/senate-cr-2027/raw)
#   OUT   working outputs (default: data/senate-cr/2027, NOT under data/hgab/2027, which upload:hgab publishes)
#   SITE  what the /senate/2027 pages read (default: data/senate/2027; `npm run upload:senate` publishes it)
# Needs data/hgab-lines/2027/tables-vol{1a,1b}.json (build:hgab-lines) and data/hgab/2027/{dpwh,fmr,nia,hfep}.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
SRC="${SRC:-/data/senate-cr-2027/raw}"
OUT="${OUT:-$root/data/senate-cr/2027}"
HGAB="$root/data/hgab/2027"
LINES="$root/data/hgab-lines/2027"
VENV="${VENV:-/tmp/senate-cr-venv}"
mkdir -p "$OUT/pdf"
[ -x "$VENV/bin/python" ] || { uv venv -q "$VENV" && uv pip install -q --python "$VENV/bin/python" pdfplumber duckdb rapidfuzz; }
py() { "$VENV/bin/python" -I "$@"; }
pdf() { ls "$SRC"/"$1"*.pdf | head -1; }

echo "== General Summary"
py "$here/parse_summary.py" "$(pdf "General Summary")" "$OUT/general_summary.json"
echo "== Annex A: line-by-line amendments (Vol I-A, I-B) -> House bill tables"
py "$here/parse_annex_a.py" "$(pdf "Annex A - Line")" "$OUT/annex_a.json"
py "$here/check_annex_a.py" "$OUT/annex_a.json" | tail -1
py "$here/map_annex_a.py" "$OUT/annex_a.json" "$LINES" "$OUT/annex_a_mapped.csv"
echo "== Annex A-4: DPWH projects (Vol I-C)"
py "$here/parse_annex_a4.py" "$(pdf "Annex A-4")" "$OUT/annex_a4.json"
py "$here/map_annex_a4.py" "$OUT/annex_a4.json" "$HGAB/dpwh/projects.parquet" "$OUT/annex_a4_mapped.csv"
echo "== Annex A-1: farm-to-market roads"
py "$here/parse_two_col.py" fmr "$(pdf "Annex A-1")" "$OUT/annex_a1_fmr.json"
py "$here/map_projects.py" fmr "$OUT/annex_a1_fmr.json" "$HGAB/fmr/projects.parquet" "$OUT/annex_a1_fmr_mapped.csv"
echo "== Annex A-3: NIA projects"
py "$here/parse_two_col.py" nia "$(pdf "Annex A-3")" "$OUT/annex_a3_nia.json"
py "$here/map_projects.py" nia "$OUT/annex_a3_nia.json" "$HGAB/nia/projects.parquet" "$OUT/annex_a3_nia_mapped.csv"
echo "== Annex A-2: HFEP"
py "$here/parse_hfep.py" "$(pdf "Annex A-2")" "$OUT/annex_a2_hfep.json"
py "$here/map_hfep.py" "$OUT/annex_a2_hfep.json" "$HGAB/hfep/projects.parquet" "$OUT/annex_a2_hfep_mapped.csv"
echo "== Annex B: special and general provisions"
py "$here/parse_annex_b.py" "$(pdf "Annex B")" "$OUT/annex_b.json"
echo "== Senate version of every House project (dpwh, fmr, nia, hfep)"
py "$here/build_versions.py" "$OUT" "$HGAB" "$OUT"
cp "$SRC"/*.pdf "$OUT/pdf/"
( cd "$OUT/pdf" && sha256sum *.pdf > SHA256SUMS )
echo "== Site data for /senate/2027 (published by upload:senate)"
SITE="${SITE:-$root/data/senate/2027}"
mkdir -p "$SITE"
py "$here/build_explorer_senate.py" "$OUT" "$LINES" "$HGAB" "$SITE"
py "$here/build_site.py" "$OUT" "$HGAB" "$SITE"
echo "== The downloadable dataset, with its checks (stops if one fails)"
py "$here/build_downloads.py" "$OUT" "$SITE"
echo "done -> $OUT, $SITE"
