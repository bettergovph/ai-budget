"""Fetch analysis inputs ahead of large alternate volumes in the full mirror.

Writes its own journal, never overwriting the full mirror's manifest. The mirror
recognizes completed atomic files when it reaches them. Use only for years the
full mirror has not reached yet, to avoid concurrent writes to the same .part.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path

from download import download, save_json


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--workers", type=int, default=4)
    a = p.parse_args()
    root = a.root.resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    items = [x for x in manifest["files"] if x["year"] == a.year and
             (Path(x["path"]).suffix.lower() in (".xls", ".xlsx", ".csv") or
              ("tech" in x["url"].lower() and x["url"].lower().endswith(".pdf")))]
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        tasks = [pool.submit(download, root, item) for item in items]
        for task in concurrent.futures.as_completed(tasks):
            results.append(task.result())
            if len(results) % 10 == 0 or results[-1].get("status") == "error":
                save_json(root / f"priority-{a.year}.json", results)
                print(f"{len(results)}/{len(items)} {results[-1]['status']} {results[-1]['path']}", flush=True)
    save_json(root / f"priority-{a.year}.json", results)


if __name__ == "__main__":
    main()
