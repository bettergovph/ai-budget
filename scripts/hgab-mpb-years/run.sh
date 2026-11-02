#!/usr/bin/env bash
# Every multi-purpose building line, FY2015 GAA to the FY2027 House bill, placed for the map at
# /hgab/2027/multi-purpose/map. See docs/hgab-mpb-years.md.
#   UPSTREAM_DIR  where the pinned workbench files are fetched (default: /tmp/hgab-mpb-years-upstream)
#   UPSTREAM_GIT  a local clone of the workbench holding the pinned commit (default: download raw files)
#   SHAPES_DIR    the 2023 PSA shapefiles, laid out as the workbench has them (Municities/, BgySubMuns/, Provdists/;
#                 default: the workbench clone's dpwh_coor2psgc_geomapping copy if there, else the pinned dist zips,
#                 downloaded once to /tmp/hgab-mpb-years-shapes)
#   HISTORY_DIR   the GAA history release, FY2015–FY2019 (default: data/gaa-history)
#   OUT           outputs (default: data/hgab/2027/mpb-years; the next upload:hgab publishes it)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
OUT="${OUT:-$root/data/hgab/2027/mpb-years}"
HISTORY_DIR="${HISTORY_DIR:-$root/data/gaa-history}"
UPSTREAM_DIR="${UPSTREAM_DIR:-/tmp/hgab-mpb-years-upstream}"
LOCAL_SHAPES=/tmp/dpwh-nep-head/dpwh_coor2psgc_geomapping/philippines-psgc-shapefiles/data/2023
if [ -z "${SHAPES_DIR:-}" ]; then [ -d "$LOCAL_SHAPES" ] && SHAPES_DIR="$LOCAL_SHAPES" || SHAPES_DIR=/tmp/hgab-mpb-years-shapes/2023; fi
VENV="${VENV:-/tmp/hgab-mpb-years-venv}"
# The workbench's own pins (dpwh_coor2psgc_geomapping submodule): altcoder/philippines-psgc-shapefiles, 2023 release.
SHP_REF=a44a73091f19e4950dbdc0d7cb77a5e17b101a0a

[ -x "$VENV/bin/python" ] || { uv venv -q -p 3.12 "$VENV" && uv pip install -q --python "$VENV/bin/python" \
  duckdb geopandas==1.1.1 shapely==2.1.2 pandas==2.2.3 pyogrio==0.12.1; }
py="$VENV/bin/python"

if [ ! -s "$SHAPES_DIR/BgySubMuns/PH_Adm4_BgySubMuns.shp.shp" ]; then
  echo "== 2023 PSA shapefiles (once)"
  zips="$(dirname "$SHAPES_DIR")/zips"; mkdir -p "$zips"
  for z in PH_Adm2_ProvDists PH_Adm3_MuniCities PH_Adm4_BgySubMuns; do
    [ -s "$zips/$z.shp.zip" ] || curl -sSfL -o "$zips/$z.shp.zip" \
      "https://media.githubusercontent.com/media/altcoder/philippines-psgc-shapefiles/$SHP_REF/dist/$z.shp.zip"
  done
  "$py" -I -c "import zipfile,sys; [zipfile.ZipFile(f'{sys.argv[1]}/{z}.shp.zip').extractall(f'{sys.argv[2]}/{d}') for z,d in [('PH_Adm2_ProvDists','Provdists'),('PH_Adm3_MuniCities','Municities'),('PH_Adm4_BgySubMuns','BgySubMuns')]]" "$zips" "$SHAPES_DIR"
fi

echo "== workbench files at the pinned commit"
up="$("$py" -I "$here/upstream.py" "$UPSTREAM_DIR")"
echo "$up"

echo "== build"
cd "$root"
"$py" -I "$here/build.py" --upstream="$up" --shapes="$SHAPES_DIR" --data="$root/data" --history="$HISTORY_DIR" --out="$OUT"
