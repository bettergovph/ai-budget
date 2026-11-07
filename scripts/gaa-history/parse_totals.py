"""Preserve printed agency controls for early GAAs lacking a national summary.

Exact repeated controls are collapsed; conflicting amounts remain in the
review report and are withheld from additive facts. Detailed candidate tables
are separate and must not be unioned with these overlapping controls.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from download import save_json
from parse_objects import SCHEMA, norm


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    a = p.parse_args()
    root = a.root.resolve()
    docs = {d["document_id"]: d for d in json.loads((root / f"documents-{a.year}.json").read_text())}
    report = json.loads((root / "quality" / f"programs-{a.year}.json").read_text())
    groups = defaultdict(list)
    missing = []
    for section in report["section_details"]:
        doc = docs[section["document_id"]]
        if section["total_reported"] is None and section.get("authorization_control"):
            section = dict(section, total_reported=section["authorization_control"]["amount"],
                           control=section["authorization_control"], used_authorization_paragraph=True)
        if section["total_reported"] is None or not section.get("control") or not section["agency"]:
            missing.append(section)
            continue
        scope = doc.get("budget_scope", "current_new_appropriations")
        key = (norm(section["department"] or ""), norm(section["agency"]), scope, section.get("agency_code"))
        groups[key].append(section)
    # Some agency PDFs omit their department heading. Match only explicit,
    # nongeneric agency names with the exact same printed total in one known
    # department; ambiguous identities are left unresolved.
    known = defaultdict(set)
    for key, sections in groups.items():
        if key[0]:
            for section in sections:
                known[(key[1], key[2], section["total_reported"])].add(key)
    for key, sections in list(groups.items()):
        if key[0] or key[1] in ("office of the secretary", "office of the director general", "office of the president"):
            continue
        matches = set.union(*(known[(key[1], key[2], s["total_reported"])] for s in sections))
        if len(matches) == 1 and all(known[(key[1], key[2], s["total_reported"])] == matches for s in sections):
            dest = next(iter(matches))
            groups[dest].extend(sections)
            del groups[key]
    rows, conflicts, duplicates = [], [], []
    for key, sections in groups.items():
        amounts = {s["total_reported"] for s in sections}
        if len(amounts) != 1:
            conflicts.append(dict(identity=key, sections=sections))
            continue
        chosen = next((s for s in sections if s["department"]), sections[0])
        doc = docs[chosen["document_id"]]
        scope = key[2]
        if "unprogrammed" in key[0] or "unprogrammed" in key[1]:
            scope = "unprogrammed_appropriations"
        row = {f.name: None for f in SCHEMA}
        row.update(fy=a.year, department_dsc=chosen["department"], agency_dsc=chosen["agency"],
                   agency_code=chosen.get("agency_code"),
                   amount=chosen["total_reported"], amount_thousands=chosen["total_reported"] / 1000,
                   record_id=chosen["section_id"] + ":control", grain="fund_total" if chosen.get('table_kind') == 'purpose' else "agency_total", budget_scope=scope,
                   source_year=a.year, budget_status="enacted", source_url=doc["url"], source_member=doc["member"],
                   source_sha256=doc["document_sha256"], source_document_id=doc["document_id"],
                   source_page=chosen["control"]["page"], source_line=chosen["control"]["line"],
                   source_text=chosen["control"]["text"], source_section_id=chosen["section_id"],
                   quality_status="printed_control_pending_national_coverage_review")
        rows.append(row)
        if len(sections) > 1:
            duplicates.append(dict(chosen=chosen["section_id"], alternatives=[s["section_id"] for s in sections
                               if s["section_id"] != chosen["section_id"]]))
    out = root / "totals-parquet"
    out.mkdir(exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA.with_metadata({
        b"amount_unit": b"PHP", b"coverage": b"partial until source coverage review"})),
        out / f"gaa-{a.year}.parquet", compression="zstd")
    result = dict(year=a.year, rows=len(rows), amount=sum(r["amount"] for r in rows), conflicts=conflicts,
                  missing_controls=missing, duplicate_controls=duplicates)
    save_json(root / "quality" / f"totals-{a.year}.json", result)
    print(json.dumps(dict(year=a.year, rows=len(rows), conflicts=len(conflicts),
                         missing_controls=len(missing), duplicates=len(duplicates))))


if __name__ == "__main__":
    main()
