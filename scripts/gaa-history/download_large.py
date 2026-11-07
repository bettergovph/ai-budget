"""Resume a large official ZIP with bounded, verified HTTP byte ranges.

Run the main mirror with --exclude-years for this year to avoid concurrent
writers. This writes a separate journal; the mirror imports the final file on
its next run. Existing .part bytes are retained as the first contiguous range.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import shutil
import zipfile

from download import digest, save_json, session


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--workers", type=int, default=4)
    a = p.parse_args()
    root = a.root.resolve()
    files = [x for x in json.loads((root / "manifest.json").read_text())["files"]
             if x["year"] == a.year and x["path"].lower().endswith(".zip")]
    for item in files:
        target = root / item["path"]
        if target.exists():
            continue
        with session().get(item["url"], headers={"Range": "bytes=0-0"}, stream=True, timeout=60) as r:
            r.raise_for_status()
            if r.status_code != 206 or not r.headers.get("Content-Range", "").startswith("bytes 0-0/"):
                raise ValueError("Server does not support verified byte ranges")
            size = int(r.headers["Content-Range"].split("/")[-1])
        prefix = target.with_suffix(target.suffix + ".part")
        prefix_size = prefix.stat().st_size if prefix.exists() else 0
        if prefix_size > size:
            raise ValueError("Partial file larger than remote object")
        directory = target.with_suffix(target.suffix + ".ranges")
        directory.mkdir(exist_ok=True)
        plan = directory / "plan.json"
        if plan.exists():
            old = json.loads(plan.read_text())
            if old != dict(size=size, prefix_size=prefix_size, url=item["url"]):
                raise ValueError("Source or prefix changed since range plan")
        else:
            save_json(plan, dict(size=size, prefix_size=prefix_size, url=item["url"]))
        chunk = 16 * 1024 * 1024
        ranges = [(start, min(start + chunk, size) - 1) for start in range(prefix_size, size, chunk)]

        def fetch(bounds):
            start, end = bounds
            output = directory / f"{start}-{end}.bin"
            expected = end - start + 1
            if output.exists() and output.stat().st_size == expected:
                return output
            temp = output.with_suffix(".part")
            offset = temp.stat().st_size if temp.exists() else 0
            begin = start + offset
            with session().get(item["url"], headers={"Range": f"bytes={begin}-{end}"},
                               stream=True, timeout=(30, 120)) as r:
                r.raise_for_status()
                if r.status_code != 206 or r.headers.get("Content-Range") != f"bytes {begin}-{end}/{size}":
                    raise ValueError("Incorrect range response")
                with temp.open("ab") as out:
                    for block in r.iter_content(1024 * 1024):
                        out.write(block)
            if temp.stat().st_size != expected:
                raise ValueError("Incomplete range")
            temp.replace(output)
            return output

        print(f"FY{a.year}: {size} bytes; {prefix_size} already downloaded; {len(ranges)} ranges", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
            futures = [pool.submit(fetch, bounds) for bounds in ranges]
            for n, task in enumerate(concurrent.futures.as_completed(futures), 1):
                task.result()
                print(f"FY{a.year}: range {n}/{len(ranges)} complete", flush=True)
        assembled = target.with_suffix(target.suffix + ".assembled")
        with assembled.open("wb") as out:
            if prefix.exists():
                with prefix.open("rb") as inp:
                    shutil.copyfileobj(inp, out)
            for start, end in ranges:
                with (directory / f"{start}-{end}.bin").open("rb") as inp:
                    shutil.copyfileobj(inp, out)
        if assembled.stat().st_size != size:
            raise ValueError("Assembled length mismatch")
        with zipfile.ZipFile(assembled) as archive:
            bad = archive.testzip()
            if bad:
                raise ValueError(f"ZIP CRC mismatch: {bad}")
        assembled.replace(target)
        item.update(status="downloaded", bytes=size, sha256=digest(target), range_download=True)
        save_json(root / f"large-download-{a.year}.json", item)
        print(f"FY{a.year}: completed and ZIP CRC checked", flush=True)


if __name__ == "__main__":
    main()
