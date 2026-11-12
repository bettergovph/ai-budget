#!/usr/bin/env bash
# Extract the team's volunteer red-flag registry (the crosswalk workbook) into src/lib/hgab-redflag-registry.json.
#   npm run build:hgab-redflag-registry -- [workbook.xlsx]   (default: data/hgab/2027/review-registry/red-flag-volunteer-crosswalk-v2.xlsx)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
VENV="${VENV:-/tmp/hgab-review-venv}"
[ -x "$VENV/bin/python" ] || { uv venv -q "$VENV" && uv pip install -q --python "$VENV/bin/python" openpyxl; }
"$VENV/bin/python" -I "$here/build_registry.py" "$@"
