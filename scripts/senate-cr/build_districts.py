"""The Senate district pages' data (/senate/2027/districts): <site>/districts.json.

Jason, 2026-11-23: "Next is do the district, similar to HGAB's district pages." The pages mirror the House bill's
district pages (/hgab/2027/districts) and read the House district index (data/hgab/2027/districts.json: offices,
districts, representatives, tiers) beside this file, which adds the Senate committee report for each DPWH office:

- Each office's projects are the Senate DPWH rows (senate/2027/dpwh/projects.parquet) under the label the House bill
  lists for it (the office's 2027 hgab3 `matched_label`), as the Senate leaderboards join them. The lines the House
  pages hold out of every district (office changed between the NEP and the House bill; no office) are held out here
  too, so each office's House figure equals the House index's `fy2027.hgab3_php` to the peso (checked).
- Per office: House bill and Senate amounts, the report's status (unchanged, renamed, cut to ₱0, reduced, raised), the
  House insertions (the House index's own rule: comparison traces house_only_candidate, fuzzy_candidate, ambiguous) cut
  and kept, and its largest cut projects.
- `residual`: the money on no district card, as the House index splits it (Central Office, regional offices, offices
  we could not place, office change, no office), for the House bill and the Senate; it ties out to the program.
- `regions`: each region's offices counted once, as the House page's region table.
- `placed`: projects placed in a legislative district (data/hgab/2027/locations.json), for the Legislative Districts view.

Integer pesos; the build stops on any check that fails.

Usage: build_districts.py <site dir (data/senate/2027)> <data/hgab/2027>
"""
import json
import subprocess
import sys
from datetime import datetime, timezone

import duckdb

HELD_TRACES = ("house_only_candidate", "fuzzy_candidate", "ambiguous")
STATUSES = ("unchanged", "renamed", "cut", "reduced", "raised")
TOP_CUT = 8


def ensure(ok, msg):
    if not ok:
        raise SystemExit(f"build_districts: {msg}")


def tally():
    return {"rows": 0, "house_php": 0, "senate_php": 0}


def add(t, r):
    t["rows"] += 1
    t["house_php"] += int(r["house_php"])
    t["senate_php"] += int(r["senate_php"])


def office_block():
    return {
        "rows": 0, "house_php": 0, "senate_php": 0,
        "status": {s: tally() for s in STATUSES},
        # House insertions: cut (at House amounts) and kept (at the report's amounts).
        "inserted": {"rows": 0, "house_php": 0, "cut_rows": 0, "cut_php": 0, "kept_rows": 0, "kept_php": 0},
        "top_cut": [],
    }


def put(b, r, inserted):
    b["rows"] += 1
    b["house_php"] += int(r["house_php"])
    b["senate_php"] += int(r["senate_php"])
    add(b["status"][r["status"]], r)
    if inserted:
        i = b["inserted"]
        i["rows"] += 1
        i["house_php"] += int(r["house_php"])
        if r["status"] == "cut":
            i["cut_rows"] += 1
            i["cut_php"] += int(r["house_php"])
        else:
            i["kept_rows"] += 1
            i["kept_php"] += int(r["senate_php"])


