#!/usr/bin/env python3
"""Put a region's redacted PDFs over the originals on R2 (bucket `budget`, hgab/2027/dpwh/supporting-documents/<path>).

Jason (2026-11-14): overwrite the originals; he keeps a backup. Every key that held the same original file (the
manifest's `same_as`) gets the redacted copy too, or an identical duplicate would stay unredacted.

A key is written only when R2 still holds the original (its ETag is the file list's MD5) or a copy this script
uploaded before (listed in <region>/upload.json), so a re-run after the deferred sweep replaces the earlier upload,
and a key that changed upstream is reported, never touched. Already-current keys are skipped: re-runs are cheap.

  upload_redacted.py ROOT slug [slug …] [--dry-run] [--concurrency 16]
Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (~/projects/ai-reports/.env).
"""
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = "hgab/2027/dpwh/supporting-documents/"


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    conc = int(args[args.index("--concurrency") + 1]) if "--concurrency" in args else 16
    pos = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--concurrency")]
    root, slugs = pos[0], pos[1:]
    links = {}
    with open(os.path.join(HERE, "cache", "file-links.jsonl")) as fh:
        for line in fh:
            r = json.loads(line)
            links[r["path"]] = r
    s3 = boto3.client("s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                      aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto",
                      config=Config(retries={"max_attempts": 8, "mode": "adaptive"}, max_pool_connections=conc + 4))
    bucket = os.environ.get("R2_BUCKET", "budget")
    for slug in slugs:
        d = os.path.join(root, slug)
        check = open(os.path.join(d, "check.log")).read().strip().splitlines()[-1]
        if not check.endswith(" 0 problems"):
            print(f"{slug}: output check not clean ({check}); not uploading")
            continue
        manifest = json.load(open(os.path.join(d, "manifest.json")))
        log_path = os.path.join(d, "upload.json")
        log = json.load(open(log_path)) if os.path.exists(log_path) else {}
        jobs = []
        for f in manifest["files"]:
            if f["status"] != "kept":
                continue
            local = os.path.join(d, "redacted", f["path"])
            for path in [f["path"]] + f.get("same_as", []):
                jobs.append((path, local, f["sha256"]))
        lock = threading.Lock()
        counts = {"uploaded": 0, "current": 0, "conflict": 0, "missing_local": 0}
        conflicts = []
        hashes = {}

        def local_hashes(local):
            if local not in hashes:
                hashes[local] = (md5(local), sha256(local))
            return hashes[local]

        def one(job):
            path, local, orig_sha = job
            key = PREFIX + path
            if not os.path.exists(local):
                with lock:
                    counts["missing_local"] += 1
                return
            new_md5, new_sha = local_hashes(local)
            try:
                etag = s3.head_object(Bucket=bucket, Key=key)["ETag"].strip('"')
            except s3.exceptions.ClientError as e:
                etag = None if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound") else "?"
            original_md5 = (links.get(path) or {}).get("md5")
            earlier = (log.get(path) or {}).get("md5")
            if etag == new_md5:
                with lock:
                    counts["current"] += 1
                    log[path] = {"md5": new_md5, "sha256": new_sha, "original_sha256": orig_sha,
                                 "at": log.get(path, {}).get("at")}
                return
            if etag not in (original_md5, earlier):
                with lock:
                    counts["conflict"] += 1
                    conflicts.append((path, etag, original_md5))
                return
            if not dry:
                with open(local, "rb") as fh:
                    s3.put_object(Bucket=bucket, Key=key, Body=fh, ContentType="application/pdf",
                                  Metadata={"sha256": new_sha, "original-sha256": orig_sha,
                                            "redacted": "signatures and handwriting, bettergov.ph 2026-11"})
            with lock:
                counts["uploaded"] += 1
                if not dry:
                    log[path] = {"md5": new_md5, "sha256": new_sha, "original_sha256": orig_sha,
                                 "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

        t0 = time.time()
        list(ThreadPoolExecutor(conc).map(one, jobs))
        if not dry:
            with open(log_path, "w") as fh:
                json.dump(log, fh, indent=1)
        print(f"{manifest['region']}: {len(jobs)} keys{' (dry run)' if dry else ''}: {counts} | "
              f"wall {time.time() - t0:.0f}s", flush=True)
        for path, etag, orig in conflicts[:10]:
            print(f"  CONFLICT {path}: R2 ETag {etag}, original {orig}")


if __name__ == "__main__":
    main()
