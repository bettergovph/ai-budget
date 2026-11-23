#!/usr/bin/env bash
# Every road and bridge line in the FY2015 to FY2026 GAA and the 2027 NEP and House bill, placed for the roads map.
# See docs/gaa-roads.md. Reuses the multi-purpose map's environment (scripts/hgab-mpb-years/run.sh): its venv,
# pinned workbench files and centroid cache; run `npm run build:hgab-mpb-years` once first.
#   LENS_DIR      a workbench checkout holding the built location lens, at the commit data/hgab/2027/locations.json
#                 records (default: /tmp/dpwh-nep-head; docs/hgab-data.md, "Project locations")
#   SHAPES_DIR    the 2023 PSA shapefiles (default: the lens checkout's dpwh_coor2psgc_geomapping copy)
#   HISTORY_DIR   the GAA history release, FY2015–FY2019 (default: data/gaa-history)
#   CONTRACTS_DIR DPWH's contract list and the FY2020–FY2026 line links (default: data/dpwh-contracts; docs/dpwh-contracts.md)
#   OUT           outputs (default: data/gaa/roads)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
OUT="${OUT:-$root/data/gaa/roads}"
HISTORY_DIR="${HISTORY_DIR:-$root/data/gaa-history}"
CONTRACTS_DIR="${CONTRACTS_DIR:-$root/data/dpwh-contracts}"
LENS_DIR="${LENS_DIR:-/tmp/dpwh-nep-head}"
SHAPES_DIR="${SHAPES_DIR:-$LENS_DIR/dpwh_coor2psgc_geomapping/philippines-psgc-shapefiles/data/2023}"
UPSTREAM_DIR="${UPSTREAM_DIR:-/tmp/hgab-mpb-years-upstream}"
VENV="${VENV:-/tmp/hgab-mpb-years-venv}"
[ -x "$VENV/bin/python" ] || { echo "no venv at $VENV: run npm run build:hgab-mpb-years once" >&2; exit 1; }
py="$VENV/bin/python"
up="$("$py" -I "$root/scripts/hgab-mpb-years/upstream.py" "$UPSTREAM_DIR")"
cd "$root"
"$py" -I "$here/build.py" --upstream="$up" --lens="$LENS_DIR" --shapes="$SHAPES_DIR" --data="$root/data" \
  --history="$HISTORY_DIR" --contracts="$CONTRACTS_DIR" --out="$OUT"
