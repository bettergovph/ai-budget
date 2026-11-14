#!/usr/bin/env python3
"""Bring R2's `hgab/2027/dpwh/supporting-documents-file-links.jsonl` in line with the redacted uploads (Jason, 2026-11-14).

For every path in a region's upload.json: `bytes`, `sha256`, `md5` become the redacted file's, `redacted: true` is added
and the original's values are kept as `original_bytes`, `original_sha256`, `original_md5`. Other rows are untouched,
row order is kept. Re-runnable: rows already marked keep their original_* values.

  update_links_jsonl.py ROOT [--dry-run]       then purge the file's URL from the CDN
Env: R2_* (~/projects/ai-reports/.env).
"""
import io
import json
import os
import sys

import boto3

KEY = "hgab/2027/dpwh/supporting-documents-file-links.jsonl"


def main():
    root = sys.argv[1]
    dry = "--dry-run" in sys.argv
    s3 = boto3.client("s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                      aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
    bucket = os.environ.get("R2_BUCKET", "budget")
    obj = s3.get_object(Bucket=bucket, Key=KEY)
    raw = obj["Body"].read().decode()
    uploaded, local_of = {}, {}
    for slug in sorted(os.listdir(root)):
        up = os.path.join(root, slug, "upload.json")
        if not os.path.exists(up):
            continue
        m = json.load(open(os.path.join(root, slug, "manifest.json")))
        for f in m["files"]:
            for path in [f["path"]] + f.get("same_as", []):
                local_of[path] = os.path.join(root, slug, "redacted", f["path"])
        for path, e in json.load(open(up)).items():
            uploaded[path] = e
    rows, changed = [], 0
    for line in raw.splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        e = uploaded.get(r["path"])
        if e and e.get("md5"):
            if not r.get("redacted"):
                r["original_bytes"], r["original_sha256"], r["original_md5"] = r["bytes"], r["sha256"], r["md5"]
            new = {"bytes": os.path.getsize(local_of[r["path"]]), "sha256": e["sha256"], "md5": e["md5"]}
            if any(r.get(k) != v for k, v in new.items()) or not r.get("redacted"):
                changed += 1
            r.update(new)
            r["redacted"] = True
        rows.append(r)
    body = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    print(f"{len(rows)} rows, {sum(1 for r in rows if r.get('redacted'))} marked redacted, {changed} changed now"
          f"{' (dry run)' if dry else ''}")
    if not dry:
        backup = os.path.join(root, "file-links.before-" + obj["ETag"].strip('"')[:8] + ".jsonl")
        if not os.path.exists(backup):
            open(backup, "w").write(raw)
        s3.put_object(Bucket=bucket, Key=KEY, Body=body.encode(), ContentType=obj.get("ContentType") or "application/x-ndjson")
        print(f"uploaded; previous version saved to {backup}")


if __name__ == "__main__":
    main()
