#!/usr/bin/env bash
# Redact regions one after another: census → detect → verify → apply (pass1) → sweep → apply (redacted) → check → gallery.
#   run_regions.sh ROOT "Region IV-B (MIMAROPA)" "Region VII" …
# ROOT/<slug>/{src,pass1,redacted,gallery,index.html,manifest.json,stats.json,*.log}; model cache in ROOT/cache.
# Nothing is uploaded. pass1 PDFs are deleted once `redacted` exists (the sweep reads them); src stays unless the
# disk drops under MIN_FREE_GB, then the finished region's src goes (re-download with census.py).
# Re-running a region is cheap: downloads of the right size are kept and every model reply is cached by file sha256.
# SWEEP=0 defers the sweep: redacted/ is a hard-linked copy of pass1/ (kept), and sweep_regions.sh finishes it later.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PY="$HERE/.venv/bin/python"; ROOT="$1"; shift
MIN_FREE_GB="${MIN_FREE_GB:-12}"; SWEEP="${SWEEP:-1}"
set -a; source ~/.bettergovph/.env; set +a
export SIG_CACHE="$ROOT/cache"
for REGION in "$@"; do
  SLUG=$(echo "$REGION" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g'); D="$ROOT/$SLUG"; mkdir -p "$D"
  echo "== $REGION ($SLUG) $(date -u +%FT%TZ)"
  T0=$(date +%s)
  "$PY" "$HERE/census.py" "$REGION" "$D" > "$D/census.log" 2>&1 || { echo "census failed"; continue; }
  tail -1 "$D/census.log"
  "$PY" "$HERE/redact_signatures.py" detect "$D/src" > "$D/detect.log" 2>&1; grep -v "files (" "$D/detect.log" | tail -3
  "$PY" "$HERE/redact_signatures.py" verify "$D/src" --concurrency 10 > "$D/verify.log" 2>&1; tail -1 "$D/verify.log"
  rm -rf "$D/pass1" "$D/redacted"
  "$PY" "$HERE/redact_signatures.py" apply "$D/src" "$D/pass1" > "$D/apply.log" 2>&1; tail -1 "$D/apply.log"
  if [ "$SWEEP" = 1 ]; then
    "$PY" "$HERE/redact_signatures.py" sweep "$D/pass1" > "$D/sweep.log" 2>&1; tail -1 "$D/sweep.log"
    "$PY" "$HERE/redact_signatures.py" apply "$D/pass1" "$D/redacted" --sweep glm-5v-turbo > "$D/apply-sweep.log" 2>&1; tail -1 "$D/apply-sweep.log"
  else
    cp -al "$D/pass1" "$D/redacted"; rm -f "$D/redacted/_changed.json" "$D/redacted/_review.json"; rm -rf "$D/redacted/_qa"
    echo "{'pages': 0, 'pages_changed': 0} | sweep deferred" > "$D/apply-sweep.log"; touch "$D/SWEEP_PENDING"; echo "sweep deferred"
  fi
  "$PY" "$HERE/check_outputs.py" "$D" > "$D/check.log" 2>&1; tail -1 "$D/check.log"
  "$PY" "$HERE/build_gallery.py" "$D"
  "$PY" - "$D" "$T0" <<'PYEOF'
import json, re, sys, time, os
d, t0 = sys.argv[1], int(sys.argv[2])
last = lambda f: open(os.path.join(d, f)).read().strip().splitlines()[-1]
a = eval(last("apply.log").split(" |")[0]); s = eval(last("apply-sweep.log").split(" |")[0])
st = {**a, "sweep_pages": "deferred" if os.path.exists(os.path.join(d, "SWEEP_PENDING")) else s["pages_changed"], "review": int(re.search(r"(\d+) pages to look at", last("apply.log")).group(1)),
      "errors": sum(1 for f in ("apply.log", "apply-sweep.log") for l in open(os.path.join(d, f)) if l.startswith("ERROR")),
      "check": last("check.log"),
      "minutes": round((time.time() - t0) / 60, 1), "finished": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())}
json.dump(st, open(os.path.join(d, "stats.json"), "w"), indent=1); print(st)
PYEOF
  [ "$SWEEP" = 1 ] && find "$D/pass1" -type f \( -iname '*.pdf' \) -delete
  "$PY" "$HERE/build_gallery.py" --index "$ROOT"
  FREE=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)
  if [ "$FREE" -lt "$MIN_FREE_GB" ]; then echo "low disk (${FREE}G): removing $SLUG/src"; rm -rf "$D/src"; fi
done
echo "== all done $(date -u +%FT%TZ)"
