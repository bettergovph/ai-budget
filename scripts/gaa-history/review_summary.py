"""Apply explicit, source-anchored visual-review corrections to OCR outputs."""
import hashlib
import json
from pathlib import Path
import re

from download import save_json


def main():
    root = Path("data/gaa-history").resolve()
    corrections = json.loads(Path(__file__).with_name("summary-corrections.json").read_text())
    reviewed_pages = {}
    for correction in corrections:
        year, did, page = correction["year"], correction["document_id"], correction["page"]
        doc = next(d for d in json.loads((root / f"documents-{year}.json").read_text()) if d["document_id"] == did)
        if doc["document_sha256"] != correction["source_sha256"]:
            raise ValueError("Source changed since visual review")
        directory = root / "vision-summary" / str(year) / did
        response = json.loads((directory / f"page-{page}-response.json").read_text())
        if response["finish_reason"] != "stop":
            raise ValueError("Cannot correct an incomplete transcription")
        text = response["content"].rsplit("</think>", 1)[-1]
        key = (year, did, page)
        transcription, applied = reviewed_pages.setdefault(key, (json.loads(re.search(r"\{.*\}", text, re.S)[0]), []))
        if transcription["rows"][correction["row"]] != correction["expected"]:
            raise ValueError("Transcription differs from reviewed row")
        transcription["rows"][correction["row"]] = correction["replacement"]
        applied.append(correction)
        save_json(directory / f"page-{page}.json", dict(document_id=did, source_url=doc["url"],
            source_member=doc["member"], source_sha256=doc["document_sha256"], page=page,
            model=response["model"], image_sha256=hashlib.sha256((directory / f"page-{page}.png").read_bytes()).hexdigest(),
            status="transcription_pending_full_review", transcription=transcription,
            corrections=applied))
    # Recover complete responses previously rejected only because an unnumbered
    # total has a null code. Missing names or malformed amounts still fail.
    for response_path in (root / "vision-summary").glob("*/*/page-*-response.json"):
        page = int(re.search(r"page-(\d+)", response_path.name)[1])
        output = response_path.parent / f"page-{page}.json"
        if output.exists():
            continue
        response = json.loads(response_path.read_text())
        if response["finish_reason"] != "stop":
            continue
        text = response["content"].rsplit("</think>", 1)[-1]
        try:
            transcription = json.loads(re.search(r"\{.*\}", text, re.S)[0])
            structural = []
            for ordinal, row in enumerate(transcription["rows"]):
                before = dict(row)
                code = row.get("code") or ""
                if not row.get("name") and isinstance(code, str) and code and not re.fullmatch(
                        r"(?:[IVXLCDM]+|[A-Z]{1,2})(?:\.\d+)*\.?", code):
                    row.update(name=code, code="")
                if row.get("amount") == "":
                    row["amount"] = None
                if row != before:
                    structural.append(dict(row=ordinal, before=before, after=dict(row),
                        reason="Preserve the printed label in name; normalize empty cells to null. No numeric changes."))
            if not all(isinstance(row.get("name"), str) and row["name"].strip() and
                       (row.get("amount") is None or re.fullmatch(r"[\d,]+", str(row["amount"])))
                       for row in transcription["rows"]):
                continue
        except (ValueError, TypeError, KeyError):
            continue
        year, did = int(response_path.parent.parent.name), response_path.parent.name
        doc = next(d for d in json.loads((root / f"documents-{year}.json").read_text()) if d["document_id"] == did)
        save_json(output, dict(document_id=did, source_url=doc["url"], source_member=doc["member"],
            source_sha256=doc["document_sha256"], page=page, model=response["model"],
            image_sha256=hashlib.sha256((response_path.parent / f"page-{page}.png").read_bytes()).hexdigest(),
            status="transcription_pending_review", transcription=transcription, structural_normalizations=structural))


if __name__ == "__main__":
    main()
