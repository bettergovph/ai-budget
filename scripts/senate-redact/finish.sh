#!/usr/bin/env bash
# After the last region: excerpts → extraction → batch sweep → re-upload, one at a time (they share glm-5v-turbo).
set -uo pipefail
W=/home/jason/.paseo/worktrees/241ehmra/senate-redact/scripts
PY=$W/senate-redact/.venv/bin/python
set -a; source ~/.bettergovph/.env; source ~/projects/ai-reports/.env; set +a
export SIG_CACHE=/data/senate-redact/cache
log() { echo "== $* $(date -u +%FT%TZ)"; }
while pgrep -f run_regions.sh >/dev/null; do sleep 60; done
log "regions done"
# 1. excerpts (extraction only, never uploaded)
D=/data/senate-redact/zz-excerpts
$PY $W/senate-redact/redact_signatures.py detect $D/src 2>&1 | grep -v "files (" | tail -3
$PY $W/senate-redact/redact_signatures.py verify $D/src --concurrency 8 2>&1 | tail -1
rm -rf $D/redacted
$PY $W/senate-redact/redact_signatures.py apply $D/src $D/redacted 2>&1 | grep -v MuPDF | tail -1
$PY $W/senate-redact/check_outputs.py $D 2>&1 | tail -1
echo '{"note": "extraction-only excerpts, never uploaded"}' > $D/stats.json
log "excerpts done"
# 2. extraction (Region III and the excerpt projects)
cd $W/senate-extract && EXTRACT_THREADS=8 $PY extract_projects.py all /data/senate-extract/all 2>&1 | grep -v MuPDF | tail -1
log "extraction done"
# 3. batch sweep of every deferred region
SWEPT=$(cd /data/senate-redact && for s in */; do s=${s%/}; [ -f "$s/SWEEP_PENDING" ] && echo $s; done)
log "sweeping: $SWEPT"
$W/senate-redact/sweep_regions.sh /data/senate-redact 2>&1 | grep -v MuPDF
# 4. re-upload the swept regions over our first-pass uploads, file list, purge
$PY $W/senate-redact/upload_redacted.py /data/senate-redact $SWEPT --concurrency 24
$PY $W/senate-redact/update_links_jsonl.py /data/senate-redact
T=$(grep -E '^(export )?CLOUDFLARE_API_TOKEN=' ~/.bettergov/.env | head -1 | cut -d= -f2- | tr -d '"'"'")
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/d2ee3b1f224cd768d821b1d8253eb6c8/purge_cache" -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data '{"prefixes":["budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/"]}' | grep -o '"success":[a-z]*'
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/d2ee3b1f224cd768d821b1d8253eb6c8/purge_cache" -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data '{"files":["https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents-file-links.jsonl"]}' | grep -o '"success":[a-z]*'
log "all finished"
