"""Read DBM technical UACS spreadsheets, preserving every source row verbatim."""
import argparse
from decimal import Decimal
import hashlib
import json
import io
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import xlrd
import openpyxl

from download import save_json
from parse_objects import SCHEMA


def clean(v):
    if v is None or (isinstance(v, str) and v.strip().lower() in ("", "nan", "null")):
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def sheets(path):
    with path.open("rb") as f:
        signature = f.read(8)
    if signature.startswith(bytes.fromhex("d0cf11e0a1b11ae1")):
        w = xlrd.open_workbook(path)
        for s in w.sheets():
            yield s.name, (s.row_values(i) for i in range(s.nrows))
    else:
        # DBM's FY2017 DPWH A.xls is actually an XLSX ZIP container.
        w = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True, data_only=True)
        for s in w:
            yield s.title, s.values


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    a = p.parse_args()
    root = a.root.resolve()
    docpath = root / f"documents-{a.year}.json"
    if not docpath.exists():
        docpath = root / "documents.json"
    docs = [d for d in json.loads(docpath.read_text()) if d["year"] == a.year
            and Path(d["document_path"]).suffix.lower() in (".xls", ".xlsx")]
    rows, raw, errors, counts, duplicates, seen, flags = [], [], [], [], [], {}, []
    for doc in docs:
        signature = doc["document_sha256"]
        if signature in seen:
            duplicates.append(dict(document_id=doc["document_id"], duplicate_of=seen[signature]))
            continue
        seen[signature] = doc["document_id"]
        start_row = len(rows)
        n, total, recognized = 0, 0, False
        try:
            for sheet, cells in sheets(root / doc["document_path"]):
                header = None
                for lineno, values in enumerate(cells, 1):
                    if header is None:
                        names = [clean(v) for v in values]
                        if "AMT" in names and any(x in names for x in ("UACS_SOBJ_CD", "UACS_OBJ_CD")):
                            header = names
                            recognized = True
                        continue
                    source = {h: v for h, v in zip(header, values) if h is not None}
                    if not any(clean(v) is not None for v in source.values()):
                        continue
                    raw_json = json.dumps(source, ensure_ascii=False, separators=(",", ":"))
                    raw.append(dict(fy=a.year, document_id=doc["document_id"], sheet=sheet,
                                    source_row=lineno, source_json=raw_json))
                    def get(*keys):
                        return next((clean(source[k]) for k in keys if k in source and clean(source[k]) is not None), None)
                    if get("UACS_SOBJ_CD", "UACS_OBJ_CD") is None:
                        continue
                    amount = get("AMT")
                    if amount is None:
                        raise ValueError(f"{sheet}:{lineno}: object row has no amount")
                    thousands = Decimal(amount.replace(",", ""))
                    if thousands * 1000 != (thousands * 1000).to_integral_value():
                        raise ValueError(f"{sheet}:{lineno}: fractional peso")
                    hard, new = get("HARD_CEILING"), get("NEW_SPENDING")
                    component_mismatch = (hard is not None and new is not None and
                        Decimal(hard.replace(',', '')) + Decimal(new.replace(',', '')) != thousands)
                    if component_mismatch:
                        flags.append(dict(document_id=doc["document_id"], sheet=sheet, row=lineno,
                                          flag="components_do_not_sum_to_published_amt",
                                          hard_ceiling=hard, new_spending=new, amt=amount))
                    row = {f.name: None for f in SCHEMA}
                    row.update(fy=a.year, department_id=get("DEPARTMENT", "UACS_DPT_ID"),
                               department_dsc=get("UACS_DPT_DSC"), agency_code=get("AGENCY", "UACS_AGY_ID"),
                               agency_dsc=get("UACS_AGY_DSC"), fpap_code=get("PREXC_FPAP_ID", "UACS_FPAP_ID"),
                               fpap_dsc=get("DSC"), operunit_code=get("OPERUNIT", "OU"),
                               operunit_dsc=get("UACS_OPER_DSC"), div_code=get("UACS_OPERDIV_ID"),
                               div_dsc=get("UACS_DIV_DSC"), region_code=get("UACS_REG_ID"),
                               region_dsc=get("UACS_REG_DSC"), fund_code=get("FUNDCD", "UACS_FUNDSUBCAT_ID"),
                               fund_dsc=get("UACS_FUNDSUBCAT_DSC"), expense_code=get("UACS_EXP_CD"),
                               expense_dsc=get("UACS_EXP_DSC"), object_code=get("UACS_SOBJ_CD", "UACS_OBJ_CD"),
                               object_dsc=get("UACS_SOBJ_DSC", "UACS_OBJ_DSC"),
                               amount=int(thousands * 1000), amount_thousands=float(thousands),
                               record_id=f"{doc['document_id']}:{sheet}:{lineno}",
                               grain="program_operunit_fund_expense_object", budget_scope="technical_gaa_spreadsheet",
                               source_year=a.year, budget_status="enacted", source_url=doc["url"],
                               source_member=(doc["member"] or "") + "#" + sheet,
                               source_sha256=signature, source_document_id=doc["document_id"],
                               source_line=lineno, source_text=raw_json,
                               source_section_id=f"{doc['document_id']}:{sheet}",
                               quality_status="source_normalized_pending_pdf_reconciliation")
                    if get("SORDER") == "2":
                        row["department_id"] = {"01": "SPF", "04": "AUTO"}.get(
                            row["department_id"], "X" + (row["department_id"] or "unknown"))
                    # Some SPF workbooks omit department columns entirely.
                    # Use their explicit fund/authority labels, retaining every
                    # original component in source_text and source-rows Parquet.
                    if row["department_id"] is None:
                        if get("UACS_AUTH_DSC") == "Automatic Appropriations":
                            row.update(department_id="AUTO", department_dsc="Automatic Appropriations")
                        elif (get("UACS_DPT_DSC") == "Special Purpose Funds" or
                              get("UACS_FUNDCAT_DSC") == "Special Purpose Funds"):
                            row.update(department_id="SPF", department_dsc="Special Purpose Funds")
                        elif get("UACS_FUNDCAT_DSC"):
                            row.update(department_id="FUND:" + (get("UACS_FUNDCAT_ID") or "unknown"),
                                       department_dsc=get("UACS_FUNDCAT_DSC"))
                    if row["agency_dsc"] is None and row["department_id"] in ("SPF", "AUTO", "FUND:02"):
                        row["agency_dsc"] = get("UACS_FUNDSUBCAT_DSC")
                        row["agency_code"] = get("UACS_FUNDSUBCAT_ID")
                    if get("UACS_AUTH_DSC") == "Automatic Appropriations":
                        row["budget_scope"] = "automatic_appropriations"
                    elif get("UACS_AUTH_DSC") == "New General Appropriations":
                        row["budget_scope"] = "current_new_appropriations"
                    # UACS authority codes: DBM 2014 Manual, funding sources.
                    # FUNDCD can include the two-digit fund cluster prefix.
                    fund = get("FUNDCD")
                    authority = get("UACS_AUTH_ID")
                    if authority is None and fund and len(fund) in (6, 8):
                        authority = fund[-6:][1:3]
                    scopes = {"01": "current_new_appropriations", "02": "continuing_appropriations",
                              "03": "supplemental_appropriations", "04": "automatic_appropriations",
                              "05": "unprogrammed_appropriations"}
                    if authority in scopes:
                        row["budget_scope"] = scopes[authority]
                    if row["department_id"] is None and authority == "05":
                        row.update(department_id="SPF", department_dsc="Special Purpose Funds")
                    if component_mismatch:
                        row["quality_status"] = "published_amt_preserved_component_mismatch"
                    rows.append(row)
                    n += 1
                    total += row["amount"]
        except Exception as e:
            errors.append(dict(document_id=doc["document_id"], error=str(e)))
            del rows[start_row:]
        counts.append(dict(document_id=doc["document_id"], recognized=recognized, rows=n, amount=total))
    out = root / "spreadsheet-parquet"
    out.mkdir(exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA.with_metadata({
        b"amount_unit": b"PHP", b"source_amount_unit": b"thousands PHP",
        b"coverage": b"partial: pending full source and PDF reconciliation"})),
        out / f"gaa-{a.year}.parquet", compression="zstd")
    raw_schema = pa.schema([("fy", pa.int32()), ("document_id", pa.string()),
                           ("sheet", pa.string()), ("source_row", pa.int32()), ("source_json", pa.string())])
    pq.write_table(pa.Table.from_pylist(raw, schema=raw_schema),
                   out / f"source-rows-{a.year}.parquet", compression="zstd")
    report = dict(year=a.year, documents=len(docs), rows=len(rows), source_rows=len(raw),
                  errors=errors, duplicates=duplicates, quality_flags=flags, files=counts)
    save_json(root / "quality" / f"spreadsheets-{a.year}.json", report)
    print(json.dumps({k: v for k, v in report.items() if k != "files"}, indent=2))


if __name__ == "__main__":
    main()
