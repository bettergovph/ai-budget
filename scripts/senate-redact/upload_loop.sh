#!/usr/bin/env bash
# Upload each finished region as soon as its output check is clean (Jason, 2026-11-14), then update the Senate file list
# and purge the CDN. Runs until the redaction run has ended and every finished region is uploaded.
S=/home/jason/.paseo/worktrees/241ehmra/senate-redact/scripts/senate-redact
set -a; source ~/projects/ai-reports/.env; set +a
T=$(grep -E '^(export )?CLOUDFLARE_API_TOKEN=' ~/.bettergov/.env | head -1 | cut -d= -f2- | tr -d '"'"'")
Z=d2ee3b1f224cd768d821b1d8253eb6c8
while true; do
  todo=()
  for d in /data/senate-redact/*/; do
    d=${d%/}; s=$(basename "$d")
    [ -f "$d/stats.json" ] && [ -f "$d/index.html" ] && [ ! -f "$d/upload.json" ] && grep -q " 0 problems$" "$d/check.log" 2>/dev/null && todo+=("$s")
  done
  if [ ${#todo[@]} -gt 0 ]; then
    echo "== upload ${todo[*]} $(date -u +%FT%TZ)"
    "$S/.venv/bin/python" "$S/upload_redacted.py" /data/senate-redact "${todo[@]}" --concurrency 24
    "$S/.venv/bin/python" "$S/update_links_jsonl.py" /data/senate-redact
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$Z/purge_cache" -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      --data '{"prefixes":["budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/"]}' | grep -o '"success":[a-z]*'
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$Z/purge_cache" -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      --data '{"files":["https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents-file-links.jsonl"]}' | grep -o '"success":[a-z]*'
  fi
  pgrep -f "run_regions.sh|run_large.sh" >/dev/null || [ ${#todo[@]} -gt 0 ] || break
  sleep 300
done
echo "== upload loop done $(date -u +%FT%TZ)"
