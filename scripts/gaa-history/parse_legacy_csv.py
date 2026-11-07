"""Normalize DBM's pre-UACS CSVs without losing blanks, codes or scope.

PS/MOOE/CO/NET are expense columns, not a total column. NET is net lending.
New and automatic appropriations are kept distinct. Published amounts use
thousands of pesos; original cells are retained for independent reconciliation.
"""
import argparse
import csv
from decimal import Decimal
import io
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from download import save_json
from parse_objects import SCHEMA

EXPENSES = {"PS": ("1", "Personnel Services"),
            "MOOE": ("2", "Maintenance and Other Operating Expenses"),
            "CO": ("6", "Capital Outlays"), "NET": ("NET", "Net Lending")}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    a = p.parse_args()
    root = a.root.resolve()
    docs = json.loads((root / f"documents-{a.year}.json").read_text())
    rows, raw, files = [], [], []
    for doc in docs:
        path = root / doc["document_path"]
        if path.suffix.lower() != ".csv":
            continue
        data = path.read_bytes()
        try:
            text, encoding = data.decode("utf-8-sig"), "utf-8-sig"
        except UnicodeDecodeError:
            text, encoding = data.decode("cp1252"), "cp1252"
        reader = csv.DictReader(io.StringIO(text))
        if not {"DPT_CD", "OWNER_CD", "FPAP_CD", "PS", "MOOE", "CO", "NET"}.issubset(reader.fieldnames or []):
            continue
        scope = ("automatic_appropriations" if "Automatic Appropriations" in path.name
                 else "current_new_appropriations" if "New Appropriations" in path.name else None)
        if scope is None:
            raise ValueError(f"Unknown scope: {path}")
        seen = set()
        counts = {expense: dict(cells=0, amount=0) for expense in EXPENSES}
        for ordinal, source in enumerate(reader, 1):
            line = reader.line_num
            def cell(k):
                value = source.get(k)
                return value.strip() if isinstance(value, str) and value.strip() else None
            raw_json = json.dumps(source, ensure_ascii=False, separators=(",", ":"))
            raw.append(dict(fy=a.year, document_id=doc["document_id"], source_row=ordinal,
                            source_line=line, source_json=raw_json))
            for field, (code, desc) in EXPENSES.items():
                value = cell(field)
                if value is None:
                    continue
                thousands = Decimal(value.replace(",", ""))
                scaled = thousands * 1000
                if scaled != scaled.to_integral_value():
                    raise ValueError(f"Fractional peso: {path}:{line}:{field}")
                key = tuple(cell(k) for k in ("DPT_CD", "OWNER_CD", "FPAP_CD", "AREA_CD")) + (field,)
                if key in seen:
                    raise ValueError(f"Duplicate source fact in {path}: {key}")
                seen.add(key)
                row = {f.name: None for f in SCHEMA}
                row.update(fy=a.year, department_id=cell("DPT_CD"), department_dsc=cell("DPT_DSC"),
                           agency_code=cell("OWNER_CD"), agency_dsc=cell("OWNER_DSC"),
                           fpap_code=cell("FPAP_CD"), fpap_dsc=cell("FPAP_DSC"),
                           region_code=cell("AREA_CD"), region_dsc=cell("AREA_DSC"),
                           expense_code=code, expense_dsc=desc, amount=int(scaled),
                           amount_thousands=float(thousands), record_id=f"{doc['document_id']}:{ordinal}:{field}",
                           grain="program_area_expense", budget_scope=scope, source_year=a.year,
                           budget_status="enacted", source_url=doc["url"], source_member=doc["member"],
                           source_sha256=doc["document_sha256"], source_document_id=doc["document_id"],
                           source_line=line, source_text=raw_json, source_section_id=doc["document_id"],
                           quality_status="source_normalized_pending_pdf_reconciliation")
                rows.append(row)
                counts[field]["cells"] += 1
                counts[field]["amount"] += row["amount"]
        files.append(dict(document_id=doc["document_id"], member=doc["member"], encoding=encoding,
                          budget_scope=scope, expenses=counts))
    out = root / "csv-parquet"
    out.mkdir(exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA.with_metadata({
        b"amount_unit": b"PHP", b"source_amount_unit": b"thousands PHP",
        b"coverage": b"source normalized: pending national coverage and PDF reconciliation"})),
        out / f"gaa-{a.year}.parquet", compression="zstd")
    raw_schema = pa.schema([("fy", pa.int32()), ("document_id", pa.string()),
                           ("source_row", pa.int32()), ("source_line", pa.int32()), ("source_json", pa.string())])
    pq.write_table(pa.Table.from_pylist(raw, schema=raw_schema),
                   out / f"source-rows-{a.year}.parquet", compression="zstd")
    report = dict(year=a.year, files=files, rows=len(rows), source_rows=len(raw))
    save_json(root / "quality" / f"csv-{a.year}.json", report)
    print(json.dumps(dict(year=a.year, files=len(files), rows=len(rows), source_rows=len(raw))), flush=True)


if __name__ == "__main__":
    main()
