"""Arithmetic checks on parse_annex_a.py output.

1. Every row: gab + inc + dec = sv and inc + dec = net (blank = 0).
2. Every agency: its printed net change = the sum of its TOTAL rows (by activity/project)
   and = the sum of its object rows (by object of expenditure), when the agency prints that view.
Usage: check_annex_a.py <annex_a.json>
"""
import json
import sys
from collections import defaultdict

recs = [r for r in json.load(open(sys.argv[1])) if r["kind"] != "section"]
z = lambda v: v or 0
bad = 0
for r in recs:
    if z(r["gab"]) + z(r["inc"]) + z(r["dec"]) != z(r["sv"]) or z(r["inc"]) + z(r["dec"]) != z(r["net"]):
        bad += 1
        if bad <= 25:
            print("ROW", r["pdf_page"], r["dept_no"], r["agency_no"], r["hb_page"], r["hb_line"], r["label"][:50],
                  [r[k] for k in ("gab", "inc", "dec", "net", "sv")])
print(f"row arithmetic: {len(recs) - bad}/{len(recs)} ok")

ag = {}
tot = defaultdict(int)
obj = defaultdict(int)
nobj = defaultdict(int)
ntot = defaultdict(int)
for r in recs:
    k = (r["dept_no"], r["agency_no"])
    if r.get("subtotal"):
        continue
    if r["kind"] == "agency_total":
        ag[k] = r
    elif r["kind"] == "class" and r["label"].upper().strip() == "TOTAL":
        tot[k] += z(r["net"]); ntot[k] += 1
    elif r["kind"] == "object":
        obj[k] += z(r["net"]); nobj[k] += 1
ok = 0
for k, r in ag.items():
    want = z(r["net"])
    t_ok = tot[k] == want or ntot[k] == 0
    o_ok = obj[k] == want or nobj[k] == 0
    if t_ok and o_ok:
        ok += 1
    else:
        print("AGENCY", k, r["agency"][:40], "net", want, "| totals", tot[k], f"({ntot[k]})", "| objects", obj[k], f"({nobj[k]})", "p", r["pdf_page"])
print(f"agency checks: {ok}/{len(ag)} ok")
