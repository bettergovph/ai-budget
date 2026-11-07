"""OCR scanned PDF sources locally, preserving native extraction and page evidence."""
import argparse
import concurrent.futures
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from download import save_json


def ocr(root, doc):
    doc = dict(doc)
    output = root / "ocr" / str(doc["year"]) / (doc["document_id"] + ".txt")
    output.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, OMP_THREAD_LIMIT="1")
    try:
        if not output.exists():
            pdf = root / doc["document_path"]
            info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True)
            pages = int(re.search(r"^Pages:\s*(\d+)", info.stdout, re.M)[1])
            texts = []
            with tempfile.TemporaryDirectory(prefix="render-", dir=output.parent) as tmpdir:
                tmp = Path(tmpdir)
                for start in range(1, pages + 1, 10):
                    subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", "-f", str(start),
                                    "-l", str(min(start + 9, pages)), str(pdf), str(tmp / "page")],
                                   capture_output=True, timeout=300, check=True)
                    for image in sorted(tmp.glob("page-*.png")):
                        pageno = int(image.stem.split("-")[-1])
                        base = tmp / "recognized"
                        subprocess.run(["tesseract", str(image), str(base), "--psm", "6",
                                        "-c", "preserve_interword_spaces=1", "txt", "tsv"],
                                       env=env, capture_output=True, timeout=180, check=True)
                        texts.append(base.with_suffix(".txt").read_text())
                        evidence = output.parent / f"{doc['document_id']}-page-{pageno}.tsv.gz"
                        with gzip.open(evidence, "wb") as f:
                            f.write(base.with_suffix(".tsv").read_bytes())
                        image.unlink()
            temporary = output.with_suffix(".tmp")
            temporary.write_text("\f".join(texts))
            temporary.replace(output)
        doc.update(native_text_path=doc.get("native_text_path", doc.get("text_path")),
                   text_path=str(output.relative_to(root)), extraction="pdf_ocr_tesseract",
                   ocr_dpi=300, ocr_psm=6, ocr_evidence="per-page TSV word boxes and confidence")
        doc.pop("ocr_error", None)
    except Exception as e:
        doc["ocr_error"] = str(e)
    return doc


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--limit", type=int)
    p.add_argument("--inventory", type=Path)
    a = p.parse_args()
    root = a.root.resolve()
    inventory = a.inventory or root / f"documents-{a.year}.json"
    docs = json.loads(inventory.read_text())
    selected = []
    for i, doc in enumerate(docs):
        if not doc["document_path"].lower().endswith(".pdf") or doc.get("ocr_error"):
            continue
        if "annex" in doc["url"].lower() or "/details/" in doc["url"].lower():
            continue
        native = root / (doc.get("native_text_path") or doc.get("text_path") or "missing")
        if not native.is_file():
            continue
        text = native.read_text()
        if len(re.findall(r"\b\d{1,3}(?:,\d{3})+\b", text)) >= 3:
            continue
        selected.append(i)
    if a.limit:
        selected = selected[:a.limit]
    # Separate inventory prevents an ongoing downloader/extractor from erasing
    # OCR progress. Parsers can opt into this reviewed evidence explicitly.
    destination = root / f"documents-{a.year}-ocr.json"
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        tasks = {pool.submit(ocr, root, docs[i]): i for i in selected}
        for done, task in enumerate(concurrent.futures.as_completed(tasks), 1):
            i = tasks[task]
            docs[i] = task.result()
            if done % 5 == 0 or "ocr_error" in docs[i] or done == len(selected):
                save_json(destination, docs)
                print(f"OCR {done}/{len(selected)} {docs[i]['document_path']} {docs[i].get('ocr_error', 'ok')}", flush=True)
    save_json(destination, docs)


if __name__ == "__main__":
    main()
