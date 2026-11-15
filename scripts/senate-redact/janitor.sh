#!/usr/bin/env bash
# Every 2 minutes, for finished regions (stats.json + gallery): drop the before|after preview PNGs (the gallery keeps
# its JPEGs) and, once uploaded, the downloaded originals (src).
while true; do
  for r in /data/senate-redact/*/; do
    r=${r%/}
    [ -f "$r/stats.json" ] && [ -f "$r/index.html" ] || continue
    rm -rf "$r/pass1/_qa" "$r/redacted/_qa"
    [ -f "$r/upload.json" ] && rm -rf "$r/src"
  done
  sleep 120
done
