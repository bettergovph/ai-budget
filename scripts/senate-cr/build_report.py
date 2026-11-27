"""The executive report's figures (/senate/2027/report): <site>/report.json, every number from the published
dataset (<site>/downloads/, build_downloads.py) and, for DPWH red flags and documents, the House bill reviewer's
index (data/hgab/2027/documents/review.json). Run after build_downloads.py.

Usage: build_report.py <site dir (data/senate/2027)> <data/hgab/2027>
"""
import json
import re
import os
import subprocess
import sys
from datetime import datetime, timezone

import pandas as pd


def i(v):
    return None if v is None or pd.isna(v) else int(v)


REGION = re.compile(r"^(Region\b|National Capital Region|Cordillera|Negros Island|Bangsamoro|BARMM\b|Nationwide|CENTRAL OFFICE)", re.I)

def amendment_name(r):
    """What the row changes, as on the department pages: the House bill's name for its activity, else the report's
    heading (its wrapped lines joined) up to the region; in unprogrammed appropriations, the lettered purpose."""
    if isinstance(r.house_bill_path, str) and r.house_bill_path:
        parts = r.house_bill_path.split(" > ")
        at = next((n for n, x in enumerate(parts) if REGION.match(x.strip())), len(parts))
        name = parts[max(0, at - 1)].strip()
        # A loan-assisted project's funding line: say which ("GOP Counterpart", "Loan Proceeds").
        if parts[-1].strip().lower() in ("gop counterpart", "loan proceeds") and name.lower() != parts[-1].strip().lower():
            prev = next((x for x in reversed(parts[:-1]) if not REGION.match(x.strip()) and x.strip().lower() != "central office"), name)
            return f"{prev.strip()} ({parts[-1].strip()})"
        return name
    heading = r.printed_heading if isinstance(r.printed_heading, str) else ""
    parts = [x.strip() for x in heading.strip("[] ").split(" / ") if x.strip()]
    lettered = next((n for n, x in enumerate(parts) if re.match(r"^[A-Z]{1,2}\.\s", x)), None)
    if lettered is not None:
        parts = parts[lettered:]
    at = next((n for n, x in enumerate(parts) if REGION.match(x)), len(parts))
    return " ".join(parts[:at]).strip("[] ") or r.label


# A project with at least this many of the five key documents has a "complete set" (COMPLETE_AT in src/lib/hgab-documents.ts).
COMPLETE_AT = 4
# Where a project's files come from (review.json row element 10; sourceGroup in src/lib/hgab-review.ts).
FROM_SENATE, FROM_PROPOSAL = 1, 2


