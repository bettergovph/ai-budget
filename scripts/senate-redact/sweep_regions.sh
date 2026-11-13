#!/usr/bin/env bash
# The deferred sweep for regions run with SWEEP=0: glm-5v-turbo re-reads each barred page of pass1/, bars what it
# finds, and the result replaces redacted/; then the output check, gallery and stats. Pass1 PDFs are deleted after.
#   sweep_regions.sh ROOT [slug …]      (no slugs: every ROOT/<slug> with a SWEEP_PENDING marker)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PY="$HERE/.venv/bin/python"; ROOT="$1"; shift
set -a; source ~/.bettergovph/.env; set +a
export SIG_CACHE="$ROOT/cache"
SLUGS=("$@"); [ ${#SLUGS[@]} -eq 0 ] && SLUGS=($(cd "$ROOT" && ls -d */ | tr -d / | while read s; do [ -f "$s/SWEEP_PENDING" ] && echo "$s"; done))
for SLUG in "${SLUGS[@]}"; do
  D="$ROOT/$SLUG"; echo "== sweep $SLUG $(date -u +%FT%TZ)"
  "$PY" "$HERE/redact_signatures.py" sweep "$D/pass1" > "$D/sweep.log" 2>&1; tail -1 "$D/sweep.log"
  rm -rf "$D/redacted.new"
  "$PY" "$HERE/redact_signatures.py" apply "$D/pass1" "$D/redacted.new" --sweep glm-5v-turbo > "$D/apply-sweep.log" 2>&1; tail -1 "$D/apply-sweep.log"
  if grep -q "^ERROR" "$D/apply-sweep.log"; then echo "errors: keeping the unswept redacted/ for $SLUG"; continue; fi
  rm -rf "$D/redacted" && mv "$D/redacted.new" "$D/redacted"
  "$PY" "$HERE/check_outputs.py" "$D" > "$D/check.log" 2>&1; tail -1 "$D/check.log"
  "$PY" "$HERE/build_gallery.py" "$D"
  "$PY" - "$D" <<'PYEOF'
import json, os, sys
d = sys.argv[1]
s = eval(open(os.path.join(d, "apply-sweep.log")).read().strip().splitlines()[-1].split(" |")[0])
st = json.load(open(os.path.join(d, "stats.json"))); st["sweep_pages"] = s["pages_changed"]
st["check"] = open(os.path.join(d, "check.log")).read().strip().splitlines()[-1]
json.dump(st, open(os.path.join(d, "stats.json"), "w"), indent=1); print(st)
PYEOF
  find "$D/pass1" -type f -iname '*.pdf' -delete; rm -f "$D/SWEEP_PENDING"
done
"$PY" "$HERE/build_gallery.py" --index "$ROOT"
echo "== sweep done $(date -u +%FT%TZ)"
