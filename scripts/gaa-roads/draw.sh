#!/usr/bin/env bash
# Road and bridge lines drawn along OpenStreetMap roads (scripts/gaa-roads/draw.py; docs/gaa-roads.md). Run after
# `npm run build:gaa-roads`. Downloads the Geofabrik Philippines extract once (about 600 MB, checksum checked) and
# reads its roads and kilometre posts once (about 20 minutes).
#   OSM_DIR  where the extract and its roads/posts tables live (default: /tmp/gaa-roads-osm)
#   LINES          the roads build's outputs, read and written beside (default: data/gaa/roads)
#   CONTRACTS_DIR  DPWH's contract list, whose stations and points are the kilometre posts (default: data/dpwh-contracts)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
OSM_DIR="${OSM_DIR:-/tmp/gaa-roads-osm}"
LINES="${LINES:-$root/data/gaa/roads}"
VENV="${VENV:-/tmp/gaa-roads-venv}"
PBF_URL=https://download.geofabrik.de/asia/philippines-latest.osm.pbf
[ -x "$VENV/bin/python" ] || { uv venv -q -p 3.12 "$VENV" && uv pip install -q --python "$VENV/bin/python" \
  osmium==4.3.2 shapely==2.2.0 pyproj==3.8.0 duckdb rapidfuzz==3.14.6 numpy; }
py="$VENV/bin/python"
mkdir -p "$OSM_DIR"
if [ ! -s "$OSM_DIR/philippines-latest.osm.pbf" ]; then
  echo "== OpenStreetMap extract (once)"
  (cd "$OSM_DIR" && curl -sSfL -o philippines-latest.osm.pbf "$PBF_URL" && curl -sSfL -o philippines-latest.osm.pbf.md5 "$PBF_URL.md5" \
    && md5sum -c philippines-latest.osm.pbf.md5)
fi
if [ ! -s "$OSM_DIR/out/roads.parquet" ] || [ "$OSM_DIR/philippines-latest.osm.pbf" -nt "$OSM_DIR/out/roads.parquet" ]; then
  echo "== roads and kilometre posts (once per extract)"
  "$py" -I "$here/osm_extract.py" "$OSM_DIR/philippines-latest.osm.pbf" "$OSM_DIR/out"
fi
echo "== draw"
cd "$root"
"$py" -I "$here/draw.py" --osm="$OSM_DIR/out" --pbf="$OSM_DIR/philippines-latest.osm.pbf" --lines="$LINES" \
  --contracts="${CONTRACTS_DIR:-$root/data/dpwh-contracts}" --districts="$root/data/hgab/2027/mpb-years/districts.geojson"
