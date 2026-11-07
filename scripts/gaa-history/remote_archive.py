"""Inspect a ZIP directory and retrieve selected members using HTTP ranges.

zipfile verifies each extracted member's CRC. The full archive mirror remains
independent; selected-member provenance is recorded in a separate inventory.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

from download import session, save_json, digest
from extract import extract_text


class RemoteZip(io.RawIOBase):
    def __init__(self, url):
        self.url, self.position = url, 0
        with session().get(url, headers={"Range": "bytes=0-0"}, stream=True, timeout=60) as r:
            r.raise_for_status()
            if r.status_code != 206 or not r.headers.get("Content-Range", "").startswith("bytes 0-0/"):
                raise ValueError("Verified ranges unavailable")
            self.size = int(r.headers["Content-Range"].split("/")[-1])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        if whence not in (0, 1, 2):
            raise ValueError("Invalid seek mode")
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if self.position < 0:
            raise ValueError("Negative seek")
        return self.position

    def read(self, size=-1):
        size = min(self.size - self.position, size if size >= 0 else self.size - self.position)
        if size <= 0:
            return b""
        end = self.position + size - 1
        with session().get(self.url, headers={"Range": f"bytes={self.position}-{end}"}, timeout=(30, 180)) as r:
            r.raise_for_status()
            if r.status_code != 206 or r.headers.get("Content-Range") != f"bytes {self.position}-{end}/{self.size}":
                raise ValueError("Incorrect byte range")
            data = r.content
        if len(data) != size:
            raise ValueError("Incomplete byte range")
        self.position += size
        return data


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--url-contains", default="")
    p.add_argument("--member", action="append", default=[])
    a = p.parse_args()
    root = a.root.resolve()
    sources = [s for s in json.loads((root / "manifest.json").read_text())["files"]
               if s["year"] == a.year and s["path"].endswith(".zip") and a.url_contains.lower() in s["url"].lower()]
    docs = []
    for source in sources:
        with zipfile.ZipFile(RemoteZip(source["url"])) as archive:
            members = [dict(name=i.filename, size=i.file_size, compressed=i.compress_size, crc=i.CRC)
                       for i in archive.infolist()]
            save_json(root / "zip-index" / (Path(source["path"]).stem + ".json"), members)
            print(json.dumps(dict(url=source["url"], members=len(members), machine_files=[m for m in members
                if Path(m["name"]).suffix.lower() in (".csv", ".xls", ".xlsx", ".mdb", ".accdb")])), flush=True)
            for member in a.member:
                name = PurePosixPath(member)
                if name.is_absolute() or ".." in name.parts:
                    raise ValueError("Unsafe member path")
                info = archive.getinfo(member)
                if info.file_size > 1024 ** 3:
                    raise ValueError("Oversized member")
                target = root / "unpacked" / str(a.year) / Path(source["path"]).stem / Path(*name.parts)
                if not target.exists():
                    data = archive.read(member)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    temporary = target.with_suffix(target.suffix + ".part")
                    temporary.write_bytes(data)
                    temporary.replace(target)
                doc_id = hashlib.sha256((source["url"] + "#" + member).encode()).hexdigest()[:24]
                text, method = extract_text(target)
                text_path = root / "text" / str(a.year) / (doc_id + ".txt")
                if text is not None:
                    text_path.parent.mkdir(parents=True, exist_ok=True)
                    text_path.write_text(text)
                docs.append(dict(source, member=member, document_path=str(target.relative_to(root)),
                                 document_id=doc_id, document_sha256=digest(target),
                                 text_path=str(text_path.relative_to(root)) if text is not None else None,
                                 extraction=method, archive_member_crc=info.CRC,
                                 retrieval="verified_http_ranges_and_zip_crc"))
                print(f"Retrieved {member}: {target.stat().st_size} bytes", flush=True)
    if docs:
        destination = root / f"documents-{a.year}-remote.json"
        previous = json.loads(destination.read_text()) if destination.exists() else []
        merged = {d["document_id"]: d for d in previous + docs}
        save_json(destination, list(merged.values()))


if __name__ == "__main__":
    main()
