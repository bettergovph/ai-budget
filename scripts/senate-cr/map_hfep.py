"""Join Annex A-2 (HFEP facilities in the Senate committee report) to our House bill HFEP rows.

Annex A-2 is the committee's net change to HFEP (it equals the +P5.49B net change on the HFEP line in
Annex A), listed by facility and component (infrastructure, medical equipment, motor vehicle). Each
facility-component amount is either added to a House row for the same facility and component, or is a
facility the House bill does not fund.

Usage: map_hfep.py <annex_a2_hfep.json> <hfep projects.parquet> <out.csv>
match: same_name   House row with the same facility name (letters and digits) and component
       similar     House row in the same region, same component, distinctive name words (not "District
                   Hospital" etc.) >= 88 similar, same kind of facility (hospital / RHU / health center)
       new         no House row for that facility and component
"""
import csv
import json
import re
import sys

import duckdb
from rapidfuzz import fuzz

COMP = {"infrastructure": "Infrastructure", "medical_equipment": "Medical equipment", "motor_vehicle": "Motor vehicle"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


GENERIC = re.compile(r"\b(district|provincial|general|memorial|medical|center|centre|hospital|community|municipal|"
                     r"health|unit|rural|super|barangay|station|primary|care|facility|polyclinic|infirmary|and|of|the)\b",
                     re.I)


def distinct(s):
    return re.sub(r"\s+", " ", GENERIC.sub(" ", re.sub(r"[^\w\s]", " ", s or ""))).strip().lower()


def ftype(s):
    s = (s or "").lower()
    for t, words in (("hospital", ("hospital", "sanitarium", "medical center")), ("rhu", ("rural health", "rhu")),
                     ("health center", ("health center", "health station", "bhs", "shc", "pcf", "primary care"))):
        if any(w in s for w in words):
            return t
    return "other"


def region_key(s):
    s = (s or "").lower()
    m = re.search(r"region\s*([ivx]+(-?[ab])?|\d+)", s)
    if m:
        return m.group(1).replace("-", "")
    for k in ("ncr", "national capital", "car", "cordillera", "barmm", "bangsamoro", "negros island", "nir"):
        if k in s:
            return k[:3]
    return s


def main(annex, parquet, out):
    rows = [r for r in json.load(open(annex)) if r["kind"] == "facility"]
    con = duckdb.connect()
    hb = [dict(zip(("id", "title", "region", "pap", "php"), h)) for h in con.execute(
        f"select id, title, region, pap, hgab3_php from '{parquet}' where hgab3_php is not null").fetchall()]
    out_rows = []
    stats = {}
    for r in rows:
        for comp, label in COMP.items():
            amt = r[comp]
            if not amt:
                continue
            cands = [h for h in hb if h["pap"] == label]
            same = [h for h in cands if norm(h["title"]) == norm(r["name"])]
            how, h = None, None
            if same:
                same.sort(key=lambda h: region_key(h["region"]) != region_key(r["region"]))
                how, h = "same_name", same[0]
            else:
                sc = sorted(((fuzz.ratio(distinct(r["name"]), distinct(h["title"])), h) for h in cands
                             if region_key(h["region"]) == region_key(r["region"]) and ftype(h["title"]) == ftype(r["name"])),
                            key=lambda t: -t[0])
                if sc and sc[0][0] >= 88 and distinct(r["name"]):
                    how, h = "similar", sc[0][1]
            how = how or "new"
            stats[how] = stats.get(how, 0) + 1
            out_rows.append({
                "senate_pdf_page": r["pdf_page"], "category": r["category"], "subcategory": r["subcategory"],
                "region": r["region"], "province": r["province"], "facility": r["name"], "component": label,
                "senate_change_php": amt, "match": how,
                "hgab_id": h["id"] if h else "", "hgab_title": h["title"] if h else "",
                "hgab_php": h["php"] if h else "", "senate_php": (h["php"] if h else 0) + amt,
            })
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0]))
        w.writeheader()
        w.writerows(out_rows)
    print(stats, f"{len(out_rows)} facility-components, net {sum(r['senate_change_php'] for r in out_rows):,}",
          file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:4])