def documents(ix, dp):
    """The House bill DPWH projects by their documents, as the House bill review report counts them (docTally in
    src/lib/hgab-review-report.ts: the five key documents and files from the Senate copies, DPWH Transparency, or
    either), each count with what the Senate committee report did: House bill and Senate budget, projects removed.

    Jason, 2026-11-27: "the document breakdown again ... similar to the hgab report but include the Senate numbers ...
    5 of 5, 4 of 5, 3 of 5, the tally based on the document count."

    One row per reviewer project (review.json). Six House bill rows print three projects twice; our House data merged
    each pair into one project. They keep their own House bill amounts here, and the project's Senate amount is split
    in the same shares, so the totals are the Senate DPWH totals.
    """
    unchecked = set((ix.get("unchecked") or {}).get("rows") or [])
    ins = next(k for k, f in enumerate(ix["flags"]) if f["code"] == "potential-nep-insertion")
    rows = pd.DataFrame([{
        "house_id": r[1], "hgab_id": r[0], "amount": r[6], "region": ix["regions"][r[4]], "insertion": ins in r[7],
        "either_docs": r[8], "either_files": r[9], "from": r[10] or 0,
        "senate_docs": r[11] or 0, "nep_docs": r[12] or 0, "senate_files": r[13] or 0, "nep_files": r[14] or 0,
        "unchecked": r[0] in unchecked,
    } for r in ix["rows"]])
    x = rows.merge(dp[["house_id", "status", "house_php", "senate_php"]], on="house_id", how="left", validate="many_to_one")
    assert x.status.notna().all(), f"{int(x.status.isna().sum())} reviewer projects not in the Senate DPWH rows"
    x["house"] = x.amount
    # The share first: amount × amount overflows 64-bit integers.
    share = x.amount.astype(float) / x.house_php.astype(float).where(x.house_php != 0)
    x["senate"] = (x.senate_php.astype(float) * share).fillna(x.senate_php.astype(float)).round()
    x["removed"] = x.status == "cut"
    assert x.house.sum() == dp.house_php.sum(), (int(x.house.sum()), int(dp.house_php.sum()))
    assert abs(x.senate.sum() - dp.senate_php.sum()) < len(x), (int(x.senate.sum()), int(dp.senate_php.sum()))

    def cell(y):
        return {"n": len(y), "house": i(y.house.sum()), "senate": i(y.senate.sum()),
                "removed_n": int(y.removed.sum()), "removed": i(y[y.removed].house.sum())}

    count = lambda mask: bin(int(mask)).count("1")
    checked = x[~x.unchecked]

    def level(docs, files, unch):
        return "unchecked" if unch else "complete" if count(docs) >= COMPLETE_AT else "none" if docs == 0 and files == 0 else "partial"

    by = {}
    for f in ("either", "senate", "nep"):
        k = checked[f"{f}_docs"].map(count)
        lv = x.apply(lambda r: level(r[f"{f}_docs"], r[f"{f}_files"], r.unchecked), axis=1)
        by[f] = {
            # 5 of 5 down to 0 of 5, of the projects whose documents were checked.
            "count": [cell(checked[k == c]) for c in range(5, -1, -1)],
            "levels": {v: cell(x[lv == v]) for v in ("complete", "partial", "none", "unchecked")},
            "types": [{"with": cell(checked[has]), "without": cell(checked[~has])}
                      for has in (checked[f"{f}_docs"].map(lambda v, t=t: (int(v) >> t) & 1 == 1) for t in range(len(ix["named_types"])))],
            "with_file": cell(checked[checked[f"{f}_files"] > 0]),
        }
    src = checked["from"].map(lambda v: "both" if v & FROM_SENATE and v & FROM_PROPOSAL else "senate" if v & FROM_SENATE else "nep" if v & FROM_PROPOSAL else "none")
    lv = x.apply(lambda r: level(r.either_docs, r.either_files, r.unchecked), axis=1)
    regions = []
    for reg, y in x.groupby("region"):
        ly = lv[y.index]
        regions.append({"region": reg, "all": cell(y), **{v: cell(y[ly == v]) for v in ("complete", "partial", "none")}})
    return {
        "projects": cell(x), "checked": len(checked), "named_types": ix["named_types"], "complete_at": COMPLETE_AT,
        "reviewer_built_at": ix.get("built_at"), "by": by,
        "sources": {g: cell(checked[src == g]) for g in ("senate", "nep", "both", "none")},
        "insertion": {g: {v: cell(x[(x.insertion == (g == "insertion")) & (lv == v)]) for v in ("complete", "partial", "none", "unchecked")}
                      for g in ("insertion", "nep")},
        "regions": sorted(regions, key=lambda r: -(r["all"]["removed"] or 0)),
    }


