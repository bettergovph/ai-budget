"""The Senate committee report's amount for every line of the House bill explorer.

For each department of data/hgab/2027/explorer/d/<id>.json, writes <out>/explorer/<id>.json:
  dept / agencies   House and Senate totals (General Summary, pesos)
  lines             {"<doc>:<pdf page>:<line>:<class>": senate pesos} for lines the Senate changed
  above             keys of lines under a changed heading whose own amount the report does not give
A line in neither is unchanged (Senate = House). Every agency's House total plus its lines' changes must
equal the General Summary's committee-report total; agencies with "above" lines are checked as far as
the report allows and listed otherwise.

How a line gets its amount:
  1. Annex A cites the line itself (the House node at that document, page and line) for that class.
  2. Annex A changes a heading above it (an activity, a region): for DPWH, Annex A-4 prints every office
     under a changed activity that changed, with its House and Senate amounts, so the office line takes
     that amount when the House amount agrees, and is unchanged when A-4 does not list it. Elsewhere the
     split under the heading is unknown: the line goes to "above".

Usage: build_explorer_senate.py <senate-cr out dir> <data/hgab-lines/2027> <data/hgab/2027> <out dir>
"""
import csv
import json
from rapidfuzz import fuzz
import os
import re
import sys
from collections import defaultdict

