"""Mirror the DBM GAA archive with checksums and resumable, atomic downloads.

Only links inside the selected GAA article are followed. Archive members are
inventoried separately by extract.py; downloads never execute archive content.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import time
import threading
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qsl, urlencode, unquote

from bs4 import BeautifulSoup
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ARCHIVE = "https://www.dbm.gov.ph/index.php/budget-documents-archives"
REENACTED = {2001: 2000, 2004: 2003, 2006: 2005}
EVIDENCE = "https://www.foi.gov.ph/requests/gaa-for-1987-2006/"
LOCAL = threading.local()


def session():
    if hasattr(LOCAL, "session"):
        return LOCAL.session
    s = requests.Session()
    s.headers["User-Agent"] = "BetterGov GAA historical research (public archive download)"
    s.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504])))
    LOCAL.session = s
    return s


def canonical(url):
    p = urlsplit(url)
    return urlunsplit(("https", p.netloc.lower(), p.path,
                      urlencode(sorted(parse_qsl(p.query))), ""))


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def discover(root, first, last):
    s = session()
    r = s.get(ARCHIVE, timeout=90)
    r.raise_for_status()
    (root / "pages").mkdir(parents=True, exist_ok=True)
    (root / "pages/archive.html").write_bytes(r.content)
    panel = BeautifulSoup(r.content, "html.parser").select_one("#rlta-panel-gaa")
    if panel is None:
        raise RuntimeError("GAA panel not found; refusing to crawl unrelated budget documents")
    pending = []
    for a in panel.select("a[href]"):
        label = a.find_parent("li").get_text(" ", strip=True)
        m = re.search(r"\b(20\d{2})\b", label)
        if m and first <= int(m[1]) <= last:
            pending.append((int(m[1]), canonical(urljoin(ARCHIVE, a["href"])), label, ARCHIVE))
    seen, files, pages, errors = set(), {}, [], []
    while pending:
        year, url, label, parent = pending.pop(0)
        key = (year, url)
        if key in seen:
            continue
        seen.add(key)
        p = urlsplit(url)
        if p.hostname not in ("www.dbm.gov.ph", "dbm.gov.ph"):
            errors.append(dict(year=year, url=url, error="external link requires review"))
            continue
        ext = Path(unquote(p.path)).suffix.lower()
        if ext in (".pdf", ".zip", ".rar", ".xlsx", ".xls", ".csv", ".doc", ".docx"):
            name = re.sub(r"[^\w.()-]+", "_", Path(unquote(p.path)).name)
            rel = f"sources/{year}/{hashlib.sha256(url.encode()).hexdigest()[:12]}-{name}"
            files[key] = dict(year=year, url=url, label=label, parent_url=parent, path=rel)
            continue
        try:
            response = s.get(url, timeout=90)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")
            body = soup.select_one(".com-content-article__body")
            if body is None:
                raise ValueError("article body missing")
            html_path = f"pages/{year}-{hashlib.sha256(url.encode()).hexdigest()[:12]}.html"
            (root / html_path).write_bytes(response.content)
            pages.append(dict(year=year, url=url, label=label, path=html_path))
            for a in body.select("a[href]"):
                href = a["href"].strip()
                if not href or href.startswith(("#", "javascript:", "mailto:")):
                    continue
                child = canonical(urljoin(url, href))
                # Exclude article navigation back to the full archive.
                if child == canonical(ARCHIVE):
                    continue
                pending.append((year, child, a.get_text(" ", strip=True), url))
            print(f"discovered {year}: {label}; {len(files)} files so far", flush=True)
        except Exception as e:
            errors.append(dict(year=year, url=url, error=str(e)))
    manifest = dict(archive=ARCHIVE, start_year=first, end_year=last,
                    reenacted_years={str(y): dict(source_year=base, evidence=EVIDENCE)
                                     for y, base in REENACTED.items() if first <= y <= last},
                    pages=pages, discovery_errors=errors,
                    files=sorted(files.values(), key=lambda x: (x["year"], x["url"])))
    save_json(root / "manifest.json", manifest)
    return manifest


def download(root, item):
    item = dict(item)
    p = root / item["path"]
    try:
        if p.exists():
            checksum = digest(p)
            if item.get("sha256") == checksum:
                return item
            # A previous process can finish an atomic rename before its batched
            # manifest checkpoint. Only reuse this known, signature-checked file.
            if not item.get("sha256"):
                with p.open("rb") as f:
                    magic = f.read(8)
                if magic.startswith((b"%PDF", b"PK", b"Rar!", bytes.fromhex("d0cf11e0a1b11ae1"))):
                    item.update(status="downloaded", sha256=checksum, bytes=p.stat().st_size,
                                recovered_after_checkpoint=True)
                    return item
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        offset = tmp.stat().st_size if tmp.exists() else 0
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        with session().get(item["url"], timeout=(30, 180), stream=True, headers=headers) as r:
            r.raise_for_status()
            append = offset > 0 and r.status_code == 206
            if append and not r.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                raise ValueError("Server returned incorrect resume range")
            with tmp.open("ab" if append else "wb") as out:
                for chunk in r.iter_content(1024 * 1024):
                    out.write(chunk)
            with tmp.open("rb") as f:
                magic = f.read(16)
            suffix = p.suffix.lower()
            valid = ((suffix == ".pdf" and magic.startswith(b"%PDF")) or
                     (suffix in (".zip", ".xlsx", ".docx", ".xls", ".doc") and magic.startswith(b"PK")) or
                     (suffix == ".rar" and magic.startswith(b"Rar!")) or
                     (suffix in (".xls", ".doc") and magic.startswith(bytes.fromhex("d0cf11e0a1b11ae1"))) or
                     (suffix == ".csv" and b"<html" not in magic.lower()))
            if not valid:
                raise ValueError(f"Unexpected file signature {magic.hex()}")
            item.update(status="downloaded", bytes=tmp.stat().st_size,
                        sha256=digest(tmp), final_url=r.url,
                        content_type=r.headers.get("Content-Type"), retrieved_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        tmp.replace(p)
        item.pop("error", None)
    except Exception as e:
        item.update(status="error", error=str(e))
    return item


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    parser.add_argument("--start", type=int, default=2000)
    parser.add_argument("--end", type=int, default=2019)
    parser.add_argument("--rediscover", action="store_true")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--exclude-years", type=int, nargs="*", default=[])
    args = parser.parse_args()
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    mpath = root / "manifest.json"
    manifest = (json.loads(mpath.read_text()) if mpath.exists() and not args.rediscover
                else discover(root, args.start, args.end))
    files = manifest["files"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(download, root, item): i for i, item in enumerate(files)
                   if item["year"] not in args.exclude_years}
        for n, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            i = futures[fut]
            files[i] = fut.result()
            if n % 10 == 0 or files[i].get("status") == "error" or n == len(files):
                save_json(mpath, manifest)
                print(f"{n}/{len(files)}: {files[i]['year']} {files[i]['status']} {files[i]['path']}", flush=True)
    save_json(mpath, manifest)
    failed = [x for x in files if x.get("status") != "downloaded"]
    print(json.dumps(dict(files=len(files), failed=len(failed),
                         bytes=sum(x.get("bytes", 0) for x in files)), indent=2))
    if failed or manifest["discovery_errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
