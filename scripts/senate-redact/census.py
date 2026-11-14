#!/usr/bin/env python3
"""One region of the Senate copies, small PDFs only: download, count pages, keep what is at or under --max-pages.

Large documents are skipped for now to keep model costs down (cost follows pages, not bytes: in the trial a 0.6 MB
POW had 34 pages and a 12.8 MB one had 4). Identical files (same sha256) are downloaded and redacted once; the
manifest lists every path that shares them.

  census.py REGION OUT [--max-pages 19] [--links supporting-documents-file-links.jsonl] [--concurrency 8]

  OUT/src/<path>        the kept PDFs (originals; redact_signatures.py reads SRC = OUT/src)
  OUT/manifest.json     every PDF of the region: path, sha256, bytes, pages, kept | skipped reason, same_as
  `census.py --regions` lists region names with PDF counts.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import pymupdf

LINKS_URL = "https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents-file-links.jsonl"
HERE = os.path.dirname(os.path.abspath(__file__))


def opt(args, name, default):
    return args[args.index(name) + 1] if name in args else default


def load_links(path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # budget-assets refuses urllib's default user agent; curl gets through
        subprocess.run(["curl", "-sf", "-o", path, LINKS_URL], check=True)
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def main():
    args = sys.argv[1:]
    links = load_links(opt(args, "--links", os.path.join(HERE, "cache", "file-links.jsonl")))
    pdfs = [r for r in links if r["path"].lower().endswith(".pdf")]
    if "--regions" in args:
        counts = defaultdict(int)
        for r in pdfs:
            counts[r["region"]] += 1
        for k, v in sorted(counts.items(), key=lambda kv: kv[1]):
            print(f"{v:6d}  {k}")
        return
    region, out = args[0], args[1]
    max_pages = int(opt(args, "--max-pages", "19"))
    conc = int(opt(args, "--concurrency", "8"))
    rows = [r for r in pdfs if r["region"] == region]
    if not rows:
        sys.exit(f"no PDFs for region {region!r}; see --regions")
    by_sha = defaultdict(list)
    for r in sorted(rows, key=lambda r: r["path"]):
        by_sha[r["sha256"]].append(r)

    def one(group):
        r = group[0]
        dst = os.path.join(out, "src", r["path"])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        entry = {"path": r["path"], "sha256": r["sha256"], "bytes": r["bytes"],
                 "same_as": [g["path"] for g in group[1:]]}
        if not (os.path.exists(dst) and os.path.getsize(dst) == r["bytes"]):
            res = subprocess.run(["curl", "-sf", "--retry", "3", "-o", dst, r["url"]])
            if res.returncode or not os.path.exists(dst):
                return {**entry, "status": "skipped", "reason": f"download failed ({res.returncode})"}
        try:
            with pymupdf.open(dst) as doc:
                entry["pages"] = doc.page_count
                for pg in doc:  # every page must load: a broken page tree crashed detection in CAR
                    pg.get_image_info()
                locked = doc.needs_pass
        except Exception as e:  # noqa: BLE001
            os.remove(dst)
            return {**entry, "status": "skipped", "reason": f"unreadable: {e}"}
        if locked:
            os.remove(dst)
            return {**entry, "status": "skipped", "reason": "password-protected"}
        if entry["pages"] == 0:
            os.remove(dst)
            return {**entry, "status": "skipped", "reason": "damaged: no readable pages"}
        if entry["pages"] > max_pages:
            os.remove(dst)
            return {**entry, "status": "skipped", "reason": f"more than {max_pages} pages"}
        return {**entry, "status": "kept"}

    t0 = time.time()
    files = list(ThreadPoolExecutor(conc).map(one, by_sha.values()))
    kept = [f for f in files if f["status"] == "kept"]
    manifest = {"region": region, "max_pages": max_pages, "made": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "pdfs": len(rows), "unique": len(files), "kept": len(kept),
                "kept_pages": sum(f["pages"] for f in kept),
                "skipped_pages": sum(f.get("pages", 0) for f in files if f["status"] != "kept"),
                "files": files}
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    reasons = defaultdict(int)
    for f in files:
        if f["status"] != "kept":
            reasons[f["reason"]] += 1
    print(f"{region}: {len(rows)} PDFs, {len(files)} unique; kept {len(kept)} ({manifest['kept_pages']} pages), "
          f"skipped {dict(reasons)} ({manifest['skipped_pages']} pages) | wall {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
