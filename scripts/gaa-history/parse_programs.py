"""Extract the first appropriation table at its published program/project grain.

Each table must reconcile exactly to its printed TOTAL NEW APPROPRIATIONS.
Separate program/activity re-statements, object tables, summary tables and
legal provisions are not added together. Expense columns remain in the source
text; only their explicitly printed row total is used here.
"""
import argparse
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

import pyarrow as pa
import pyarrow.parquet as pq

from download import save_json
from parse_objects import SCHEMA, identity, norm, preferred, MONEY_TOKEN, monetary_decimal, page_furniture, selected_documents

HEADER = re.compile(r"New\s+Appropriations,?\s+by\s+(?:Program(?:/Project)?|Purpose)\s*$", re.I)
MONEY = re.compile(r"(?<![\w,])" + MONEY_TOKEN)


def parse_document(root, doc):
    text = (root / doc["text_path"]).read_text()
    lines, locations = [], []
    for page_no, page in enumerate(text.split("\f"), 1):
        for line_no, line in enumerate(page.splitlines(), 1):
            lines.append(line)
            locations.append((page_no, line_no))
    starts = [i for i, line in enumerate(lines) if HEADER.search(line)]
    if not starts and 'TOTAL NEW APPROPRIATIONS' in text:
        # A few early HTML agency tables omit the usual title. Require both
        # an explicit program heading and a preceding peso authorization.
        candidate = next((i for i,line in enumerate(lines) if re.match(r'^\s*A\.\s+PROGRAMS\b',line)), None)
        if candidate is not None and any(re.search(r'\bP\s*\d{1,3}(?:,\d{3})+\s*$',s) for s in lines[:candidate]):
            starts = [candidate]
    sections = []
    for start in starts:
        department, agency, agency_code = identity(lines, start, with_code=True)
        if not agency:
            reviews = json.loads(Path(__file__).with_name('source-identity-reviews.json').read_text())
            review = next((r for r in reviews if r['document_id']==doc['document_id']),None)
            if review:
                if review['source_sha256']!=doc['document_sha256']:
                    raise ValueError('Source changed since identity review')
                agency=review['agency']
        sid = f"{doc['document_id']}:program:{start + 1}"
        purpose = bool(re.search(r'by\s+Purpose',lines[start],re.I))
        rows, pending = [], []
        total = None
        control = None
        factor = 1000 if any(re.search(r"[Tt]housand\s+[Pp]esos", s)
                             for s in lines[start:start + 12]) else 1
        if factor == 1000 and not any(re.search(r"\bTotal\b[_ ]*$", s, re.I) for s in lines[start+1:start+30]):
            # Some FY2000 HTML object tables are mislabeled Program/Project.
            # Their single-column object totals must not become another agency.
            continue
        authorization_control = None
        for j in range(max(0, start - 30), start):
            match = re.search(r"\bP\s*(\d{1,3}(?:,\d{3})+)\s*$", lines[j])
            if match:
                authorization_control = dict(amount=int(match[1].replace(",", "")), page=locations[j][0],
                                             line=locations[j][1], text=lines[j], factor=1)
        for i in range(start + 1, len(lines)):
            line = lines[i]
            s = line.strip()
            if HEADER.search(line) or re.search(r"^(?:Programs and Activities|New Appropriations,? by Object)", s, re.I):
                break
            if page_furniture(line, locations[i][1]):
                continue
            if not s or not re.search(r"[A-Za-z]", s):
                continue
            values = list(MONEY.finditer(line))
            if not values or line[values[-1].end():].strip():
                if re.match(r"(?:[a-z]\.\s|\d{15}\s)", s):
                    pending = [s]
                elif pending and re.search(r"[a-z]", s) and not re.match(r"[A-Z]+[.)]", s):
                    pending.append(s)
                continue
            # Ignore the identifying P/A/P code, numbering, and numbers inside
            # descriptions. A monetary column follows at least two spaces.
            amounts = [m for m in values if m.start() >= 2 and
                       (line[m.start()-2:m.start()].isspace() or
                        re.search(r"\bP\s*$", line[:m.start()]))]
            if not amounts:
                continue
            desc = re.sub(r"\s+P\s*$", "", line[:amounts[0].start()]).strip()
            if norm(desc) in (norm(department or ""), norm(agency or "")):
                continue
            if not re.search(r"[A-Za-z]", desc):
                continue
            scaled = monetary_decimal(amounts[-1].group()) * factor
            if scaled != scaled.to_integral_value():
                raise ValueError(f"Fractional peso in {sid}")
            amount = int(scaled)
            if re.match(r"TOTAL NEW APPROPRIATIONS\b", desc, re.I):
                total = amount
                control = dict(page=locations[i][0], line=locations[i][1], text=line, factor=factor)
                break
            if re.match(r"(?:Sub[- ]?total|Total)\b", desc, re.I):
                pending = []
                continue
            if re.fullmatch(r"(?:Peso Counterpart|Loan Proceeds|Grant Proceeds)", desc, re.I):
                # Financing-source splits repeat the parent project amount.
                pending = []
                continue
            # In the UACS summary, uncoded named programs restate the coded
            # major-class amounts immediately above them. Only the coded
            # summary rows form an additive partition of the appropriation.
            if doc["year"] >= 2014 and not re.match(r"^\d{15}\s", desc) and not pending:
                continue
            # Rows with a complete expense breakdown must sum to the printed
            # row total. Single-column lump sums are also explicitly printed.
            numeric = [monetary_decimal(m.group()) * factor for m in amounts]
            row_sum_ok = len(numeric) == 1 or sum(numeric[:-1]) == numeric[-1]
            if pending:
                desc = " ".join(pending + [desc])
                pending = []
            code = re.match(r"^(\d{15})\s+(.*)", desc)
            page_no, line_no = locations[i]
            row = {f.name: None for f in SCHEMA}
            row.update(fy=doc["year"], department_dsc=department, agency_dsc=agency, agency_code=agency_code,
                       fpap_code=code[1] if code else None, fpap_dsc=code[2] if code else desc,
                       amount=amount, amount_thousands=amount / 1000,
                       record_id=f"{sid}:{i + 1}", grain="purpose_total" if purpose else "program_total",
                       budget_scope=doc.get("budget_scope", "current_new_appropriations"), source_year=doc["year"],
                       budget_status="enacted", source_url=doc["url"], source_member=doc["member"],
                       source_sha256=doc["document_sha256"], source_document_id=doc["document_id"],
                       source_page=page_no, source_line=line_no, source_text=line,
                       source_section_id=sid,
                       quality_status="candidate" if row_sum_ok else "row_sum_mismatch")
            rows.append(row)
        reasons = []
        if total is None:
            reasons.append("missing_total")
        elif sum(r["amount"] for r in rows) != total:
            reasons.append("program_sum_mismatch")
        if not agency:
            reasons.append("missing_agency_name")
        if not rows:
            reasons.append("no_rows")
        if any(r["quality_status"] == "row_sum_mismatch" for r in rows):
            reasons.append("row_sum_mismatch")
        for row in rows:
            row["quality_status"] = (("ocr_reconciled_pending_review" if "ocr" in doc.get("extraction", "")
                                      else "reconciled") if not reasons else ";".join(reasons))
        fingerprint = hashlib.sha256(json.dumps([
            doc.get("budget_scope", "current_new_appropriations"),
            norm(department or ""), norm(agency or ""),
            [(norm(r["fpap_dsc"]), r["amount"]) for r in rows]
        ], sort_keys=True).encode()).hexdigest()
        sections.append(dict(section_id=sid, document_id=doc["document_id"], year=doc["year"],
                             department=department, agency=agency, agency_code=agency_code, total_reported=total,
                             control=control, authorization_control=authorization_control, table_kind='purpose' if purpose else 'program',
                             total_extracted=sum(r["amount"] for r in rows), reasons=reasons,
                             fingerprint=fingerprint, rows=rows))
    return sections


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--inventory", type=Path)
    a = p.parse_args()
    root = a.root.resolve()
    docpath = a.inventory or root / f"documents-{a.year}.json"
    if not docpath.exists():
        docpath = root / "documents.json"
    docs = selected_documents(json.loads(docpath.read_text()), a.year)
    accepted, rejected, sections, errors, seen = [], [], [], [], {}
    for doc in docs:
        try:
            sections.extend(parse_document(root, doc))
        except Exception as e:
            errors.append(dict(document_id=doc["document_id"], error=str(e)))
    for s in sections:
        rows = s.pop("rows")
        if s["fingerprint"] in seen:
            s["duplicate_of"] = seen[s["fingerprint"]]
            continue
        seen[s["fingerprint"]] = s["section_id"]
        (rejected if s["reasons"] else accepted).extend(rows)
    out = root / "program-parquet"
    out.mkdir(exist_ok=True)
    for filename, rows in [(f"gaa-{a.year}.parquet", accepted), (f"rejected-{a.year}.parquet", rejected)]:
        pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA.with_metadata({
            b"coverage": b"partial: see quality report; not a complete national GAA",
            b"amount_unit": b"PHP", b"historical_grain": b"program_total"})), out / filename,
            compression="zstd")
    report = dict(year=a.year, status="partial_pending_coverage_review", documents=len(docs),
                  sections=len(sections), accepted_rows=len(accepted), rejected_rows=len(rejected),
                  duplicates=sum("duplicate_of" in s for s in sections), errors=errors,
                  reasons=dict(Counter(r for s in sections for r in s["reasons"])), section_details=sections)
    save_json(root / "quality" / f"programs-{a.year}.json", report)
    print(json.dumps({k: v for k, v in report.items() if k != "section_details"}, indent=2))


if __name__ == "__main__":
    main()
