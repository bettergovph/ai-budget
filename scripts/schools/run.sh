#!/usr/bin/env bash
# Normalise the school shortage + project extract (EDCOM2 / DepEd data pack) into data/schools/d1-import.sql.
#   npm run build:schools-d1 -- [extract.xlsx] [field_dictionary.csv]   (defaults: /data/schools-src/…)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
VENV="${VENV:-/tmp/schools-venv}"
[ -x "$VENV/bin/python" ] || { uv venv -q "$VENV" && uv pip install -q --python "$VENV/bin/python" openpyxl; }
"$VENV/bin/python" -I "$here/build_d1.py" "$@"
