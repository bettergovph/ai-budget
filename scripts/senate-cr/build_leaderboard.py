"""The Senate leaderboards' data (/senate/2027/leaderboard): <site>/leaderboard.json.

Jason, 2026-11-21: "Next is work on leaderboards, our reports are a good start." The boards rank what the executive
report analyses, with the House bill leaderboards' units and rules (src/lib/hgab-leaderboard.ts):

- DPWH boards rank the House leaderboard's groups of district engineering offices and the legislative districts they
  serve (one district = Tier A, Lone; several = Tier B, Shared; a shared office is never split), with the same people.
  Each office's projects are the Senate DPWH rows (senate/2027/dpwh/projects.parquet) under the label the House bill
  lists for it (districts.json, the office's 2027 hgab3 `matched_label`). Rows under no ranked office (Central
  Office, regional offices) are carried as `outside`, never ranked.
- Whole-bill boards rank departments, agencies (the General Summary) and budget lines (Annex A, outside DPWH) by the
  Senate's change, with no offices, districts or people.

The file has LeaderboardData's shape (entries, regions, totals, whole_bill) so the House board pieces can draw it;
each entry and region also carries a `senate` block. Integer pesos; null is "no figure".

Usage: build_leaderboard.py <site dir (data/senate/2027)> <data/hgab/2027>
"""
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone

import duckdb
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_report import amendment_name  # noqa: E402

EXPLORER = "/senate/2027/explorer"
SMALL = {"of", "the", "and", "for", "in", "on", "to", "a", "an", "at", "by", "or"}
ACRONYM = {"DPWH", "DSWD", "DOH", "DA", "DOTR", "DEPED", "DILG", "SUCS", "AFP", "NEDA", "DICT", "DOST", "DTI", "DOE", "DENR",
           "DOLE", "DFA", "DOF", "DBM", "DOJ", "DND", "DAR", "DHSUD", "DMW", "DOT", "PCO", "OVP", "COA", "CSC", "CHR", "LGUS", "II"}


def title(s):
    """The General Summary's capitals in title case, keeping acronyms."""
    if not s or s != s.upper():
        return s
    out = []
    for i, w in enumerate(s.lower().split()):
        bare = w.strip(",.()").upper()
        out.append(w.upper() if bare in ACRONYM else w if i and w in SMALL else w[:1].upper() + w[1:])
    return " ".join(out)


def i(v):
    return None if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NA else int(v)


def block(rows):
    """The Senate figures of a set of project rows (House bill rows and NEP-only rows)."""
    h = rows[rows.house_php.notna()]
    cut = h[h.status == "cut"]
    ins = h[h.nep_php.isna()]
    ins_cut = ins[ins.status == "cut"]
    ins_kept = ins[ins.status != "cut"]
    raised = h[h.status == "raised"]
    house = int(h.house_php.sum())
    return {
        "projects": len(h), "house_php": house, "senate_php": int(h.senate_php.sum()),
        "nep_php": int(rows.nep_php.fillna(0).sum()) if rows.nep_php.notna().any() else None,
        "change_php": int(h.senate_php.sum()) - house,
        "removed_php": int(cut.house_php.sum()), "removed_rows": len(cut),
        "removed_share": round(float(cut.house_php.sum()) / house * 100, 2) if house else None,
        "inserted_php": int(ins.house_php.sum()), "inserted_rows": len(ins),
        "inserted_removed_php": int(ins_cut.house_php.sum()), "inserted_removed_rows": len(ins_cut),
        "inserted_kept_php": int(ins_kept.senate_php.sum()), "inserted_kept_rows": len(ins_kept),
        "raised_php": int((raised.senate_php - raised.house_php).sum()), "raised_rows": len(raised),
        "renamed_rows": int((h.status == "renamed").sum()),
    }


def add(a, b):
    out = {}
    for k, v in a.items():
        if k == "removed_share":
            continue
        out[k] = (v or 0) + (b.get(k) or 0) if (v is not None or b.get(k) is not None) else None
    out["removed_share"] = round(out["removed_php"] / out["house_php"] * 100, 2) if out.get("house_php") else None
    return out


def senate_href(href):
    """A House bill district page's address as the Senate district page's (same district id)."""
    return href.replace("/hgab/2027/districts/", "/senate/2027/districts/", 1) if href and href.startswith("/hgab/2027/districts/") else href


