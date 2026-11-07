"""Safely unpack sources and preserve page/line evidence, without interpreting amounts."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import re

from bs4 import BeautifulSoup, NavigableString, Tag
from urllib.parse import urlsplit, unquote
import libarchive
from download import digest, save_json


def unpack(root, source):
    archive = root / source["path"]
    if archive.suffix.lower() not in (".rar", ".zip"):
        return [dict(source, member=None, document_path=source["path"])]
    target = root / "unpacked" / str(source["year"]) / archive.stem
    documents = []
    with libarchive.file_reader(str(archive)) as entries:
        for entry in entries:
            name = PurePosixPath(entry.pathname.replace("\\", "/"))
            if name.is_absolute() or ".." in name.parts or entry.issym or entry.islnk:
                raise ValueError(f"Unsafe archive member: {entry.pathname}")
            if not entry.isfile:
                continue
            if entry.size > 1024**3:
                raise ValueError(f"Oversized archive member: {entry.pathname}")
            path = target.joinpath(*name.parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists() or path.stat().st_size != entry.size:
                tmp = path.with_suffix(path.suffix + ".part")
                with tmp.open("wb") as f:
                    for chunk in entry.get_blocks():
                        f.write(chunk)
                tmp.replace(path)
            documents.append(dict(source, member=str(name), document_path=str(path.relative_to(root))))
    return documents


def extract_text(path):
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        r = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
                           capture_output=True, timeout=300)
        if r.returncode:
            raise ValueError(r.stderr.decode(errors="replace")[:500])
        return r.stdout.decode("utf-8"), "pdf_layout"
    if suffix in (".html", ".htm"):
        soup = BeautifulSoup(path.read_bytes(), "html.parser")
        for e in soup.select("script,style"):
            e.decompose()
        pres = soup.find_all("pre")
        if pres:
            text, method = "\n".join(p.get_text() for p in pres), "html_pre"
        elif soup.find("table"):
            rows = []
            for tr in soup.select("tr"):
                cells = [re.sub(r"\s+", " ", td.get_text(" ")).strip()
                         for td in tr.find_all(["td", "th"], recursive=False)]
                if any(cells):
                    rows.append("    ".join(cells).rstrip())
            text, method = "\n".join(rows), "html_table_rows"
        else:
            text, method = soup.get_text("\n"), "html_text"
        return text.replace("\r\n", "\n").replace("\r", "\n"), method
    if suffix == ".txt":
        return path.read_text(errors="replace"), "text"
    return None, "unsupported"


def annotate_scopes(root, docs):
    # FY2003's published index separates FIRST and SECOND PREFERENCE budgets.
    # These are distinct source scopes, not alternate versions or automatic
    # appropriations. Preserve the index's classification verbatim.
    indexes = [d for d in docs if d["year"] == 2003 and
               (d.get("member") or "").lower().endswith("/gaa_2003.htm")]
    links = {}
    for index in indexes:
        path = root / index["document_path"]
        scope = None
        soup = BeautifulSoup(path.read_bytes(), "html.parser")
        for node in soup.descendants:
            if isinstance(node, NavigableString):
                label = " ".join(str(node).split()).upper()
                # The DBM index misspells the second heading as "PREFRENCE".
                if label in ("FIRST PREFERENCE", "SECOND PREFERENCE", "SECOND PREFRENCE"):
                    scope = label.replace("PREFRENCE", "PREFERENCE").lower().replace(" ", "_")
            elif isinstance(node, Tag) and node.name == "a" and node.get("href") and scope:
                href = urlsplit(node["href"])
                if href.scheme or href.netloc or not href.path:
                    continue
                dest = (path.parent / unquote(href.path).replace("\\", "/")).resolve()
                links.setdefault(str(dest).lower(), set()).add(scope)
    for doc in docs:
        if doc["year"] == 2003:
            scopes = sorted(links.get(str((root / doc["document_path"]).resolve()).lower(), set()))
            doc["index_scopes"] = scopes
            doc["budget_scope"] = ("current_new_appropriations_" + scopes[0] if len(scopes) == 1
                                   else "unclassified_2003_source")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int)
    p.add_argument("--force-text", action="store_true")
    p.add_argument("--only-contains", help="Extract matching source URLs, merging into the existing inventory")
    a = p.parse_args()
    root = a.root.resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    docs = []
    for source in manifest["files"]:
        if a.year and source["year"] != a.year:
            continue
        if a.only_contains and a.only_contains.lower() not in source["url"].lower():
            continue
        # Downloader only renames a .part file after signature verification.
        # Permit extraction while the batched download manifest catches up.
        if source.get("status") != "downloaded" and not (root / source["path"]).is_file():
            continue
        docs.extend(unpack(root, source))
    counts = {}
    for i, doc in enumerate(docs, 1):
        path = root / doc["document_path"]
        doc["document_sha256"] = digest(path)
        doc_id = hashlib.sha256((doc["url"] + "#" + (doc["member"] or "")).encode()).hexdigest()[:24]
        doc["document_id"] = doc_id
        textpath = root / "text" / str(doc["year"]) / f"{doc_id}.txt"
        try:
            if textpath.exists() and not a.force_text:
                text = textpath.read_text()
                method = "pdf_layout" if path.suffix.lower() == ".pdf" else "html_pre_or_text"
            else:
                text, method = extract_text(path)
                if text is not None:
                    textpath.parent.mkdir(parents=True, exist_ok=True)
                    textpath.write_text(text)
            doc.update(text_path=str(textpath.relative_to(root)) if text is not None else None,
                       extraction=method, text_characters=len(text or ""),
                       page_count=max(1, len(text.rstrip("\f").split("\f"))) if text else 0)
            if text is not None and len(text.strip()) < 100:
                doc["extraction"] = "needs_ocr_or_empty"
        except Exception as e:
            doc.update(extraction="error", extraction_error=str(e))
        counts[doc["year"]] = counts.get(doc["year"], 0) + 1
        if i % 100 == 0:
            print(f"extracted {i}/{len(docs)}", flush=True)
    annotate_scopes(root, docs)
    inventory = root / (f"documents-{a.year}.json" if a.year else "documents.json")
    if a.only_contains and inventory.exists():
        old = json.loads(inventory.read_text())
        docs = list({d["document_id"]: d for d in old + docs}.values())
    save_json(inventory, docs)
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
