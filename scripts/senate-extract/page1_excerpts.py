#!/usr/bin/env python3
"""Excerpts of the long BP 202 / POW files the redaction run skipped (20+ pages), so their projects can be extracted.

Extraction only needs POW page 1 and the BP 202's first pages (Jason, 2026-11-14), so: download those originals (still
the originals on budget-assets: the run never uploaded over them), check them against the file list's original
sha256, keep POW page 1 / BP 202 pages 1-3, and lay them out as a pseudo-region that redact_signatures.py redacts and
extract_projects.py reads like any other: OUT/{src,manifest.json}. It has no gallery or check.log, so the upload loop
never publishes these excerpts over the full originals.

  page1_excerpts.py OUT        then: redact_signatures.py detect|verify|apply OUT/src OUT/redacted, touch OUT/stats.json
"""
import hashlib
import json
import os
import subprocess
import sys
from collections import defaultdict

import pymupdf
import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_mpb as c  # noqa: E402

LINKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "senate-redact", "cache", "file-links.jsonl")
KEEP = {"POW": 1, "BP 202": 3}


def main():
    out = sys.argv[1]
    links = {}
    for line in open(LINKS):
        r = json.loads(line)
        links[r["path"]] = r
    skipped = {}
    for slug in os.listdir(c.REDACTED):
        m = os.path.join(c.REDACTED, slug, "manifest.json")
        if os.path.exists(m) and slug != os.path.basename(out.rstrip("/")):
            for f in json.load(open(m))["files"]:
                if f["status"] != "kept" and "more than" in f.get("reason", ""):
                    for p in [f["path"]] + f.get("same_as", []):
                        skipped[p] = f["path"]
    want = {}
    for f in pq.read_table(os.path.join(c.DATA, "documents", "files.parquet")).to_pylist():
        if f["source"] == "senate" and f["doc_type"] in KEEP and f["path"] in skipped:
            want[skipped[f["path"]]] = f["doc_type"]
    files, bad = [], 0
    for path, doc_type in sorted(want.items()):
        r = links[path]
        orig = os.path.join(out, "orig", path)
        dst = os.path.join(out, "src", path)
        same = [p for p, canon in skipped.items() if canon == path and p != path]
        if not os.path.exists(dst):
            os.makedirs(os.path.dirname(orig), exist_ok=True)
            if not (os.path.exists(orig) and os.path.getsize(orig) == r.get("original_bytes", r["bytes"])):
                subprocess.run(["curl", "-sf", "--retry", "3", "-o", orig, r["url"]])
            sha = hashlib.sha256(open(orig, "rb").read()).hexdigest() if os.path.exists(orig) else None
            if sha != r.get("original_sha256", r["sha256"]):
                print(f"NOT ORIGINAL, skipped: {path}")
                bad += 1
                continue
            try:
                with pymupdf.open(orig) as doc:
                    ex = pymupdf.open()
                    ex.insert_pdf(doc, from_page=0, to_page=min(KEEP[doc_type], doc.page_count) - 1)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    ex.save(dst, garbage=2, deflate=True)
            except Exception as e:  # noqa: BLE001
                print(f"UNREADABLE, skipped: {path}: {e}")
                bad += 1
                continue
            os.remove(orig)
        with pymupdf.open(dst) as d:
            files.append({"path": path, "sha256": hashlib.sha256(open(dst, "rb").read()).hexdigest(),
                          "bytes": os.path.getsize(dst), "pages": d.page_count, "same_as": same,
                          "status": "kept", "excerpt_of": doc_type})
    json.dump({"region": "Excerpts of long BP 202 / POW (extraction only, never uploaded)", "max_pages": 3,
               "pdfs": len(want), "unique": len(want), "kept": len(files),
               "kept_pages": sum(f["pages"] for f in files), "skipped_pages": 0, "files": files},
              open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(f"{len(files)} excerpts ({sum(f['pages'] for f in files)} pages) in {out}/src; {bad} skipped")


if __name__ == "__main__":
    main()
