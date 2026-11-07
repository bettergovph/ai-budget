"""Read official appropriation summaries as independent coverage controls.

An agency breakdown is additive only when it sums to its department control.
Otherwise retain the department total at its actual coarser grain. This avoids
adding regional/group subtotals and their children together.
"""
import argparse
import json
from pathlib import Path
import re

import pyarrow as pa
import pyarrow.parquet as pq

from download import save_json
from parse_objects import SCHEMA, norm, page_furniture


def roman(number):
    result = ""
    for value, label in [(100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"),
                         (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]:
        while number >= value:
            result += label
            number -= value
    return result


def native_records(text):
    records, pending = [], []
    for page, content in enumerate(text.split("\f"), 1):
        for line_no, line in enumerate(content.splitlines(), 1):
            if page_furniture(line, line_no) or not re.search(r"[A-Za-z]", line):
                continue
            match = re.search(r"(?<![\w,])(\d{1,3}(?:,\d{3})+|\d+)\s*$", line)
            code_match = re.match(r"^\s*((?:[IVXLCDM]+|[A-Z]{1,2})(?:\.\d+)*\.?)\s+(.+)", line)
            if match is None:
                if code_match:
                    pending = [line.strip()]
                elif pending and line.strip() and re.search(r"[A-Za-z]", line):
                    pending.append(line.strip())
                continue
            raw = " ".join(pending + [line.strip()])
            pending = []
            amount = match[1]
            label = raw[:raw.rfind(amount)].strip().rstrip(". ")
            code_match = re.match(r"^((?:[IVXLCDM]+|[A-Z]{1,2})(?:\.\d+)*\.?)\s+(.+)", label)
            code = code_match[1].rstrip(".") if code_match else ""
            label = code_match[2] if code_match else label
            records.append(dict(code=code, name=label, amount=amount, page=page, line=line_no, raw=raw))
    return records


def reconcile(records):
    groups, current, total, annexes = [], None, None, []
    for row in records:
        amount = int(str(row["amount"]).replace(",", "")) * 1000 if row.get("amount") is not None else None
        row = dict(row, pesos=amount, code=(row.get("code") or "").rstrip("."))
        label = norm(row["name"])
        if label.startswith("total new appropriations"):
            total = amount
            continue
        if total is not None:
            annexes.append(row)
            continue
        heading = row["name"].split("(", 1)[0]
        if row["code"].rstrip(".") == roman(len(groups) + 1) and heading == heading.upper():
            current = dict(department=row, agencies=[])
            groups.append(current)
        elif current is not None and row["code"]:
            current["agencies"].append(row)
    departmental_total = sum(g["department"]["pesos"] or 0 for g in groups)
    issues = []
    if total is None or total != departmental_total:
        issues.append("national_control_mismatch")
    if any(g["department"]["pesos"] is None for g in groups):
        issues.append("department_total_missing")
    for g in groups:
        child_total = sum(r["pesos"] or 0 for r in g["agencies"])
        g["child_total"] = child_total
        g["agency_partition_reconciled"] = bool(g["agencies"]) and child_total == g["department"]["pesos"]
        g["selected_agencies"] = g["agencies"]
        if not g["agency_partition_reconciled"]:
            selected = []
            for parent in [r for r in g["agencies"] if "." not in r["code"].rstrip(".")]:
                children = [r for r in g["agencies"] if r["code"].startswith(parent["code"] + ".")]
                if children and sum(c["pesos"] or 0 for c in children) == parent["pesos"]:
                    selected.extend(children)
                else:
                    selected.append(dict(parent, aggregate_group=bool(children)))
            if selected and sum(r["pesos"] or 0 for r in selected) == g["department"]["pesos"]:
                g["selected_agencies"] = selected
                g["agency_partition_reconciled"] = True
    return groups, total, departmental_total, annexes, issues


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--document-id", required=True)
    p.add_argument("--vision", action="store_true")
    a = p.parse_args()
    root = a.root.resolve()
    doc = next(d for d in json.loads((root / f"documents-{a.year}.json").read_text())
               if d["document_id"] == a.document_id)
    if a.vision:
        records = []
        directory = root / "vision-summary" / str(a.year) / a.document_id
        for path in sorted(directory.glob("page-*.json"), key=lambda p: int(re.search(r"page-(\d+)", p.name)[1])):
            if "-response" in path.name:
                continue
            page = json.loads(path.read_text())
            for row in page["transcription"]["rows"]:
                records.append(dict(row, page=page["page"], line=None, raw=json.dumps(row, ensure_ascii=False)))
        reviews = json.loads(Path(__file__).with_name("summary-unit-reviews.json").read_text())
        review = reviews.get(str(a.year), {})
        unit_ok = review.get("source_sha256") == doc["document_sha256"] and review.get("multiplier") == 1000
    else:
        text = (root / doc["text_path"]).read_text()
        unit_ok = bool(re.search(r"[Ii]n thousand pesos", text[:800]))
        records = native_records(text)
    groups, reported, computed, annexes, issues = reconcile(records)
    if not unit_ok:
        issues.append("unit_not_confirmed")
    rows = []
    for group in groups:
        department = group["department"]
        chosen = group["selected_agencies"] if group["agency_partition_reconciled"] else [department]
        for index, item in enumerate(chosen):
            if item["pesos"] is None:
                continue
            scope = "unprogrammed_appropriations" if "unprogrammed" in norm(department["name"]) else "published_new_appropriations"
            row = {f.name: None for f in SCHEMA}
            row.update(fy=a.year, department_dsc=department["name"],
                       agency_dsc=item["name"] if group["agency_partition_reconciled"] else None,
                       amount=item["pesos"], amount_thousands=item["pesos"] / 1000,
                       record_id=f"{a.document_id}:summary:{department['code']}:{index}",
                       grain=("agency_group_total" if item.get("aggregate_group") else "agency_total")
                             if group["agency_partition_reconciled"] else "department_total",
                       budget_scope=scope, source_year=a.year, budget_status="enacted",
                       source_url=doc["url"], source_member=doc["member"], source_sha256=doc["document_sha256"],
                       source_document_id=a.document_id, source_page=item["page"], source_line=item["line"],
                       source_text=item["raw"], source_section_id=f"{a.document_id}:summary:{department['code']}",
                       quality_status=";".join(issues) if issues else "vision_control_reconciled_pending_review" if a.vision
                       else "published_summary_reconciled")
            rows.append(row)
    out = root / "summary-parquet"
    out.mkdir(exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA.with_metadata({
        b"amount_unit": b"PHP", b"role": b"independent summary controls; overlaps agency detail"})),
        out / f"gaa-{a.year}.parquet", compression="zstd")
    report = dict(year=a.year, document_id=a.document_id, records=len(records), rows=len(rows),
                  total_reported=reported, total_departments=computed, issues=issues,
                  groups=groups, annexes=annexes)
    save_json(root / "quality" / f"summary-{a.year}.json", report)
    print(json.dumps({k: v for k, v in report.items() if k not in ("groups", "annexes")}, indent=2))


if __name__ == "__main__":
    main()