CLASS = {"1": "PS", "2": "MOOE", "3": "FinEx", "6": "CO"}
DOC_VOL = {"hb10858-3r-vol-ia": "1a", "hb10858-3r-vol-ib": "1b"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def gs_name(s):
    """'D. National Authority for Child Care' -> 'National Authority for Child Care'."""
    return re.sub(r"^[A-Z]{1,2}(\.\d+)?\.?\s+", "", s)


def tables_index(lines_dir):
    """(vol, pdf_page, lineno) -> node, with parent links, over the money tables (not objects)."""
    idx, parent = {}, {}
    for v in ("1a", "1b"):
        for t in json.load(open(f"{lines_dir}/tables-vol{v}.json")):
            if t["kind"] == "O":
                continue

            def walk(n, up):
                for c in n.get("children", []):
                    k = (v, c["pdf_page"], c["lineno"])
                    idx.setdefault(k, c)
                    parent[id(c)] = up
                    walk(c, c)
            walk(t["tree"], None)
    return idx, parent


def main(src, lines_dir, hgab, out):
    os.makedirs(f"{out}/explorer", exist_ok=True)
    idx, parent = tables_index(lines_dir)
    # Annex A amendments, by House node and class. TOTAL rows say the node changed (any class).
    amended = defaultdict(dict)   # id(node) -> {class code or "T": senate pesos}
    for r in csv.DictReader(open(f"{src}/annex_a_mapped.csv")):
        if r["status"] not in ("exact", "exact_nearby", "new_class") or r["row_kind"] != "class" or not r["hb_doc"]:
            continue
        node = idx.get((DOC_VOL[r["hb_doc"]], int(r["hb_pdf_page"]), int(r["hb_node_line"])))
        if node is None:
            continue
        sv = int(float(r["senate_thousands"] or 0)) * 1000
        lab = r["label"].upper()
        code = {"PS": "1", "MOOE": "2", "FINEX": "3", "CO": "6"}.get(lab)
        if code:
            amended[id(node)][code] = sv
        elif lab == "TOTAL":
            amended[id(node)]["T"] = sv
        else:  # a fund line (Loan Proceeds / GOP Counterpart): capital outlays
            amended[id(node)]["6"] = sv
    # DPWH offices changed under an activity (Annex A-4 office headings): (activity, office, House) -> Senate.
    a4 = json.load(open(f"{src}/annex_a4.json"))
    a4_office = {}
    a4_office_by_name = {}
    for r in a4:
        if r["kind"] == "office":
            # The activity is the deepest program heading above the office's region.
            heads = [p for p in r["path"] if not re.search(r"\bregion\b|^(ncr|car|barmm)$|mimaropa|caraga", p.lower())]
            # Under every heading above it: A-4 sometimes has a level the bill's activity does not ("Water Supply
            # System" under the water supply activity). Lookups ask for the activity only.
            entry = [r["hb_title"], r["sv"] or 0]
            for h in heads:
                a4_office.setdefault((norm(h), r["gab"]), []).append(entry)
                a4_office_by_name.setdefault((norm(h), norm(r["hb_title"])), []).append((r["gab"], r["net"] or 0, entry))
    # A-4 shortens activity names ("BIP - ..."): pair a House activity with the A-4 heading printing the same
    # House amount, the closest name among them.
    a4_heads = defaultdict(list)
    for r in a4:
        if r["kind"] == "program" and r["gab"] and r["net"]:
            a4_heads[r["gab"]].append(r["hb_title"])

    def a4_activity(label, house):
        """The A-4 heading of a changed DPWH activity, or None when A-4 shows no change for it."""
        c = a4_heads.get(house, [])
        return norm(max(c, key=lambda t: fuzz.token_set_ratio(t, label))) if c else None
    summary = json.load(open(f"{src}/general_summary.json"))
    gs_dept = {r["name"].split()[0].rstrip("."): r for r in summary if r["level"] == "department"}
    gs_agency = defaultdict(dict)
    for r in summary:
        if r["level"] == "agency" and r["department"]:
            gs_agency[r["department"].split()[0].rstrip(".")][r["name"].split()[0].rstrip(".")] = r

    # Agencies with Senate insertions (Annex A rows with no House line): where an unexplained rest is allowed.
    # Annex A rows not placed on a House line (insertions, a class new to a line, unmatched), by department and
    # agency name: an agency's unexplained rest must come from these.
    unplaced = defaultdict(list)
    for r in csv.DictReader(open(f"{src}/annex_a_mapped.csv")):
        if r["status"] in ("new", "new_class", "unmatched", "ref_only", "no_hb_table") and r["subtotal"] == "0":
            unplaced[r["dept_no"]].append(r["agency"] or "")
    # NEP by House node and class (a line's own NEP, summed up to every heading above it): the NEP figure of
    # each Annex A row, written beside its mapping for build_site.py.
    nep_at = defaultdict(lambda: defaultdict(int))
    for fn in sorted(os.listdir(f"{hgab}/explorer/d")):
        for a in json.load(open(f"{hgab}/explorer/d/{fn}"))["agencies"]:
            stack = list(a["tree"])
            while stack:
                n = stack.pop()
                stack.extend(n.get("c", []))
                for x in n.get("x", []):
                    if not x.get("p"):
                        continue
                    doc, pdf, _printed, ln = x["p"]
                    node = idx.get((DOC_VOL.get(doc, doc), pdf, ln))
                    while node is not None:
                        nep_at[id(node)][x["e"]] += x["n"]
                        nep_at[id(node)]["T"] += x["n"]
                        node = parent.get(id(node))
    obj_nep = {}
    for r in csv.DictReader(open(f"{lines_dir}/object_compare.csv")):
        if r["nep_thousands"] and r["pdf_page"].isdigit():
            obj_nep[(r["volume"], int(r["pdf_page"]), r["line"])] = int(float(r["nep_thousands"])) * 1000
    row_nep = []
    for r in csv.DictReader(open(f"{src}/annex_a_mapped.csv")):
        v = None
        if r["status"] in ("exact", "exact_nearby", "new_class", "ref_only") and r["hb_doc"]:
            vol = DOC_VOL[r["hb_doc"]]
            if r["row_kind"] == "object":
                v = obj_nep.get((vol, int(r["hb_pdf_page"]), r["hb_node_line"]))
            else:
                node = idx.get((vol, int(r["hb_pdf_page"]), int(r["hb_node_line"])))
                if node is not None:
                    lab = r["label"].upper()
                    code = {"PS": "1", "MOOE": "2", "FINEX": "3", "CO": "6", "TOTAL": "T"}.get(lab, "6")
                    v = nep_at.get(id(node), {}).get(code, 0)
        row_nep.append(v)
    json.dump(row_nep, open(f"{src}/annex_a_nep.json", "w"))
    report = []
    for fn in sorted(os.listdir(f"{hgab}/explorer/d")):
        d = json.load(open(f"{hgab}/explorer/d/{fn}"))
        is_dpwh = d["id"] == "department-of-public-works-and-highways"
        lines, above = {}, []
        agencies = {}
        for a in d["agencies"]:
            delta, n_above = 0, 0

            def walk(n, labels, activity=None):
                nonlocal delta, n_above
                labels = labels + [n["l"]]
                if n["k"] == "activity" and is_dpwh:
                    activity = a4_activity(n["l"], n["h"])
                for x in n.get("x", []):
                    if not x.get("p"):
                        continue
                    doc, pdf, _printed, ln = x["p"]
                    key = f"{doc}:{pdf}:{ln}:{x['e']}"
                    node = idx.get((DOC_VOL.get(doc, doc), pdf, ln))
                    sv = None
                    if node is not None and x["e"] in amended.get(id(node), {}):
                        sv = amended[id(node)][x["e"]]
                    elif is_dpwh and activity:
                        # A changed DPWH activity: A-4 lists every office whose amount changed.
                        cands = [c for c in a4_office.get((activity, x["h"]), []) if not c[2:]]
                        if cands:
                            best = max(cands, key=lambda c: fuzz.token_set_ratio(c[0], n["l"]))
                            best.append("used")  # one office line each
                            sv = best[1]
                        else:
                            # The bill prints one line where A-4 splits the office across sub-headings
                            # (water supply's Central Office): apply the changes A-4 gives that office.
                            parts = [p for p in a4_office_by_name.get((activity, norm(n["l"])), []) if not p[2][2:]]
                            if parts and sum(p[0] for p in parts) <= x["h"]:
                                for p in parts:
                                    p[2].append("used")
                                sv = x["h"] + sum(p[1] for p in parts)
                    elif node is not None:
                        up, hit = parent.get(id(node)), False
                        while up is not None:
                            if amended.get(id(up)):
                                hit = True
                                break
                            up = parent.get(id(up))
                        if hit and not is_dpwh:
                            above.append(key)
                            n_above += 1
                            continue
                    if sv is not None and sv != x["h"]:
                        lines[key] = sv
                        delta += sv - x["h"]
                for c in n.get("c", []):
                    walk(c, labels, activity)
            for n in a["tree"]:
                walk(n, [])
            # The General Summary's agency: by name (its letters sometimes differ from the bill's), else by
            # letter; a department of one agency (no letter) is the department's own total.
            pool = gs_agency.get(d["roman"], {})
            named = max(pool.values(), key=lambda r: fuzz.token_sort_ratio(gs_name(r["name"]).lower(), a["name"].lower()), default=None)
            if named and fuzz.token_sort_ratio(gs_name(named["name"]).lower(), a["name"].lower()) >= 90:
                g = named
            elif a["no"]:
                g = pool.get(a["no"].rstrip("."))
            elif len(d["agencies"]) == 1:
                g = gs_dept.get(d["roman"])
            else:  # the department's own office, which the bill names after the department (DepEd)
                g = pool.get("A")
            senate = g["sv"] * 1000 if g and g["sv"] is not None else None
            # What the changed House lines don't explain is in lines the House bill does not have (Senate
            # insertions), or under a changed heading ("above"). The summary is in thousands: < P1,000 is rounding.
            rest = None if senate is None else senate - a["house"] - delta
            if rest is not None and abs(rest) < 1000:
                rest = 0
            ins = any(fuzz.token_set_ratio(x.lower(), a["name"].lower()) >= 85 or len(d["agencies"]) == 1 for x in unplaced.get(d["roman"], []))
            agencies[a["id"]] = {"house": a["house"], "senate": senate, "lines_delta": delta, "above": n_above,
                                 "new_lines": rest}
            if rest is None or (rest and not n_above and not ins):
                report.append((d["roman"], a["no"], a["name"][:50], a["house"], delta, senate, rest, ins))
        gd = gs_dept.get(d["roman"])
        out_d = {"id": d["id"], "roman": d["roman"], "house": d["house"],
                 "senate": gd["sv"] * 1000 if gd and gd["sv"] is not None else None,
                 "agencies": agencies, "lines": lines, "above": above}
        json.dump(out_d, open(f"{out}/explorer/{d['id']}.json", "w"), separators=(",", ":"))
    print(f"agencies with a Senate total but an unexplained difference, or no Senate total: {len(report)}", file=sys.stderr)
    for r in report:
        print("  ", r, file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:5])
