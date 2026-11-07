"""Compare machine-readable agency sums with independently printed GAA controls."""
import argparse
from collections import defaultdict, Counter
import json
from pathlib import Path
import re

import duckdb

from download import save_json


def normalize(s):
    return re.sub(r"[^a-z0-9]+", " ", re.sub(r"\([^)]*\)", "", s or "").lower()).strip()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--source", choices=["csv", "spreadsheet"], default="csv")
    a = p.parse_args()
    root = a.root.resolve()
    source = root / f"{a.source}-parquet" / f"gaa-{a.year}.parquet"
    conn = duckdb.connect()
    data = conn.execute("""SELECT department_dsc,agency_dsc,sum(amount) AS amount
        FROM read_parquet(?) WHERE budget_scope IN
          ('current_new_appropriations','technical_gaa_spreadsheet') GROUP BY ALL""", [str(source)]).fetchall()
    raw = {(normalize(d), normalize(g)): dict(department=d, agency=g, amount=int(v)) for d,g,v in data}
    by_name = defaultdict(list)
    for key in raw:
        by_name[key[1]].append(key)
    controls, unmatched = defaultdict(list), []
    for kind in ["objects", "programs"]:
        path = root / "quality" / f"{kind}-{a.year}.json"
        if not path.exists():
            continue
        for s in json.loads(path.read_text())["section_details"]:
            if s["total_reported"] is None or s.get("duplicate_of"):
                continue
            key = (normalize(s["department"]), normalize(s["agency"]))
            match = "exact_department_and_agency_name"
            if key not in raw:
                candidates = by_name.get(key[1], [])
                if len(candidates) != 1 or not key[1]:
                    unmatched.append(s["section_id"])
                    continue
                key = candidates[0]
                match = "unique_exact_agency_name"
            controls[key].append(dict(section_id=s["section_id"], table_kind=kind,
                                       reported=s["total_reported"], match_method=match))
    results = []
    for key, value in raw.items():
        evidence = controls.get(key, [])
        totals = sorted(set(e["reported"] for e in evidence))
        if not totals:
            status = "no_printed_control_matched"
        elif len(totals) > 1:
            status = "conflicting_printed_controls"
        elif totals[0] == value["amount"]:
            status = "exact_match"
        else:
            status = "machine_and_printed_amounts_differ"
        results.append(dict(**value, status=status, printed_totals=totals, evidence=evidence))
    report = dict(year=a.year, source=str(source.relative_to(root)),
                  summary=dict(Counter(r["status"] for r in results)), agencies=results,
                  unmatched_printed_sections=unmatched,
                  note="Name matching is explicit; no amount-based matching or balancing corrections.")
    save_json(root / "quality" / f"reconciliation-{a.year}.json", report)
    print(json.dumps(dict(year=a.year, summary=report["summary"])), flush=True)


if __name__ == "__main__":
    main()
