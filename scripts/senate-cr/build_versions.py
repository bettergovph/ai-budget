"""The Senate committee report version of every House bill project in our four program datasets.

For each program (dpwh, fmr, nia, hfep) writes <out>/<program>_senate.csv: one row per House bill project
in data/hgab/2027/<program>/projects.parquet (keyed by our `id`), plus one row per Senate insertion.
A House project the Senate annex does not list is unchanged (the annexes list every changed or renamed row).

  status       unchanged | renamed | cut (to zero) | reduced | raised | added (Senate-only row)
  hb_php       House bill (3rd reading) amount, from our data
  senate_php   committee report amount
  senate_title the committee report's name (its "Revised Project Name" / description), else the House name
  replaces_id  for a Senate insertion that revises a cut House row (FMR), that row's id

Each file's Senate total is checked against the annex's printed committee-report total.
Usage: build_versions.py <senate-cr out dir> <data/hgab/2027> <out dir>
"""
import csv
import json
import sys

import duckdb

# Printed committee-report totals of the four annexes (pesos), and the House totals they start from.
EXPECT = {
    "dpwh": (587_075_661_000, 520_876_384_250),   # Annex A-4, "OPERATIONS" (the projects; GAS/STO are in Annex A)
    "fmr": (19_628_100_000, 16_000_000_000),      # Annex A-1
    "nia": (17_999_305_000, 17_748_181_000),      # Annex A-3, grand total
    "hfep": (10_021_659_000, 15_513_059_000),     # Annex A HFEP CO line; Annex A-2 lists the +5,491,400,000
}


def status(hb, sv, renamed):
    if hb is None or hb == 0:
        return "added"
    if sv == 0:
        return "cut"
    if sv < hb:
        return "reduced"
    if sv > hb:
        return "raised"
    return "renamed" if renamed else "unchanged"


def main(src, hgab, out):
    con = duckdb.connect()
    summary = {}
    for prog, mapped in (("dpwh", "annex_a4_mapped.csv"), ("fmr", "annex_a1_fmr_mapped.csv"),
                         ("nia", "annex_a3_nia_mapped.csv"), ("hfep", "annex_a2_hfep_mapped.csv")):
        hb = con.execute(f"""select id, title, region, office, program, pap, hgab3_php
                             from '{hgab}/{prog}/projects.parquet' where hgab3_php is not null""").fetchall()
        rows = {h[0]: {"id": h[0], "hb_title": h[1], "region": h[2] or "", "office": h[3] or "", "program": h[4] or "",
                       "pap": h[5] or "", "hb_php": h[6], "senate_php": h[6], "senate_title": h[1],
                       "status": "unchanged", "replaces_id": "", "senate_pdf_page": "", "match": ""} for h in hb}
        extra = []
        sen = list(csv.DictReader(open(f"{src}/{mapped}")))
        if prog == "hfep":
            for r in sen:
                i = r["hgab_id"]
                if i:
                    x = rows[i]
                    x["senate_php"] += int(r["senate_change_php"])
                    x["senate_pdf_page"], x["match"] = r["senate_pdf_page"], r["match"]
                else:
                    extra.append({"id": "", "hb_title": "", "region": r["region"], "office": r["province"],
                                  "program": r["category"], "pap": r["component"], "hb_php": 0,
                                  "senate_php": int(r["senate_change_php"]), "senate_title": r["facility"],
                                  "replaces_id": "", "senate_pdf_page": r["senate_pdf_page"], "match": "new"})
        else:
            split = {}
            for r in sen:
                i = r["hgab_id"]
                if i and r["match"] == "house_row_split":
                    split.setdefault(i, []).append(r)
                    continue
                if i:
                    x = rows[i]
                    x["senate_php"] = int(r["senate_php"] or 0)
                    # Matched only by a unique amount: the annex prints this title twice over itself, so it reads as
                    # garbage; the House name stands (the report doesn't rename it legibly).
                    x["senate_title"] = x["hb_title"] if r["match"] == "amount_unique" else (r["senate_title"] or x["hb_title"])
                    x["senate_pdf_page"], x["match"] = r["senate_pdf_page"], r["match"]
                    # NIA's House rows carry no region (the House bill lists them by sub-program); the annex prints
                    # each under its region.
                    if not x["region"] and r.get("region"):
                        x["region"] = r["region"]
                    x["_renamed"] = r.get("renamed") == "1" and r["match"] != "amount_unique"
                elif r["match"] in ("new",) or not int(r.get("hb_php") or 0):
                    extra.append({"id": "", "hb_title": "", "region": r.get("region", ""), "office": r.get("office", "") or r.get("province", ""),
                                  "program": "", "pap": "", "hb_php": 0, "senate_php": int(r["senate_php"] or 0),
                                  "senate_title": r["senate_title"], "replaces_id": r.get("replaces_hgab_id", ""),
                                  "senate_pdf_page": r["senate_pdf_page"], "match": "new"})
                else:
                    print(f"  {prog}: unmatched Senate row left out: {r['hb_title'][:80]}", file=sys.stderr)
            for i, parts in split.items():  # one House row of ours = several printed lines
                x = rows[i]
                x["senate_php"] = sum(int(p["senate_php"] or 0) for p in parts)
                x["senate_pdf_page"], x["match"] = parts[0]["senate_pdf_page"], "house_row_split"
        for x in rows.values():
            x["status"] = status(x["hb_php"], x["senate_php"], x.pop("_renamed", False))
        for x in extra:
            x["status"] = "added"
        allrows = list(rows.values()) + extra
        hb_total = sum(x["hb_php"] or 0 for x in allrows)
        sv_total = sum(x["senate_php"] or 0 for x in allrows)
        want_hb, want_sv = EXPECT[prog]
        ok = hb_total == want_hb and sv_total == want_sv
        counts = {}
        for x in allrows:
            counts[x["status"]] = counts.get(x["status"], 0) + 1
        summary[prog] = {"house_php": hb_total, "senate_php": sv_total, "rows": len(allrows), "status": counts,
                         "matches_annex_totals": ok}
        print(f"{prog}: House {hb_total:,} (annex {want_hb:,}), Senate {sv_total:,} (annex {want_sv:,}) "
              f"{'OK' if ok else 'MISMATCH'}; {counts}", file=sys.stderr)
        cols = ["id", "status", "hb_title", "senate_title", "region", "office", "program", "pap", "hb_php",
                "senate_php", "replaces_id", "match", "senate_pdf_page"]
        with open(f"{out}/{prog}_senate.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(allrows)
    json.dump(summary, open(f"{out}/programs_summary.json", "w"), indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:4])
