#!/usr/bin/env bash
# The long-file pass (Jason, 2026-11-15): PDFs of 20-100 pages the main run skipped, glm-4.6v only (cost), no sweep.
#   run_large.sh ROOT "Region II" "Region XIII" …       → ROOT/<slug>-large/{src,redacted,gallery,index.html,stats.json}
# Downloads only those files (page counts from the main run's manifests). Uploads happen in upload_loop.sh.
# MIN_PAGES/MAX_PAGES/SUFFIX pick the band (default 20-100, "-large"; Jason 2026-11-15 then ran 101+ as "-xl");
# GALLERY=0 skips the before|after images (disk) and writes a plain index.html so the upload loop still picks it up.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PY="$HERE/.venv/bin/python"; ROOT="$1"; shift
MIN_PAGES="${MIN_PAGES:-20}"; MAX_PAGES="${MAX_PAGES:-100}"; SUFFIX="${SUFFIX:--large}"; GALLERY="${GALLERY:-1}"
set -a; source ~/.bettergovph/.env; set +a
export SIG_CACHE="$ROOT/cache"
LINKS="$HERE/cache/links$SUFFIX.jsonl"
"$PY" - "$ROOT" "$HERE/cache/file-links.jsonl" "$LINKS" "$MIN_PAGES" "$MAX_PAGES" <<'PYEOF'
import json, os, sys
root, src, dst, lo, hi = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
want = set()
for slug in os.listdir(root):
    m = os.path.join(root, slug, "manifest.json")
    if not os.path.exists(m) or slug.endswith("-large") or slug.endswith("-xl") or slug == "zz-excerpts":
        continue
    for f in json.load(open(m))["files"]:
        if f["status"] != "kept" and "more than" in f.get("reason", "") and lo <= f.get("pages", 0) <= hi:
            want.update([f["path"]] + f.get("same_as", []))
with open(dst, "w") as out:
    n = 0
    for line in open(src):
        if json.loads(line)["path"] in want:
            out.write(line); n += 1
print(f"{n} rows of {lo}-{hi} pages")
PYEOF
for REGION in "$@"; do
  SLUG=$(echo "$REGION" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g')$SUFFIX; D="$ROOT/$SLUG"; mkdir -p "$D"
  echo "== $REGION ($SLUG) $(date -u +%FT%TZ)"; T0=$(date +%s)
  "$PY" "$HERE/census.py" "$REGION" "$D" --links "$LINKS" --min-pages "$MIN_PAGES" --max-pages "$MAX_PAGES" > "$D/census.log" 2>&1 || { echo "census failed"; continue; }
  tail -1 "$D/census.log"
  "$PY" "$HERE/redact_signatures.py" detect "$D/src" --models glm-4.6v --concurrency glm-4.6v=10 > "$D/detect.log" 2>&1
  grep -v "files (" "$D/detect.log" | tail -2
  ERRS=$(grep -oE "glm-4.6v: [0-9]+ files, .* ([0-9]+) errors" "$D/detect.log" | grep -oE "[0-9]+ errors" | grep -oE "[0-9]+" || echo 0)
  if [ "${ERRS:-0}" -gt 50 ]; then
    BAL=$(curl -s https://api.z.ai/api/paas/v4/chat/completions -H "Authorization: Bearer $GLM_API_KEY" -H "Content-Type: application/json" \
      -d '{"model":"glm-4.6v","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}' | grep -o '"code":"1113"')
    if [ -n "$BAL" ]; then echo "Z.ai balance exhausted ($ERRS failed pages): stopping"; break; fi
  fi
  rm -rf "$D/redacted"
  "$PY" "$HERE/redact_signatures.py" apply "$D/src" "$D/redacted" --models glm-4.6v > "$D/apply.log" 2>&1; grep -v MuPDF "$D/apply.log" | tail -1
  "$PY" "$HERE/check_outputs.py" "$D" > "$D/check.log" 2>&1; tail -1 "$D/check.log"
  if [ "$GALLERY" = 1 ]; then "$PY" "$HERE/build_gallery.py" "$D"
  else echo "<!doctype html><meta charset=utf-8><p>$REGION, PDFs of $MIN_PAGES-$MAX_PAGES pages: no gallery (disk).</p>" > "$D/index.html"; fi
  "$PY" - "$D" "$T0" <<'PYEOF'
import json, os, re, sys, time
d, t0 = sys.argv[1], int(sys.argv[2])
last = [l for l in open(os.path.join(d, "apply.log")).read().splitlines() if l.startswith("{")][-1]
a = eval(last.split(" |")[0])
st = {**a, "sweep_pages": "none (glm-4.6v only, no sweep)", "review": int(re.search(r"(\d+) pages to look at", last).group(1)),
      "errors": sum(1 for l in open(os.path.join(d, "apply.log")) if l.startswith("ERROR")),
      "check": open(os.path.join(d, "check.log")).read().strip().splitlines()[-1],
      "minutes": round((time.time() - t0) / 60, 1), "finished": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())}
json.dump(st, open(os.path.join(d, "stats.json"), "w"), indent=1); print(st)
PYEOF
  "$PY" "$HERE/build_gallery.py" --index "$ROOT"
done
echo "== all done $(date -u +%FT%TZ)"
