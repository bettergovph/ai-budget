#!/usr/bin/env python3
"""Finish the files a region held back (missing from redacted/ after a failed model call or a processing error).

Their public copies are still the originals: each is downloaded again and checked against the manifest's sha256. Pages
where the region's detector failed (glm-4.6v's rare HTTP 400 code 1210 on some images) are put to glm-5v-turbo instead,
and the answer goes into the detector's cache marked `answered_by`. Then the file is redacted like the rest of its region
and the region's output check is re-run; upload_redacted.py uploads it (R2 still holds the original).

  retry_held.py ROOT [--models glm-4.6v] [--fallback glm-5v-turbo] [--dry-run]
"""
import json
import os
import subprocess
import sys

sys.argv, args = sys.argv[:1], sys.argv[1:]
import redact_signatures as rs  # noqa: E402

root = args[0]
models = (args[args.index("--models") + 1] if "--models" in args else "glm-4.6v").split(",")
fallback = args[args.index("--fallback") + 1] if "--fallback" in args else "glm-5v-turbo"
dry = "--dry-run" in args
HERE = os.path.dirname(os.path.abspath(__file__))
links = {}
for line in open(os.path.join(HERE, "cache", "file-links.jsonl")):
    r = json.loads(line)
    links[r["path"]] = r

fixed = held = 0
for slug in sorted(os.listdir(root)):
    d = os.path.join(root, slug)
    check = os.path.join(d, "check.log")
    if not (slug.endswith("-large") or slug.endswith("-xl")) or not os.path.exists(check):
        continue
    missing = [l[4:].rsplit(": missing from redacted/", 1)[0] for l in open(check).read().splitlines()
               if l.startswith("BAD ") and l.endswith(": missing from redacted/")]
    if not missing:
        continue
    manifest = {f["path"]: f for f in json.load(open(os.path.join(d, "manifest.json")))["files"]}
    for rel in missing:
        held += 1
        f, src = manifest[rel], os.path.join(d, "src", rel)
        print(f"{slug}: {rel}")
        if dry:
            continue
        if not (os.path.exists(src) and rs.sha256(src) == f["sha256"]):
            os.makedirs(os.path.dirname(src), exist_ok=True)
            subprocess.run(["curl", "-sf", "--retry", "3", "-o", src, links[rel]["url"]])
        if not os.path.exists(src) or rs.sha256(src) != f["sha256"]:
            print("   not the original any more on budget-assets: skipped")
            continue
        cpath = os.path.join(rs.CACHE, f"{models[0]}.p{rs.PROMPT_VERSION}", f["sha256"] + ".json")
        if os.path.exists(cpath):
            det = json.load(open(cpath))
            doc = rs.pymupdf.open(src)
            for e in det["pages"]:
                if e.get("error"):
                    jpeg, _pix = rs.render(doc[e["page"] - 1])
                    res, err = rs.ask(fallback, jpeg)
                    if not err:
                        for k in ("error",):
                            e.pop(k, None)
                        e.update(res, answered_by=fallback)
                        print(f"   page {e['page']}: answered by {fallback}")
            json.dump(det, open(cpath, "w"), indent=1)
        try:
            cands = rs.verify_file(src, models, fallback)
            st = rs.apply_file(src, os.path.join(d, "redacted", rel), cands, None, rel, "black", models[0])
            print(f"   redacted: {st['pages']} pages, {st['pages_changed']} barred")
            fixed += 1
        except Exception as e:  # noqa: BLE001
            print(f"   still failing: {e}")
    subprocess.run([sys.executable, os.path.join(HERE, "check_outputs.py"), d],
                   stdout=open(check, "w"), stderr=subprocess.STDOUT)
    print("  ", open(check).read().strip().splitlines()[-1])
print(f"{fixed}/{held} held-back files redacted{' (dry run)' if dry else ''}")