def main(site, hgab):
    D = json.load(open(f"{hgab}/districts.json"))
    offices = D["offices"]
    label_of = {oid: next((y.get("matched_label") for y in o.get("years", []) if y.get("stage") == "hgab3" and y.get("fy") == 2027), None)
                for oid, o in offices.items()}
    office_of_label = {}
    for oid, lab in label_of.items():
        if lab:
            ensure(lab not in office_of_label, f"office label {lab} on two offices")
            office_of_label[lab] = oid
    held = {"office_change": set(D["office_change"]["row_ids"]), "no_office": set(D["no_office"]["row_ids"])}

    rows = duckdb.sql(f"""
        SELECT s.house_id, s.status, s.office, s.hb_title, s.house_php, s.senate_php, h.trace
        FROM '{site}/dpwh/projects.parquet' s
        LEFT JOIN '{hgab}/dpwh/projects.parquet' h ON h.id = s.house_id
        WHERE s.house_php IS NOT NULL""").df()
    ensure(rows.trace.notna().all(), "a Senate row has no House bill row")
    ensure(set(rows.status) <= set(STATUSES), f"unknown statuses {set(rows.status) - set(STATUSES)}")
    ensure(((rows.status == "cut") == (rows.senate_php == 0)).all(), "a cut row is not at ₱0, or a kept row is")

    by_office = {oid: office_block() for oid in offices}
    cut_rows = {oid: [] for oid in offices}
    residual = {k: tally() for k in ("central_office", "regional_offices", "unmatched", "office_change", "no_office")}
    unmatched_labels = set()
    for r in rows.to_dict("records"):
        hid = r["house_id"]
        if hid in held["office_change"]:
            add(residual["office_change"], r)
            continue
        if hid in held["no_office"]:
            add(residual["no_office"], r)
            continue
        oid = office_of_label.get(r["office"] or "")
        if oid:
            put(by_office[oid], r, r["trace"] in HELD_TRACES)
            if r["status"] == "cut":
                cut_rows[oid].append((int(r["house_php"]), hid, r["hb_title"]))
        elif r["office"] == "Central Office":
            add(residual["central_office"], r)
        elif r["office"] and "Regional Office" in r["office"]:
            add(residual["regional_offices"], r)
        else:
            add(residual["unmatched"], r)
            unmatched_labels.add(r["office"] or "")
    for oid, cs in cut_rows.items():
        by_office[oid]["top_cut"] = [[hid, title, php] for php, hid, title in sorted(cs, key=lambda x: (-x[0], x[1]))[:TOP_CUT]]

    # Each office's House figure is the House index's, to the peso.
    off = [oid for oid, o in offices.items() if by_office[oid]["house_php"] != (o.get("fy2027") or {}).get("hgab3_php", 0)]
    ensure(not off, f"{len(off)} offices' House figure differs from districts.json: {off[:3]}")
    # The money on no card, as the House index splits it for the House bill.
    h27 = next(x for x in D["residual"] if x["fy"] == 2027 and x["stage"] == "hgab3")
    deo = {k: sum(b[k] for b in by_office.values()) for k in ("rows", "house_php", "senate_php")}
    for k, hk in (("central_office", "central_office_php"), ("regional_offices", "regional_offices_php"), ("unmatched", "unmatched_php"),
                  ("office_change", "office_change_php"), ("no_office", "no_office_php")):
        ensure(residual[k]["house_php"] == h27[hk], f"residual {k}: House {residual[k]['house_php']} != districts.json {h27[hk]}")
    ensure(deo["house_php"] == h27["deo_php"], f"offices' House {deo['house_php']} != districts.json deo {h27['deo_php']}")
    total = {k: deo[k] + sum(x[k] for x in residual.values()) for k in ("rows", "house_php", "senate_php")}
    prog = json.load(open(f"{site}/dpwh/summary.json"))
    ensure(total["house_php"] == h27["total_php"] == prog["house_php"] and total["senate_php"] == prog["senate_php"],
           f"offices + residual ({total['house_php']}, {total['senate_php']}) != the program ({prog['house_php']}, {prog['senate_php']})")

    # Regions: each office once, in its region (the House page's region table).
    regions = {}
    for oid, o in offices.items():
        reg = regions.setdefault(o["region"], {"offices": 0, "districts": set(), "rows": 0, "house_php": 0, "senate_php": 0, "cut_rows": 0, "cut_php": 0})
        b = by_office[oid]
        reg["offices"] += 1
        reg["districts"].update(o.get("district_ids", []))
        for k in ("rows", "house_php", "senate_php"):
            reg[k] += b[k]
        reg["cut_rows"] += b["status"]["cut"]["rows"]
        reg["cut_php"] += b["status"]["cut"]["house_php"]
    regions = {k: {**v, "districts": len(v["districts"])} for k, v in regions.items()}
    ensure(sum(v["house_php"] for v in regions.values()) == deo["house_php"], "regions do not add up to the offices")

    # Projects placed in a legislative district (locations.json), for the Legislative Districts view.
    L = json.load(open(f"{hgab}/locations.json"))
    dist_of = {x["id"]: x["district"] for x in L["lines"] if x.get("district")}
    placed = {}
    for r in rows.to_dict("records"):
        d = dist_of.get(r["house_id"])
        if not d:
            continue
        p = placed.setdefault(d, {"rows": 0, "house_php": 0, "senate_php": 0, "cut_rows": 0, "cut_php": 0})
        p["rows"] += 1
        p["house_php"] += int(r["house_php"])
        p["senate_php"] += int(r["senate_php"])
        if r["status"] == "cut":
            p["cut_rows"] += 1
            p["cut_php"] += int(r["house_php"])
    known = {d["id"] for d in D["districts"]}
    ensure(set(placed) <= known, f"placed districts not in districts.json: {sorted(set(placed) - known)[:3]}")

    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        commit = None
    out = {
        "schema": 1,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_commit": commit,
        "house_districts_built_at": D.get("built_at"),
        "statuses": list(STATUSES),
        "offices": by_office,
        "deo": deo,
        "residual": residual,
        "unmatched_labels": sorted(unmatched_labels),
        "total": total,
        "regions": regions,
        "placed": placed,
        "checks": [
            "Each office's House bill figure equals the House district index's (fy2027.hgab3_php), to the peso.",
            "The money on no card splits as the House index splits it for the House bill: Central Office, regional offices, offices not placed, office change, no office.",
            "Offices plus the money on no card equal the DPWH program in the House bill and in the Senate committee report.",
            "A project the report cuts is at ₱0, and only those.",
        ],
    }
    json.dump(out, open(f"{site}/districts.json", "w"), ensure_ascii=False, separators=(",", ":"))
    b = lambda v: f"₱{v / 1e9:.1f}B"  # noqa: E731
    print(f"districts: {len(by_office)} offices, House {b(deo['house_php'])} → Senate {b(deo['senate_php'])} on cards; "
          f"on no card House {b(total['house_php'] - deo['house_php'])} → Senate {b(total['senate_php'] - deo['senate_php'])}; "
          f"{len(placed)} districts with placed projects", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