def main(site, hgab):
    d = f"{site}/downloads"
    p = pd.read_parquet(f"{d}/senate-2027-projects.parquet")
    g = pd.read_parquet(f"{d}/senate-2027-general-summary.parquet")
    a = pd.read_parquet(f"{d}/senate-2027-annex-a.parquet")
    prov = pd.read_parquet(f"{d}/senate-2027-provisions.parquet")
    index = json.load(open(f"{d}/index.json"))
    out = {"built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "dataset_built_at": index["built_at"],
           "source_commit": index["source_commit"]}
    try:
        out["source_commit"] = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        pass

    # --- The whole bill (General Summary) -----------------------------------------------------------------------------
    t = {r.department: r for r in g[g.level == "total"].itertuples()}
    amt = lambda r: {"house": i(r.house_php), "increase": i(r.increase_php), "decrease": i(r.decrease_php), "net": i(r.net_php), "senate": i(r.senate_php)}
    out["totals"] = {k: amt(t[v]) for k, v in (("total", "TOTAL NEW APPROPRIATIONS"), ("programmed", "PROGRAMMED APPROPRIATIONS"),
                                                ("unprogrammed", "UNPROGRAMMED APPROPRIATIONS"), ("departments", "DEPARTMENTS"),
                                                ("spf", "SPECIAL PURPOSE FUNDS"))}
    dep = g[g.level == "department"]
    row = lambda r: {"no": r.department_no, "name": r.department, "nep": i(r.nep_php), **amt(r)}
    out["departments"] = {
        "changed": int((dep.net_php != 0).sum()), "count": len(dep),
        "gains": [row(r) for r in dep[dep.net_php > 0].sort_values("net_php", ascending=False).head(8).itertuples()],
        "cuts": [row(r) for r in dep[dep.net_php < 0].sort_values("net_php").head(6).itertuples()],
    }

    # --- The largest single changes in Annex A (outside DPWH, which has its own section), one per printed amount -------
    c = a[(a.kind == "class") & (~a.is_total_row) & a.net_php.notna()].copy()
    c = c.drop_duplicates(["department_id", "agency", "net_php", "senate_php", "senate_page"])
    c["abs"] = c.net_php.abs()

    def item(r):
        return {"department": r.department, "agency": r.agency, "item": amendment_name(r),
                "label": r.label, "house": i(r.house_php), "net": i(r.net_php), "senate": i(r.senate_php), "status": r.status,
                "page": i(r.senate_page)}
    lines = c[~c.department_id.isin(["department-of-public-works-and-highways", "unprogrammed-appropriations"])]
    out["big_lines"] = [item(r) for r in lines.sort_values("abs", ascending=False).head(14).itertuples()]
    ua = c[c.department_id == "unprogrammed-appropriations"]
    out["unprogrammed_lines"] = [item(r) for r in ua.sort_values("abs", ascending=False).head(10).itertuples()]

    # --- The four programs ---------------------------------------------------------------------------------------------
    progs = {}
    for k, x in p[p.status != "nep_only"].groupby("program"):
        s = {st: {"n": len(y), "house": i(y.house_php.sum()), "senate": i(y.senate_php.sum()), "change": i(y.vs_house_php.sum())}
             for st, y in x.groupby("status")}
        ins = x[x.inserted_by_house]
        nep = x[~x.inserted_by_house & x.house_php.notna()]
        progs[k] = {
            "house": i(x.house_php.sum()), "senate": i(x.senate_php.sum()), "nep": i(p[p.program == k].nep_php.sum()),
            "status": s, "replaces": int(x.replaces_id.notna().sum()),
            "house_inserted": {"n": len(ins), "house": i(ins.house_php.sum()), "removed_n": int((ins.status == "cut").sum()),
                               "removed": i(ins[ins.status == "cut"].house_php.sum())},
            "nep_proposed": {"n": len(nep), "house": i(nep.house_php.sum()), "removed_n": int((nep.status == "cut").sum()),
                             "removed": i(nep[nep.status == "cut"].house_php.sum())},
        }
        reg = x.groupby("region").agg(n=("id", "size"), house=("house_php", "sum"), senate=("senate_php", "sum"),
                                      removed=("status", lambda v: int((v == "cut").sum())))
        progs[k]["regions"] = [{"region": r.Index, "n": int(r.n), "house": i(r.house), "senate": i(r.senate), "removed_n": int(r.removed)}
                               for r in reg.itertuples()]
    out["programs"] = progs

    # --- DPWH ------------------------------------------------------------------------------------------------------
    dp = p[(p.program == "dpwh") & (p.status != "nep_only")].copy()
    raised = dp[dp.status == "raised"].sort_values("vs_house_php", ascending=False)
    out["dpwh_raised"] = [{"title": r.title, "nep": i(r.nep_php), "house": i(r.house_php), "senate": i(r.senate_php),
                           "change": i(r.vs_house_php), "page": i(r.senate_page), "id": r.id} for r in raised.itertuples()]
    pl = dp.groupby("program_line").agg(n=("id", "size"), house=("house_php", "sum"), senate=("senate_php", "sum"),
                                        removed=("status", lambda v: int((v == "cut").sum())))
    out["dpwh_program_lines"] = sorted([{"line": r.Index, "n": int(r.n), "house": i(r.house), "senate": i(r.senate), "removed_n": int(r.removed)}
                                        for r in pl.itertuples()], key=lambda r: r["senate"] - r["house"])
    is_mpb = dp.title.str.contains("multi-purpose|multipurpose|multi purpose", case=False) | \
        dp.house_title.fillna("").str.contains("multi-purpose|multipurpose|multi purpose", case=False)
    mpb = dp[is_mpb]
    mi = mpb[mpb.inserted_by_house]
    out["dpwh_mpb"] = {"n": len(mpb), "house": i(mpb.house_php.sum()), "senate": i(mpb.senate_php.sum()),
                       "removed_n": int((mpb.status == "cut").sum()), "removed": i(mpb[mpb.status == "cut"].house_php.sum()),
                       "inserted_n": len(mi), "inserted": i(mi.house_php.sum()), "inserted_removed_n": int((mi.status == "cut").sum()),
                       "inserted_removed": i(mi[mi.status == "cut"].house_php.sum())}

    # Red flags and documents (the reviewer's index), removed vs kept.
    ix = json.load(open(f"{hgab}/documents/review.json"))
    fl = ix["flags"]
    ins_flag = next(n for n, f in enumerate(fl) if f["code"] == "potential-nep-insertion")
    auto = (ix.get("auto") or {}).get("rows", {})
    unchecked = set((ix.get("unchecked") or {}).get("rows") or [])
    rv = pd.DataFrame([{"house_id": r[1], "flags": [f for f in r[7] if not fl[f].get("computed")], "ins": ins_flag in r[7],
                        "docs": bin(r[8]).count("1"), "auto": r[0] in auto, "deo": ix["offices"][r[3]]["name"],
                        "districts": ix["offices"][r[3]]["districts"], "tier": ix["offices"][r[3]].get("tier"),
                        "unchecked": r[0] in unchecked} for r in ix["rows"]])
    # One row per Senate project: three projects are printed twice in the House bill (two reviewer rows each), and a
    # second row would count their budget twice.
    m = dp.merge(rv.drop_duplicates("house_id"), on="house_id", how="inner", validate="one_to_one")
    m["removed"] = m.status == "cut"
    # The red-flag profile reads the projects whose documents were checked (296 lines outside research.bettergov.ph's
    # document check read "no documents" because nobody looked).
    mc = m[~m.unchecked]

    def profile(x):
        return {"n": len(x), "insertion_flag": round(float(x.ins.mean()) * 100, 1),
                "five_plus_flags": round(float((x["flags"].map(len) >= 5).mean()) * 100, 1),
                "avg_flags": round(float(x["flags"].map(len).mean()), 2),
                "no_key_document": round(float((x.docs == 0).mean()) * 100, 1),
                "all_five_documents": round(float((x.docs == 5).mean()) * 100, 1)}
    out["dpwh_flags"] = {"removed": profile(mc[mc.removed]), "kept": profile(mc[~mc.removed]), "in_reviewer": len(mc), "projects": len(dp)}
    out["dpwh_documents"] = documents(ix, dp)

    # Offices that lose the largest part of their House bill DPWH budget (district engineering offices only).
    house_by = m.groupby("deo").house_php.sum()
    rem = m[m.removed & (m.deo != "Central Office")].groupby("deo").agg(n=("id", "size"), removed=("house_php", "sum"))
    rem["house"] = rem.index.map(house_by)
    meta = m.drop_duplicates("deo").set_index("deo")
    offices = [{"office": o, "districts": list(meta.loc[o, "districts"]), "tier": meta.loc[o, "tier"], "removed_n": int(r.n),
                "removed": i(r.removed), "house": i(r.house)} for o, r in rem.sort_values("removed", ascending=False).head(10).iterrows()]
    out["dpwh_offices"] = offices
    co = m[m.deo == "Central Office"]
    out["dpwh_central_office"] = {"house": i(co.house_php.sum()), "senate": i(co.senate_php.sum()),
                                  "removed_n": int(co.removed.sum()), "removed": i(co[co.removed].house_php.sum())}

    # --- HFEP by kind, FMR/NIA insertions that replace removed projects ------------------------------------------------
    hf = p[(p.program == "hfep") & (p.status != "nep_only")]
    out["hfep_kinds"] = [{"kind": k, "n": int((y.vs_house_php != 0).sum()), "change": i(y.vs_house_php.sum())}
                         for k, y in hf.groupby("pap") if i(y.vs_house_php.sum())]

    # --- Provisions -------------------------------------------------------------------------------------------------
    out["provisions"] = {"n": len(prov), "general": int((prov.part == "general").sum()),
                         "by_department": [{"department": k, "n": int(v)} for k, v in prov.department.value_counts().head(6).items()]}
    # The dataset's checks, by kind: the totals and arithmetic (a failure stops the build), and the page links.
    rows = index.get("check_rows", [])
    totals_rows = [c for c in rows if c.get("blocking", True)]
    page_rows = [c for c in rows if not c.get("blocking", True)]
    out["checks"] = {**index["checks"], "totals_run": len(totals_rows), "totals_passed": sum(c["ok"] for c in totals_rows),
                     "page_links": sum(int(c["printed"]) for c in page_rows), "page_links_ok": sum(int(c["ours"]) for c in page_rows)}
    json.dump(out, open(f"{site}/report.json", "w"), indent=1, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    f = out["dpwh_flags"]
    print(f"report: DPWH removed {progs['dpwh']['status']['cut']['n']:,}, red-flag profile removed {f['removed']['insertion_flag']}% vs kept "
          f"{f['kept']['insertion_flag']}%", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
