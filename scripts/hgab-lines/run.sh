#!/usr/bin/env bash
# Parse every money table of HB 10858 outside the DPWH project detail (Vol I-C), in both the 3rd and the
# 2nd reading, plus the Vol I-B DepEd and SBDP annexes, and compare the 3rd reading line by line with the
# FY2027 NEP. See docs/hgab-non-infra-lines.md.
#   HB_PDF_GLOB   3rd-reading volumes          (default: ~/.paseo/uploads/*/hb-10858-vol-{v}.pdf)
#   HB2_DIR       2nd-reading volumes          (default: the workbench clone's HB_BUDGET/)
#   NEP_CSV       the DBM NEP extract           (default: ~/projects/2027-budget/NEP-FY2027.csv)
#   NEP_PDF_DIR   the NEP volumes I, II-A, II-B, III (machine-read scans; default: the workbench clone's
#                 dbm-nep-data/), for the NEP page of each line
#   OUT           working outputs               (default: data/hgab-lines/2027, NOT under data/hgab/2027,
#                                                which upload:hgab publishes wholesale). The explorer data and
#                                                the public downloads go to data/hgab/2027/explorer/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
OUT="${OUT:-$root/data/hgab-lines/2027}"
NEP_CSV="${NEP_CSV:-$HOME/projects/2027-budget/NEP-FY2027.csv}"
HB2_DIR="${HB2_DIR:-/tmp/dpwh-nep-head/HB_BUDGET}"
NEP_PDF_DIR="${NEP_PDF_DIR:-/tmp/dpwh-nep-head/dbm-nep-data}"
VENV="${VENV:-/tmp/hgab-lines-venv}"
mkdir -p "$OUT/reading2"
[ -x "$VENV/bin/python" ] || { uv venv -q "$VENV" && uv pip install -q --python "$VENV/bin/python" pymupdf duckdb; }
py="$VENV/bin/python"
cd "$here"

echo "== 3rd reading"
for v in 1a 1b; do "$py" parse_hb.py "$v" > "$OUT/tables-vol$v.json"; done
"$py" flatten.py "$OUT/tables-vol1a.json" "$OUT/tables-vol1b.json" "$OUT/hb_line_items.csv" "$OUT/hb_agency_checks.json"

echo "== 2nd reading"
if [ -f "$HB2_DIR/1 - HB 10858 VOL IA.pdf" ]; then
  export HB2_PDF_1B="$HB2_DIR/2 - HB 10858 VOL IB.pdf"
  for v in 1a 1b; do
    f="$HB2_DIR/1 - HB 10858 VOL IA.pdf"; [ "$v" = 1b ] && f="$HB2_PDF_1B"
    env "HB_PDF_${v^^}=$f" "$py" parse_hb.py "$v" > "$OUT/reading2/tables-vol$v.json"
  done
  HB_READING="2nd reading" "$py" flatten.py "$OUT/reading2/tables-vol1a.json" "$OUT/reading2/tables-vol1b.json" \
    "$OUT/reading2/hb_line_items.csv" "$OUT/reading2/hb_agency_checks.json"
  "$py" compare_readings.py "$OUT/reading2/hb_line_items.csv" "$OUT/hb_line_items.csv" "$OUT/reading_changes.csv"
else
  echo "   (skipped: no 2nd-reading copies in $HB2_DIR)"
fi

echo "== Vol I-B annexes"
"$py" parse_annex_deped.py "$OUT/deped_niu_schools.csv"
"$py" parse_annex_sbdp.py "$OUT/sbdp_barangays.csv"

echo "== NEP comparison"
[ -f "$OUT/nep.duckdb" ] || "$py" build_nep_db.py "$NEP_CSV" "$OUT/nep.duckdb"
# The NEP page that prints each NEP row (needs the NEP PDF volumes; without them lines carry no NEP page)
if [ -f "$NEP_PDF_DIR/NEP-2027-VOLUME-1_OCR.pdf" ]; then
  NEP_PDF_DIR="$NEP_PDF_DIR" "$py" -W ignore nep_pages.py "$OUT/nep.duckdb" "$OUT" "$OUT/deped_niu_schools.csv"
else
  echo "   (NEP pages skipped: no NEP volumes in $NEP_PDF_DIR)"; rm -f "$OUT/nep_pages.csv"
fi
"$py" compare.py "$OUT/hb_line_items.csv" "$OUT/nep.duckdb" "$OUT" "$OUT/deped_niu_schools.csv" \
  "$( [ -f "$OUT/reading_changes.csv" ] && echo "$OUT/reading_changes.csv" )"
"$py" compare_objects.py "$OUT/tables-vol1a.json" "$OUT/tables-vol1b.json" "$OUT/agency_map.json" "$OUT/nep.duckdb" "$OUT/object_compare.csv"

echo "== Explorer data (/hgab/2027/explorer; published with the rest of hgab/2027 by upload:hgab)"
"$py" build_explorer.py "$OUT" "${EXPLORER_OUT:-$root/data/hgab/2027/explorer}"

echo "== Downloads (the extracted dataset, published with the explorer)"
"$py" build_downloads.py "$OUT" "${EXPLORER_OUT:-$root/data/hgab/2027/explorer}/downloads"
