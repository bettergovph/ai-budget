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

    region = re.compile(r"^(Region\b|National Capital Region|Cordillera|Negros Island|Bangsamoro|BARMM\b|Nationwide|CENTRAL OFFICE)", re.I)

    def name_of(r):
        """What the row changes, as on the department pages: the House bill's name for its activity, else the report's
        heading (its wrapped lines joined) up to the region; in unprogrammed appropriations, the lettered purpose."""
        if isinstance(r.house_bill_path, str) and r.house_bill_path:
            parts = r.house_bill_path.split(" > ")
            at = next((n for n, x in enumerate(parts) if region.match(x.strip())), len(parts))
            name = parts[max(0, at - 1)].strip()
            # A loan-assisted project's funding line: say which ("GOP Counterpart", "Loan Proceeds").
            if parts[-1].strip().lower() in ("gop counterpart", "loan proceeds") and name.lower() != parts[-1].strip().lower():
                prev = next((x for x in reversed(parts[:-1]) if not region.match(x.strip()) and x.strip().lower() != "central office"), name)
                return f"{prev.strip()} ({parts[-1].strip()})"
            return name
        parts = [x.strip() for x in (r.printed_heading or "").strip("[] ").split(" / ") if x.strip()]
        lettered = next((n for n, x in enumerate(parts) if re.match(r"^[A-Z]{1,2}\.\s", x)), None)
        if lettered is not None:
            parts = parts[lettered:]
        at = next((n for n, x in enumerate(parts) if region.match(x)), len(parts))
        return " ".join(parts[:at]).strip("[] ") or r.label

    def item(r):
        return {"department": r.department, "agency": r.agency, "item": name_of(r),
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
    rv = pd.DataFrame([{"house_id": r[1], "flags": [f for f in r[7] if not fl[f].get("computed")], "ins": ins_flag in r[7],
                        "docs": bin(r[8]).count("1"), "auto": r[0] in auto, "deo": ix["offices"][r[3]]["name"],
                        "districts": ix["offices"][r[3]]["districts"], "tier": ix["offices"][r[3]].get("tier")} for r in ix["rows"]])
    m = dp.merge(rv, on="house_id", how="inner")
    m["removed"] = m.status == "cut"

    def profile(x):
        return {"n": len(x), "insertion_flag": round(float(x.ins.mean()) * 100, 1),
                "five_plus_flags": round(float((x["flags"].map(len) >= 5).mean()) * 100, 1),
                "avg_flags": round(float(x["flags"].map(len).mean()), 2),
                "no_key_document": round(float((x.docs == 0).mean()) * 100, 1),
                "all_five_documents": round(float((x.docs == 5).mean()) * 100, 1)}
    out["dpwh_flags"] = {"removed": profile(m[m.removed]), "kept": profile(m[~m.removed]), "in_reviewer": len(m), "projects": len(dp)}

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
    out["checks"] = index["checks"]
    json.dump(out, open(f"{site}/report.json", "w"), indent=1, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    f = out["dpwh_flags"]
    print(f"report: DPWH removed {progs['dpwh']['status']['cut']['n']:,}, red-flag profile removed {f['removed']['insertion_flag']}% vs kept "
          f"{f['kept']['insertion_flag']}%", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
