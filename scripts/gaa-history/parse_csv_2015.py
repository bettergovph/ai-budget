"""Normalize the headerless 16-column consolidated FY2015 official CSV.

Department CSVs, AA-SPF.csv and SPF.csv are subsets, not additional facts.
Field meanings are cross-checked against the same UACS dimensions in the
following year's workbooks; raw cells and leading zeroes remain preserved.
"""
from collections import Counter
import csv
from decimal import Decimal
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from download import save_json
from parse_objects import SCHEMA

FIELDS = ["department_id", "department_dsc", "agency_code", "agency_dsc",
          "fpap_code", "fpap_dsc", "operunit_code", "operunit_dsc", "region_code",
          "fund_code", "fund_dsc", "expense_code", "expense_dsc", "object_code",
          "object_dsc", "amount_thousands"]


def main():
    root = Path("data/gaa-history").resolve()
    inventories = [root / "documents-2015.json", root / "documents-2015-remote.json"]
    docs = {d["document_id"]: d for p in inventories if p.exists() for d in json.loads(p.read_text())}
    doc = next(d for d in docs.values() if d["member"] == "GAA2015/GAA2015.csv")
    source = root / doc["document_path"]
    # Decode strictly: no replacement of source characters is permitted.
    try:
        source.read_text(encoding="utf-8-sig")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        encoding = "cp1252"
    output = root / "csv-parquet"
    output.mkdir(exist_ok=True)
    schema = SCHEMA.with_metadata({b"amount_unit": b"PHP", b"source_amount_unit": b"thousands PHP",
                                   b"coverage": b"consolidated official source; pending PDF reconciliation"})
    raw_schema = pa.schema([("fy", pa.int32()), ("document_id", pa.string()),
                           ("source_row", pa.int32()), ("source_json", pa.string())])
    rows, raw, counts, amounts = [], [], Counter(), Counter()
    monetary, source_rows, total = 0, 0, 0
    with pq.ParquetWriter(output / "gaa-2015.parquet", schema, compression="zstd") as writer, \
         pq.ParquetWriter(output / "source-rows-2015.parquet", raw_schema, compression="zstd") as raw_writer, \
         source.open(encoding=encoding, newline="") as f:
        for ordinal, cells in enumerate(csv.reader(f), 1):
            if len(cells) != len(FIELDS):
                raise ValueError(f"Unexpected field count at row {ordinal}: {len(cells)}")
            source_rows += 1
            original = dict(zip(FIELDS, cells))
            raw_json = json.dumps(original, ensure_ascii=False, separators=(",", ":"))
            raw.append(dict(fy=2015, document_id=doc["document_id"], source_row=ordinal, source_json=raw_json))
            if cells[13].strip():
                thousands = Decimal(cells[15].replace(",", ""))
                if thousands * 1000 != (thousands * 1000).to_integral_value():
                    raise ValueError(f"Fractional peso at row {ordinal}")
                row = {f.name: None for f in SCHEMA}
                row.update({k: v.strip() or None for k, v in original.items() if k != "amount_thousands"})
                if row["department_dsc"] == "Automatic Appropriations":
                    row["department_id"] = "AUTO"
                elif row["department_dsc"] == "New General Appropriations":
                    row["department_id"] = "SPF"
                scope = {"101": "current_new_appropriations", "104": "automatic_appropriations",
                         "105": "unprogrammed_appropriations"}.get((row["fund_code"] or "")[:3], "unclassified_authority")
                row.update(fy=2015, amount=int(thousands * 1000), amount_thousands=float(thousands),
                           record_id=f"{doc['document_id']}:{ordinal}", grain="program_operunit_fund_expense_object",
                           budget_scope=scope, source_year=2015, budget_status="enacted",
                           source_url=doc["url"], source_member=doc["member"], source_sha256=doc["document_sha256"],
                           source_document_id=doc["document_id"], source_line=ordinal, source_text=raw_json,
                           source_section_id=doc["document_id"], quality_status="source_normalized_pending_pdf_reconciliation")
                rows.append(row)
                monetary += 1
                total += row["amount"]
                counts[scope] += 1
                amounts[scope] += row["amount"]
            if ordinal % 25000 == 0:
                writer.write_table(pa.Table.from_pylist(rows, schema=schema))
                raw_writer.write_table(pa.Table.from_pylist(raw, schema=raw_schema))
                rows, raw = [], []
        writer.write_table(pa.Table.from_pylist(rows, schema=schema))
        raw_writer.write_table(pa.Table.from_pylist(raw, schema=raw_schema))
    report = dict(year=2015, rows=monetary, source_rows=source_rows, amount=total,
                  encoding=encoding, rows_by_scope=dict(counts), amount_by_scope=dict(amounts),
                  excluded_alternate_members=["GAA2015/AA-SPF.csv", "GAA2015/SPF.csv", "department-specific CSVs"])
    save_json(root / "quality/csv-2015.json", report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
