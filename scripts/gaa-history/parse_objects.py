"""Extract historical agency/object tables; publish only reconciled sections.

These are agency-level object breakdowns, NOT program x operating-unit x object
microdata. No modern UACS or organizational crosswalk is guessed.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

import pyarrow as pa
import pyarrow.parquet as pq

from download import save_json

SCHEMA = pa.schema([
    ("fy", pa.int32()), ("department_id", pa.string()), ("department_dsc", pa.string()),
    ("agency_code", pa.string()), ("agency_dsc", pa.string()),
    ("fpap_code", pa.string()), ("fpap_dsc", pa.string()),
    ("program_code", pa.string()), ("program_dsc", pa.string()),
    ("major_class", pa.string()), ("prexc_level", pa.int32()),
    ("operunit_code", pa.string()), ("operunit_dsc", pa.string()),
    ("div_code", pa.string()), ("div_dsc", pa.string()),
    ("region_code", pa.string()), ("region_dsc", pa.string()),
    ("fund_code", pa.string()), ("fund_dsc", pa.string()),
    ("expense_code", pa.string()), ("expense_dsc", pa.string()),
    ("object_code", pa.string()), ("object_dsc", pa.string()),
    ("amount_thousands", pa.float64()), ("amount", pa.int64()),
    ("record_id", pa.string()), ("grain", pa.string()), ("budget_scope", pa.string()),
    ("source_year", pa.int32()), ("budget_status", pa.string()),
    ("source_url", pa.string()), ("source_member", pa.string()),
    ("source_sha256", pa.string()), ("source_document_id", pa.string()),
    ("source_page", pa.int32()), ("source_line", pa.int32()),
    ("source_text", pa.string()), ("source_section_id", pa.string()),
    ("source_object_code", pa.string()), ("quality_status", pa.string()),
])

OBJECT_HEADER = re.compile(r"New\s+Appropriations,?\s+by\s+Objects?\s+of\s+Expenditures?", re.I)
MONEY_TOKEN = r"(?:[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\))"
NUMBER = re.compile(r"(?<![\w,])" + MONEY_TOKEN + r"\s*$")
EXPENSES = {
    "personal services": ("1", "Personnel Services"),
    "personnel services": ("1", "Personnel Services"),
    "maintenance and other operating expenses": ("2", "Maintenance and Other Operating Expenses"),
    "financial expenses": ("3", "Financial Expenses"),
    "capital outlays": ("6", "Capital Outlays"),
}


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def monetary_decimal(s):
    from decimal import Decimal
    s = s.strip().replace(",", "")
    return Decimal("-" + s[1:-1] if s.startswith("(") else s)


def identity(lines, before, with_code=False):
    """Find printed organizational titles preceding the current appropriation table."""
    department = None
    for line in lines[:before]:
        m = re.match(r"^\s*([IVXLCDM]+)\.\s+(.+?)\s*$", line)
        if m and m[1] not in ("C", "D", "L", "M") and len(m[2]) > 5 and m[2] == m[2].upper() and norm(m[2]) not in (
                "general administration and support", "support to operations", "operations",
                "locally funded projects", "foreign assisted projects", "programs"):
            department = m[2]
            break
    # Anchor at the last program table and look back to the authorization
    # paragraph. This avoids treating program subsection letters as agencies.
    program_start = max((i for i in range(before + 1) if re.search(
        r"New Appropriations,?\s+by (?:Program|Purpose)", lines[i], re.I)), default=0)
    headings = []
    for line in lines[:program_start or before]:
        m = re.match(r"^\s*([A-Z]{1,2}(?:\.\d+)*)(?:[.)]\s*|(?<=\d)\s+)(.+?)\s*$", line)
        if m and not any(x in m[2].upper() for x in ("PROGRAMS", "PROJECT(S)", "PROJECTS")) and norm(m[2]) not in (
                "program", "purpose", "purposes", "operations", "general administration and support",
                "support to operations", "capital outlays") and not re.search(r"\d[\d,]*\s{2,}\d", m[2]):
            headings.append((m[1], m[2]))
    code, agency = headings[-1] if headings else (None, department)
    # A few source HTML files omit the agency letter, but retain the title
    # directly above the appropriation authorization paragraph.
    authorizations = [i for i in range(max(0, program_start - 30), program_start)
                      if re.match(r"^\s*For\b", lines[i])]
    for i in authorizations[-1:]:
        if re.match(r"^\s*For\b", lines[i]):
            previous = next((s.strip() for s in reversed(lines[:i]) if s.strip()), "")
            title = previous.lstrip(". ")
            title = re.sub(r"^—b(?=[A-Z]\.)", "", title).rstrip("˜")
            title = re.sub(r"\s+\d+\s*$", "", title)
            if title == department or re.search(r"GENERAL APPROPRIATIONS ACT|OFFICIAL GAZETTE", title):
                continue
            if len(title) > 5 and title == title.upper() and re.search(r"[A-Z]", title) and not re.search(r"\d{4}|\.{4}", title):
                match = re.match(r"^([A-Z]{1,2}(?:\.\d+)*)(?:\.\s*|(?<=\d)\s+)(.+)", title)
                department_match = re.match(r"^[IVXLCDM]+\.\s*(.+)", title)
                if department_match and department_match[1] == department:
                    code, agency = None, department
                    continue
                if match:
                    code, agency = match[1], match[2]
                else:
                    code, agency = None, title
    if agency == department:
        code = None
    return (department, agency, code) if with_code else (department, agency)


def page_furniture(line, line_no):
    """Printed page titles are uppercase at the top, followed by a page number."""
    return bool(re.search(r"GENERAL APPROPRIATIONS ACT|OFFICIAL GAZETTE", line, re.I) or
                (line_no <= 4 and re.fullmatch(r"\s*(?:\d+\s+)?[A-Z][A-Z ,&()./'-]+\s+\d+\s*", line)))


def parse_document(root, doc):
    text = (root / doc["text_path"]).read_text()
    # Preserve physical page and line locations while removing form feeds.
    lines, locations = [], []
    for page_no, page in enumerate(text.split("\f"), 1):
        for line_no, line in enumerate(page.splitlines(), 1):
            lines.append(line)
            locations.append((page_no, line_no))
    starts = [i for i, line in enumerate(lines) if OBJECT_HEADER.search(line)]
    sections = []
    for section_index, start in enumerate(starts):
        stop = starts[section_index + 1] if section_index + 1 < len(starts) else len(lines)
        department, agency = identity(lines, start)
        sid = f"{doc['document_id']}:{start + 1}"
        leaves, controls = [], []
        expense = (None, None)
        expense_sums = Counter()
        expense_checks = []
        total = None
        scale_confirmed = any(re.search(r"[Tt]housand\s+[Pp]esos", line)
                              for line in lines[start:start + 12])
        continuation = []
        for i in range(start + 1, stop):
            line = lines[i]
            stripped = line.strip()
            if not stripped:
                continue
            # Page furniture and ruling characters must not become descriptions.
            if page_furniture(line, locations[i][1]):
                continue
            if not re.search(r"[A-Za-z0-9]", line):
                continue
            n = norm(stripped)
            if n in EXPENSES:
                expense = EXPENSES[n]
                continuation = []
                continue
            match = NUMBER.search(line)
            if not match:
                if re.search(r"[A-Za-z]", stripped) and not re.search(
                        r"Thousand Pesos|Current Operating Expenditures|New Appropriations", stripped, re.I):
                    continuation = [stripped]
                continue
            desc = line[:match.start()].strip()
            desc = re.sub(r"\s+P\s*$", "", desc).strip()
            if not desc or not re.search(r"[A-Za-z]", desc):
                continue
            if norm(desc) in (norm(department or ""), norm(agency or "")):
                continue
            # Object tables are single amount columns; multi-column rows mean
            # the section boundary was missed. Stop rather than guessing units.
            if re.search(r"\d[\d,]*\s{2,}\d", desc):
                break
            raw_code = None
            cm = re.match(r"^(\d{2})\s+(.+)", desc)
            if cm:
                raw_code, desc = cm.groups()
            scaled = monetary_decimal(match.group()) * 1000
            if scaled != scaled.to_integral_value():
                raise ValueError(f"Fractional peso in {sid}")
            amount = int(scaled)
            normalized_desc = norm(desc)
            if normalized_desc.startswith(("total ", "sub total ", "subtotal ")) or normalized_desc == "gross compensation":
                controls.append(dict(description=desc, amount=amount, line=i + 1))
                e = EXPENSES.get(re.sub(r"^total\s+", "", normalized_desc))
                if e:
                    expense_checks.append(dict(expense_code=e[0], reported=amount,
                                               extracted=expense_sums[e[0]]))
                    expense_sums[e[0]] = 0
                if normalized_desc in ("total new appropriations", "total appropriations"):
                    total = amount
                    break
                continuation = []
                continue
            page, line_no = locations[i]
            row = {name: None for name in SCHEMA.names}
            row.update(fy=doc["year"], department_dsc=department, agency_dsc=agency,
                       expense_code=expense[0], expense_dsc=expense[1], object_dsc=desc,
                       amount=amount, amount_thousands=amount / 1000,
                       record_id=f"{sid}:{i + 1}", grain="agency_object",
                       budget_scope=doc.get("budget_scope", "current_new_appropriations"), source_year=doc["year"],
                       budget_status="enacted", source_url=doc["url"], source_member=doc["member"],
                       source_sha256=doc["document_sha256"], source_document_id=doc["document_id"],
                       source_page=page, source_line=line_no, source_text=line,
                       source_section_id=sid, source_object_code=raw_code,
                       quality_status="candidate")
            leaves.append(row)
            expense_sums[expense[0]] += amount
            continuation = []
        computed = sum(r["amount"] for r in leaves)
        reasons = []
        if not scale_confirmed:
            reasons.append("unit_not_confirmed")
        if total is None:
            reasons.append("missing_total")
        elif total != computed:
            reasons.append("object_sum_mismatch")
        if any(c["reported"] != c["extracted"] for c in expense_checks):
            reasons.append("expense_sum_mismatch")
        if not agency:
            reasons.append("missing_agency_name")
        if not leaves:
            reasons.append("no_leaves")
        if any(r["expense_code"] is None for r in leaves):
            reasons.append("missing_expense_class")
        for row in leaves:
            row["quality_status"] = (("ocr_reconciled_pending_review" if "ocr" in doc.get("extraction", "")
                                      else "reconciled") if not reasons else ";".join(reasons))
        fingerprint = hashlib.sha256(json.dumps([
            doc.get("budget_scope", "current_new_appropriations"),
            norm(department or ""), norm(agency or ""),
            [(r["expense_code"], norm(r["object_dsc"]), r["amount"]) for r in leaves]
        ], sort_keys=True).encode()).hexdigest()
        sections.append(dict(section_id=sid, document_id=doc["document_id"],
                             year=doc["year"], department=department, agency=agency,
                             total_reported=total, total_extracted=computed,
                             expense_checks=expense_checks, reasons=reasons,
                             fingerprint=fingerprint, rows=leaves))
    return sections


def preferred(doc):
    if not doc.get("text_path") or doc.get("extraction") in ("error", "unsupported", "needs_ocr_or_empty"):
        return False
    path = doc["document_path"].lower()
    if doc["year"] == 2003 and len(doc.get("index_scopes", [])) != 1:
        return False
    if doc["year"] >= 2016:
        # The technical (UACS) edition contains the same object table and adds
        # program codes. Regular editions and BESF are alternate representations.
        return "tech" in doc["url"].lower() or "uacs" in doc["url"].lower()
    return "/details" not in doc["url"].lower() and "annex" not in doc["url"].lower()


def selected_documents(documents, year):
    docs = [d for d in documents if d["year"] == year and preferred(d)]
    if year >= 2016:
        # Individual PDFs sometimes begin with the preceding agency's last
        # page. The complete departmental PDF supplies reliable boundaries.
        from urllib.parse import urlsplit
        complete = {str(Path(urlsplit(d["url"]).path).parent) for d in docs
                    if Path(urlsplit(d["url"]).path).stem.lower() ==
                    Path(urlsplit(d["url"]).path).parent.name.lower()}
        docs = [d for d in docs if str(Path(urlsplit(d["url"]).path).parent) not in complete or
                Path(urlsplit(d["url"]).path).stem.lower() ==
                Path(urlsplit(d["url"]).path).parent.name.lower()]
    return docs


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
    sections = []
    errors = []
    for doc in docs:
        try:
            sections.extend(parse_document(root, doc))
        except Exception as e:
            errors.append(dict(document_id=doc["document_id"], error=str(e)))
    accepted, rejected, seen = [], [], {}
    for section in sections:
        rows = section.pop("rows")
        fingerprint = section["fingerprint"]
        if fingerprint in seen:
            section["duplicate_of"] = seen[fingerprint]
            continue
        seen[fingerprint] = section["section_id"]
        (rejected if section["reasons"] else accepted).extend(rows)
    out = root / "candidate-parquet"
    out.mkdir(exist_ok=True)
    for name, rows in [(f"gaa-{a.year}.parquet", accepted), (f"rejected-{a.year}.parquet", rejected)]:
        metadata = {b"coverage": b"partial: see quality report; not a complete national GAA",
                    b"amount_unit": b"PHP", b"historical_grain": b"agency_object"}
        table = pa.Table.from_pylist(rows, schema=SCHEMA.with_metadata(metadata))
        pq.write_table(table, out / name, compression="zstd")
    report = dict(year=a.year, status="partial_pending_coverage_review", documents=len(docs),
                  sections=len(sections), accepted_rows=len(accepted), rejected_rows=len(rejected),
                  duplicates=sum("duplicate_of" in s for s in sections),
                  errors=errors, reasons=dict(Counter(r for s in sections for r in s["reasons"])),
                  section_details=sections)
    save_json(root / "quality" / f"objects-{a.year}.json", report)
    print(json.dumps({k: v for k, v in report.items() if k != "section_details"}, indent=2))


if __name__ == "__main__":
    main()
