#!/usr/bin/env bash
# Run one of the schools builds (Python, with openpyxl and duckdb in a uv venv).
#   npm run build:schools-d1 -- [extract.xlsx] [field_dictionary.csv]   (build_d1.py; defaults: /data/schools-src/…)
#   npm run build:schools-dpwh                                           (build_dpwh_links.py)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
VENV="${VENV:-/tmp/schools-venv}"
[ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c "import openpyxl, duckdb" 2>/dev/null \
  || { [ -x "$VENV/bin/python" ] || uv venv -q "$VENV"; uv pip install -q --python "$VENV/bin/python" openpyxl duckdb; }
script="$1"; shift
"$VENV/bin/python" -I "$here/$script" "$@"
