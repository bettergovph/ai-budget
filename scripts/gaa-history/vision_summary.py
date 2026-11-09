"""Transcribe a bounded scanned summary; outputs require independent reconciliation.

Public DBM pages only. Credentials are read from the BetterGov environment and
never persisted. Source images, prompt, model response and usage are retained.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess

import requests

from download import save_json

PROMPT = """Transcribe every budget row in this scanned government summary, in its exact printed order. The unit is already known from the first page: thousand pesos. No unit interpretation is needed.
Return ONLY valid JSON: {"rows":[{"code":"printed Roman numeral or agency letter/number, or empty", "name":"exact printed label with wrapped lines joined", "amount":"digits and commas exactly as printed, or null when blank"}]}.
Include departmental totals, agency rows, overall total, and annex amounts. Omit page headers, dates, rulings, footers and table titles. Do not fill missing amounts or calculate anything. Do not infer parent departments or silently correct the source. Keep names faithful. Read every digit carefully. If a numeric cell is illegible, use null and append a note field explaining it. A blank numeric cell must remain null, not zero."""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--document-id", required=True)
    p.add_argument("--pages", type=int, nargs="+", required=True)
    p.add_argument("--model", default="minicpm-v-4.5")
    p.add_argument("--workers", type=int, default=2)
    a = p.parse_args()
    root = a.root.resolve()
    doc = next(d for d in json.loads((root / f"documents-{a.year}.json").read_text())
               if d["document_id"] == a.document_id)
    values = {}
    for line in (Path.home() / ".bettergov/.env").read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() in ("NYOLAB_API_KEY", "NYOLAB_API_ENDPOINT"):
            values[key.strip()] = value.strip().strip("\"'")
    destination = root / "vision-summary" / str(a.year) / a.document_id
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "prompt.txt").write_text(PROMPT)

    def transcribe(page):
        output = destination / f"page-{page}.json"
        if output.exists():
            return page, "cached"
        image = destination / f"page-{page}.png"
        if not image.exists():
            subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-scale-to", "2600", "-png",
                            "-singlefile", str(root / doc["document_path"]), str(image.with_suffix(""))],
                           check=True, capture_output=True, timeout=60)
        payload = dict(model=a.model, messages=[dict(role="user", content=[dict(type="text", text=PROMPT),
            dict(type="image_url", image_url=dict(url="data:image/png;base64," + base64.b64encode(image.read_bytes()).decode()))])],
            max_tokens=7000, temperature=0, chat_template_kwargs={"enable_thinking": False})
        response = requests.post(values["NYOLAB_API_ENDPOINT"].rstrip("/") + "/chat/completions",
            headers={"Authorization": "Bearer " + values["NYOLAB_API_KEY"]}, json=payload, timeout=180)
        if not response.ok:
            raise RuntimeError(f"Transcription HTTP {response.status_code}; response omitted to protect credentials")
        result = response.json()
        text = result["choices"][0]["message"]["content"]
        response_path = destination / f"page-{page}-response.json"
        if response_path.exists():
            old = response_path.read_bytes()
            (destination / f"page-{page}-response-{hashlib.sha256(old).hexdigest()[:8]}.json").write_bytes(old)
        save_json(response_path, dict(model=a.model, content=text,
                   usage=result.get("usage"), finish_reason=result["choices"][0].get("finish_reason")))
        if result["choices"][0].get("finish_reason") == "length":
            raise ValueError("Truncated model response")
        text = text.rsplit("</think>", 1)[-1]
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise ValueError("Model did not return JSON")
        transcription = json.loads(match.group())
        if not isinstance(transcription.get("rows"), list):
            raise ValueError("Missing rows")
        for row in transcription["rows"]:
            if not isinstance(row.get("name"), str) or not row["name"].strip() or (row.get("code") is not None and not isinstance(row["code"], str)):
                raise ValueError("Missing printed row label")
            if row.get("amount") is not None and not re.fullmatch(r"[\d,]+", str(row["amount"])):
                raise ValueError("Unexpected amount format")
        save_json(output, dict(document_id=a.document_id, source_url=doc["url"], source_member=doc["member"],
             source_sha256=doc["document_sha256"], page=page, model=a.model,
             image_sha256=hashlib.sha256(image.read_bytes()).hexdigest(), status="transcription_pending_review",
             transcription=transcription))
        return page, f"{len(transcription['rows'])} rows transcribed"

    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        futures = [pool.submit(transcribe, page) for page in a.pages]
        for task in concurrent.futures.as_completed(futures):
            print(task.result(), flush=True)


if __name__ == "__main__":
    main()
