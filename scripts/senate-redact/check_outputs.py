#!/usr/bin/env python3
"""Every kept PDF of a region has a redacted copy that opens in pikepdf and PyMuPDF with the source's page count.

  check_outputs.py REGION_DIR      prints problems and a summary; exit 1 when any
"""
import json, os, sys
import pikepdf
import pymupdf

d = sys.argv[1]
m = json.load(open(os.path.join(d, "manifest.json")))
bad = []
for f in m["files"]:
    if f["status"] != "kept":
        continue
    src, out = os.path.join(d, "src", f["path"]), os.path.join(d, "redacted", f["path"])
    if not os.path.exists(out):
        bad.append((f["path"], "missing from redacted/"))
        continue
    try:
        with pikepdf.open(out) as a, pymupdf.open(out) as b:
            if len(a.pages) != f["pages"] or b.page_count != f["pages"]:
                bad.append((f["path"], f"pages {len(a.pages)}/{b.page_count}, expected {f['pages']}"))
    except Exception as e:  # noqa: BLE001
        bad.append((f["path"], f"unreadable: {e}"))
for p, why in bad:
    print(f"BAD {p}: {why}")
print(f"{m['region']}: {m['kept']} kept, {len(bad)} problems")
sys.exit(1 if bad else 0)