def main(site, hgab):
    house_lb = json.load(open(f"{hgab}/leaderboard.json"))
    districts = json.load(open(f"{hgab}/districts.json"))
    label_of = {o["id"]: next((y.get("matched_label") for y in o.get("years", []) if y.get("stage") == "hgab3" and y.get("fy") == 2027), None)
                for o in (districts["offices"].values() if isinstance(districts["offices"], dict) else districts["offices"])}
    rows = duckdb.sql(f"select id, status, office, region, nep_php, house_php, senate_php from '{site}/dpwh/projects.parquet'").df()
    by_label = {lab: g for lab, g in rows.groupby(rows.office.fillna(""))}

    entries, used = [], set()
    for e in house_lb["entries"]:
        labels = [label_of.get(o["id"]) for o in e["offices"]]
        labels = [x for x in labels if x]
        for x in labels:
            if x in used:
                raise SystemExit(f"office label {x} in two entries")
            used.add(x)
        sub = pd.concat([by_label[x] for x in labels if x in by_label]) if any(x in by_label for x in labels) else rows.iloc[0:0]
        # Places link to the Senate district pages (/senate/2027/districts, build_districts.py), not the House bill's.
        entries.append({**e, "href": senate_href(e.get("href")), "people": [{**p, "href": senate_href(p.get("href"))} for p in e.get("people", [])],
                        "senate": block(sub)})

    outside = rows[~rows.office.fillna("").isin(used)]
    central = outside[outside.office == "Central Office"]
    other = outside[outside.office != "Central Office"]
    all_block = block(rows)
    deo = block(rows[rows.office.fillna("").isin(used)])
    # Every row is in one ranked entry or outside: the figures tie out to the whole program.
    for k in ("house_php", "senate_php", "removed_php", "inserted_php"):
        tie = sum(x["senate"][k] for x in entries) + block(outside)[k]
        if tie != all_block[k]:
            raise SystemExit(f"{k}: entries + outside {tie} != all {all_block[k]}")

    regions = []
    for reg in house_lb["regions"]:
        es = [x for x in entries if x["region"] == reg["region"]]
        s = es[0]["senate"] if es else None
        for x in es[1:]:
            s = add(s, x["senate"])
        regions.append({**reg, "senate": s})

    # Whole bill: General Summary departments and agencies, Annex A lines (DPWH has its own boards).
    gs = json.load(open(f"{site}/departments.json"))
    dep_rows, agency_rows = [], []
    for d in gs["departments"]:
        if not d.get("roman"):
            continue
        href = f"{EXPLORER}/{d['id']}" if d.get("id") else EXPLORER
        house, senate = d.get("house") or 0, d.get("senate") or 0
        dep_rows.append({"label": title(d["name"]), "sub": f"General Summary, {d['roman']}", "nep_php": d.get("nep") or 0,
                         "hgab3_php": house, "senate_php": senate, "delta_php": senate - house,
                         "delta_pct": round((senate - house) / house * 100, 2) if house else None, "href": href})
        ags = d.get("agencies") or []
        for a in ags:
            no = a.get("no") or ""
            if not no.isalpha():
                continue
            # A lettered heading over sub-agencies (government corporations under "F. DEPARTMENT OF HEALTH"): rank the
            # sub-agencies, which add up to it, not the heading.
            kids = [k for k in ags if (k.get("no") or "").startswith(no + ".")]
            for x, sub in ([(k, f"{title(a['name'])} · {title(d['name'])}") for k in kids] if kids else [(a, title(d["name"]))]):
                ah, asn = x.get("house") or 0, x.get("senate") or 0
                agency_rows.append({"label": title(x["name"]), "sub": sub, "nep_php": 0, "hgab3_php": ah, "senate_php": asn,
                                    "delta_php": asn - ah, "delta_pct": round((asn - ah) / ah * 100, 2) if ah else None, "href": href})
    a = pd.read_parquet(f"{site}/downloads/senate-2027-annex-a.parquet")
    c = a[(a.kind == "class") & (~a.is_total_row) & a.net_php.notna() & (a.department_id != "department-of-public-works-and-highways")]
    c = c.drop_duplicates(["department_id", "agency", "net_php", "senate_php", "senate_page"])
    line_rows = []
    for r in c.itertuples():
        house, senate, nep = i(r.house_php), i(r.senate_php), i(r.nep_php)
        line_rows.append({"label": title(amendment_name(r)), "sub": " · ".join(x for x in (title(r.department), r.agency, r.label) if isinstance(x, str) and x),
                          "nep_php": nep or 0, "hgab3_php": house or 0, "senate_php": senate or 0, "delta_php": i(r.net_php),
                          "delta_pct": round(r.net_php / house * 100, 2) if house else None,
                          "href": f"{EXPLORER}/{r.department_id}", "status": "senate_new" if house is None else None,
                          "page": i(r.senate_page)})

    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        commit = ""
    out = {
        "schema": house_lb["schema"], "fiscal_year": 2027, "dataset": "dpwh",
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source_commit": commit,
        "totals": {**house_lb["totals"], "senate": {"all": all_block, "deo": deo, "central": block(central), "other": block(other)}},
        "entries": entries, "regions": regions,
        "credits": house_lb["credits"],
        "notes": [
            "Amounts belong to DPWH offices, not to people. The representative shown holds the legislative district’s seat in the 20th Congress.",
            "The Senate committee report changes amounts; it does not say why it removes or raises a project, or who asked for it.",
            "The NEP, the House bill and the Senate committee report are versions of one budget: compare them, never add them.",
            "Under citizen review: confirm a figure on its page of the committee report before you cite it.",
        ],
        "whole_bill": {"schema": 1, "built_at": gs.get("built_at"),
                       "scope": {"hgab3_php": sum(r["hgab3_php"] for r in dep_rows), "nep_php": sum(r["nep_php"] for r in dep_rows),
                                 "unprogrammed_php": 0, "line_groups": len(line_rows)},
                       "departments": dep_rows, "agencies": agency_rows, "lines": line_rows},
    }
    json.dump(out, open(f"{site}/leaderboard.json", "w"), ensure_ascii=False, separators=(",", ":"))
    top = sorted(entries, key=lambda x: -x["senate"]["removed_php"])[0]
    print(f"leaderboard: {len(entries)} office groups, {len(regions)} regions, {len(dep_rows)} departments, {len(agency_rows)} agencies, "
          f"{len(line_rows)} lines; most removed {top['offices'][0]['name']} {top['senate']['removed_php']:,}; "
          f"outside {block(outside)['removed_php']:,} removed", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
