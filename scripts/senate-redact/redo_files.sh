#!/usr/bin/env bash
# Re-run apply → sweep → apply for some files of a finished region and put them into its redacted/ folder.
#   redo_files.sh REGION_DIR "rel/path1.pdf" "rel/path2.pdf" …     (paths relative to REGION_DIR/src)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PY="$HERE/.venv/bin/python"; D="$1"; shift
set -a; source ~/.bettergovph/.env; set +a
export SIG_CACHE="$(dirname "$D")/cache"
T="$D/_redo"; rm -rf "$T"; mkdir -p "$T/src"
for rel in "$@"; do mkdir -p "$T/src/$(dirname "$rel")"; ln -f "$D/src/$rel" "$T/src/$rel"; done
"$PY" "$HERE/redact_signatures.py" apply "$T/src" "$T/pass1" | tail -1
"$PY" "$HERE/redact_signatures.py" sweep "$T/pass1" | tail -1
"$PY" "$HERE/redact_signatures.py" apply "$T/pass1" "$T/redacted" --sweep glm-5v-turbo | tail -1
"$PY" - "$D" "$T" "$@" <<'PYEOF'
import json, os, shutil, sys
d, t, rels = sys.argv[1], sys.argv[2], sys.argv[3:]
for rel in rels:
    os.makedirs(os.path.dirname(os.path.join(d, "redacted", rel)), exist_ok=True)
    shutil.copy2(os.path.join(t, "redacted", rel), os.path.join(d, "redacted", rel))
for stage in ("pass1", "redacted"):
    f, g = os.path.join(d, stage, "_changed.json"), os.path.join(t, stage, "_changed.json")
    cur = json.load(open(f)) if os.path.exists(f) else {}
    cur.update(json.load(open(g)) if os.path.exists(g) else {})
    json.dump(cur, open(f, "w"), indent=1)
print(f"replaced {len(rels)} files in {d}/redacted")
PYEOF
"$PY" "$HERE/build_gallery.py" "$D"
rm -rf "$T"
