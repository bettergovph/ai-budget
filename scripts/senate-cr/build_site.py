"""The data the /senate/2027 pages read, from the parsed and mapped committee report.

Writes <out> (data/senate/2027, published to R2 senate/2027/):
  overview.json            whole-bill totals, the four programs, counts, the report's documents
  departments.json         the General Summary by department and agency, House vs Senate (pesos)
  lines/<dept id>.json     Annex A rows of one department: what the Senate changed, line by line
  <program>/projects.parquet  every House project + Senate insertions: NEP, House, Senate, status
  <program>/summary.json   totals by status, region and program line; largest cuts, raises, additions
  provisions.json          Annex B: amendments to special and general provisions
  pdf/                     the report's PDFs, for page links
(explorer/<dept id>.json, the Senate amount of every House explorer line, is build_explorer_senate.py's.)

Usage: build_site.py <senate-cr out dir> <data/hgab/2027> <out dir>
"""
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone

import duckdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regions import canon_region  # noqa: E402

PDFS = [  # key, title, file name prefix in the report's zip
    ("senate-cr-general-summary", "General Summary", "General Summary"),
    ("senate-cr-annex-a", "Annex A: Line-by-line amendments", "Annex A - Line"),
    ("senate-cr-annex-a1", "Annex A-1: DA farm-to-market roads", "Annex A-1"),
    ("senate-cr-annex-a2", "Annex A-2: DOH Health Facilities Enhancement Program", "Annex A-2"),
    ("senate-cr-annex-a3", "Annex A-3: NIA projects", "Annex A-3"),
    ("senate-cr-annex-a4", "Annex A-4: DPWH programs and projects", "Annex A-4"),
    ("senate-cr-annex-a5", "Annex A-5: TIEZA and Tourism Promotions Board", "Annex A-5"),
    ("senate-cr-annex-b", "Annex B: Special and general provisions", "Annex B"),
]
PROGRAM_PDF = {"dpwh": "senate-cr-annex-a4", "fmr": "senate-cr-annex-a1", "nia": "senate-cr-annex-a3",
               "hfep": "senate-cr-annex-a2"}
PROGRAMS = [("dpwh", "DPWH projects", "Department of Public Works and Highways"),
            ("fmr", "Farm-to-market roads", "Department of Agriculture"),
            ("hfep", "Health facilities", "Department of Health"),
            ("nia", "Irrigation", "National Irrigation Administration")]
STATUS_ORDER = ["cut", "reduced", "raised", "added", "renamed", "unchanged", "nep_only"]


def slug(s):
    s = re.sub(r"\([^)]*\)", " ", s or "").lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def k(v):
    """Thousand pesos (the General Summary and Annex A) to pesos."""
    return None if v in (None, "") else int(round(float(v))) * 1000


def main(src, hgab, out):
    os.makedirs(f"{out}/lines", exist_ok=True)
    os.makedirs(f"{out}/pdf", exist_ok=True)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ex_index = json.load(open(f"{hgab}/explorer/index.json"))
    ex_id = {d["roman"]: d["id"] for d in ex_index["departments"]}
    # The explorer's NEP data leaves out unprogrammed appropriations (the same P111,984,494,000 in the NEP and the
    # House bill): no NEP figure for it, rather than a zero that would read as an addition.
    ex_nep = {d["roman"]: (d["nep"] if d["roman"] != "XLIII" else None) for d in ex_index["departments"]}

    # The report's PDFs, renamed for links.
    docs = []
    for key, title, prefix in PDFS:
        f = next(x for x in sorted(os.listdir(f"{src}/pdf")) if x.startswith(prefix))
        shutil.copyfile(f"{src}/pdf/{f}", f"{out}/pdf/{key}.pdf")
        sha = hashlib.sha256(open(f"{out}/pdf/{key}.pdf", "rb").read()).hexdigest()
        docs.append({"key": key, "title": title, "file": f, "sha256": sha})

    # General Summary -> departments.json
    gs = json.load(open(f"{src}/general_summary.json"))
    depts, cur = [], None
    totals = {}
    for r in gs:
        amt = {"house": k(r["gab"]), "increase": k(r["inc"]), "decrease": k(r["dec"]), "net": k(r["net"]),
               "senate": k(r["sv"])}
        if r["level"] == "total":
            totals.setdefault(r["name"], amt)
        elif r["level"] == "department":
            roman = r["name"].split()[0].rstrip(".")
            name = re.sub(r"^[IVXL]+\.\s*", "", r["name"])
            cur = {"roman": roman if not r["name"].startswith("BUDGETS") else None, "name": name,
                   "id": ex_id.get(roman) if not r["name"].startswith("BUDGETS") else "doe-attached-corporations",
                   "nep": ex_nep.get(roman) if not r["name"].startswith("BUDGETS") else None,
                   **amt, "agencies": []}
            depts.append(cur)
        elif cur is not None:
            no = r["name"].split()[0].rstrip(".")
            cur["agencies"].append({"no": no, "name": re.sub(r"^[A-Z]{1,2}(\.\d+)?\.?\s+", "", r["name"]), **amt})

    # Annex A -> lines/<id>.json
    rows = list(csv.DictReader(open(f"{src}/annex_a_mapped.csv")))
    # The NEP amount of each row's House line (build_explorer_senate.py), aligned with the CSV's rows.
    nep_path = f"{src}/annex_a_nep.json"
    row_nep = json.load(open(nep_path)) if os.path.exists(nep_path) else [None] * len(rows)
    by_dept = defaultdict(list)
    for r, nep in zip(rows, row_nep):
        if r["subtotal"] == "1":
            continue
        by_dept[r["dept_no"]].append({
            "nep": nep,
            "agency": r["agency"], "agency_no": r["agency_no"], "kind": r["row_kind"],
            "context": r["context"], "label": r["label"], "deleted": r["deleted"] == "1",
            "house": k(r["hb_thousands"]), "increase": k(r["inc_thousands"]), "decrease": k(r["dec_thousands"]),
            "net": k(r["net_thousands"]), "senate": k(r["senate_thousands"]),
            "instruction": r["instruction"] or None, "status": r["status"],
            "hb": [r["hb_doc"] or None, int(r["hb_pdf_page"]) if r["hb_pdf_page"] else None, int(r["hb_page"]) if r["hb_page"] else None,
                   r["hb_line"] or None],
            "hb_label": r["hb_node_label"] or None, "hb_path": r["hb_path"] or None,
            "senate_page": int(r["senate_pdf_page"]),
        })
    for d in depts:
        d["changed_rows"] = len(by_dept.get(d["roman"], []))
        if d["id"] and d["roman"]:
            json.dump({"id": d["id"], "roman": d["roman"], "name": d["name"], "rows": by_dept.get(d["roman"], [])},
                      open(f"{out}/lines/{d['id']}.json", "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump({"built_at": built, "totals": totals, "departments": depts},
              open(f"{out}/departments.json", "w"), indent=1, ensure_ascii=False)

    # Programs: projects.parquet + summary.json
    con = duckdb.connect()
    programs = []
    for key, label, agency in PROGRAMS:
        os.makedirs(f"{out}/{key}", exist_ok=True)
        hb = {r[0]: r for r in con.execute(
            f"select id, nep_php, hgab3_doc, hgab3_page, nep_doc, nep_page from '{hgab}/{key}/projects.parquet'").fetchall()}
        recs = []
        for i, r in enumerate(csv.DictReader(open(f"{src}/{key}_senate.csv"))):
            h = hb.get(r["id"]) if r["id"] else None
            house = int(r["hb_php"] or 0)
            senate = int(r["senate_php"] or 0)
            title = r["senate_title"] or r["hb_title"]
            recs.append({
                "id": r["id"] or f"senate-{key}-{i}", "house_id": r["id"] or None, "status": r["status"],
                "title": title, "hb_title": r["hb_title"] or None,
                "renamed": bool(r["hb_title"]) and re.sub(r"\W", "", title.lower()) != re.sub(r"\W", "", r["hb_title"].lower()),
                "region": r["region"] or None, "office": r["office"] or None, "program": r["program"] or None,
                "pap": r["pap"] or None,
                "nep_php": h[1] if h else None, "house_php": house if r["id"] else None, "senate_php": senate,
                "change_php": senate - house,
                "replaces_id": r["replaces_id"] or None,
                "house_doc": h[2] if h else None, "house_page": h[3] if h else None,
                "nep_doc": h[4] if h else None, "nep_page": h[5] if h else None,
                "senate_doc": PROGRAM_PDF[key], "senate_page": int(r["senate_pdf_page"]) if r["senate_pdf_page"] else None,
                "search_text": " ".join(x for x in (title, r["hb_title"], r["region"], r["office"], r["program"], r["pap"]) if x).lower(),
            })
        # NEP projects with no House bill line (the House section's deletion candidates): in neither the House bill
        # nor the committee report, listed so the NEP column is the whole program.
        for r in con.execute(f"""select id, title, region, office, program, pap, nep_php, nep_doc, nep_page
                                 from '{hgab}/{key}/projects.parquet' where hgab3_php is null and nep_php is not null""").fetchall():
            recs.append({
                "id": r[0], "house_id": None, "status": "nep_only", "title": r[1], "hb_title": None, "renamed": False,
                "region": r[2], "office": r[3], "program": r[4], "pap": r[5], "nep_php": r[6], "house_php": None,
                "senate_php": 0, "change_php": 0, "replaces_id": None, "house_doc": None, "house_page": None,
                "nep_doc": r[7], "nep_page": r[8],
                "senate_doc": PROGRAM_PDF[key], "senate_page": None,
                "search_text": " ".join(x for x in (r[1], r[2], r[3], r[4], r[5]) if x).lower(),
            })
        for x in recs:
            x["region"] = canon_region(x["region"])
        if key == "nia":
            # NIA rows the annex doesn't list (unchanged, NEP only) have no region: take their irrigation system's
            # ("San Ramon RIS: Concreting of ..."), when every listed row of that system is in one region.
            system = lambda t: (t or "").split(":")[0].strip().lower()
            seen = defaultdict(set)
            for x in recs:
                if x["region"]:
                    seen[system(x["hb_title"] or x["title"])].add(x["region"])
            for x in recs:
                if not x["region"]:
                    regs = seen.get(system(x["hb_title"] or x["title"]))
                    if regs and len(regs) == 1:
                        x["region"] = next(iter(regs))
        for x in recs:
            x["search_text"] = " ".join(v for v in (x["search_text"], (x["region"] or "").lower()) if v)
        con.execute("create or replace temp table t as select * from read_json_auto(?)", [_tmp_json(out, key, recs)])
        con.execute(f"""copy (select id, house_id, status, title, hb_title, renamed, region, office, program, pap,
                               nep_php::bigint nep_php, house_php::bigint house_php, senate_php::bigint senate_php,
                               change_php::bigint change_php, replaces_id::varchar replaces_id, house_doc::varchar house_doc,
                               house_page::integer house_page, nep_doc::varchar nep_doc, nep_page::integer nep_page,
                               senate_doc, senate_page::integer senate_page, search_text
                        from t order by status, senate_php desc)
                        to '{out}/{key}/projects.parquet' (format parquet, compression zstd)""")
        os.remove(f"{out}/{key}/_rows.json")
        by_status = defaultdict(lambda: {"count": 0, "nep_php": 0, "house_php": 0, "senate_php": 0})
        for x in recs:
            s = by_status[x["status"]]
            s["count"] += 1
            s["nep_php"] += x["nep_php"] or 0
            s["house_php"] += x["house_php"] or 0
            s["senate_php"] += x["senate_php"]

        def dim(field):
            g = defaultdict(lambda: {"nep_php": 0, "house_php": 0, "senate_php": 0, "count": 0, "changed": 0})
            for x in recs:
                v = g[x[field] or "Not recorded"]
                v["nep_php"] += x["nep_php"] or 0
                v["house_php"] += x["house_php"] or 0
                v["senate_php"] += x["senate_php"]
                v["count"] += 1
                v["changed"] += x["status"] not in ("unchanged", "renamed", "nep_only")
            return sorted(({"label": lab, **v} for lab, v in g.items()), key=lambda r: -(r["house_php"] or r["senate_php"]))

        def top(status, key_fn, n=25):
            return [{f: x[f] for f in ("id", "house_id", "title", "hb_title", "region", "office", "nep_php", "house_php",
                                         "senate_php", "change_php", "status", "senate_page")}
                    for x in sorted((x for x in recs if x["status"] == status), key=key_fn)[:n]]
        house_total = sum(x["house_php"] or 0 for x in recs)
        senate_total = sum(x["senate_php"] for x in recs)
        summary = {
            "key": key, "label": label, "agency": agency, "built_at": built,
            "house_php": house_total, "senate_php": senate_total, "change_php": senate_total - house_total,
            "nep_php": sum(x["nep_php"] or 0 for x in recs),
            "status": {s: by_status[s] for s in STATUS_ORDER if s in by_status},
            "regions": dim("region"), "programs": dim("program") if key != "hfep" else dim("pap"),
            "offices": dim("office") if key == "dpwh" else None,
            "top": {"cut": top("cut", lambda x: x["change_php"]), "reduced": top("reduced", lambda x: x["change_php"]),
                    "raised": top("raised", lambda x: -x["change_php"]), "added": top("added", lambda x: -x["senate_php"]),
                    "renamed": top("renamed", lambda x: -(x["house_php"] or 0))},
            "senate_doc": PROGRAM_PDF[key],
        }
        json.dump(summary, open(f"{out}/{key}/summary.json", "w"), indent=1, ensure_ascii=False)
        programs.append({k2: summary[k2] for k2 in ("key", "label", "agency", "house_php", "senate_php", "change_php", "nep_php", "status")})

    # Annex B -> provisions.json
    prov = json.load(open(f"{src}/annex_b.json"))
    # Printed page -> PDF page of the House bill volumes, from the House line items.
    pdf_of = {}
    lines_csv = os.path.join(os.path.dirname(hgab.rstrip("/")), "..", "hgab-lines", "2027", "hb_line_items.csv")
    for r in csv.DictReader(open(os.path.normpath(lines_csv))):
        if r["printed_page"]:
            pdf_of[(r["volume"], int(r["printed_page"]))] = int(r["pdf_page"])
    for p in prov:
        vol = {"I-A": "1a", "I-B": "1b"}.get(p["volume"])
        pg = pdf_of.get((vol, p["hb_page"])) if p["hb_page"] else None
        if pg is None and vol and p["hb_page"]:  # a page with no money lines: the nearest one before it
            near = [(pp, pdf) for (v, pp), pdf in pdf_of.items() if v == vol and pp <= p["hb_page"]]
            if near:
                pp, pdf = max(near)
                pg = pdf + (p["hb_page"] - pp)
        p["hb_pdf_page"] = pg
        roman = (p["dept"] or "").split()[0].rstrip(".") if p["dept"] else None
        p["dept_id"] = ex_id.get(roman)
        p["hb_doc"] = {"I-A": "hb10858-3r-vol-ia", "I-B": "hb10858-3r-vol-ib"}.get(p["volume"])
    json.dump({"built_at": built, "amendments": prov}, open(f"{out}/provisions.json", "w"), indent=1, ensure_ascii=False)

    a_status = defaultdict(int)
    for r in rows:
        a_status[r["status"]] += 1
    overview = {
        "fiscal_year": 2027, "built_at": built,
        "report": {"title": "Committee Report on House Bill No. 10858 (FY 2027 General Appropriations Bill)",
                   "committee": "Senate Committee on Finance", "prepared": "LBRMO, 2026-11-19"},
        "totals": totals, "programs": programs,
        "departments_changed": sum(1 for d in depts if d["roman"] and (d["increase"] or d["decrease"])),
        "departments": len([d for d in depts if d["roman"]]),
        "annex_a": dict(a_status), "provisions": len(prov), "documents": docs,
        "biggest": sorted(({"id": d["id"], "name": d["name"], "net": d["net"], "nep": d["nep"], "house": d["house"], "senate": d["senate"]}
                           for d in depts if d["roman"] and d["net"]), key=lambda d: d["net"]),
    }
    json.dump(overview, open(f"{out}/overview.json", "w"), indent=1, ensure_ascii=False)
    # What upload:senate reads to say what it publishes: this repo's commit and the report's PDFs.
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                            cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip()
    json.dump({"fiscal_year": 2027, "built_at": built, "source_commit": commit or "unknown",
               "source": "Senate Committee on Finance, Committee Report on HB 10858 (FY 2027 GAB)",
               "documents": docs, "pipeline": "npm run build:senate-cr (scripts/senate-cr/)"},
              open(f"{out}/manifest.json", "w"), indent=1)
    print(f"overview, {len(depts)} departments, {sum(len(v) for v in by_dept.values())} Annex A rows, "
          f"{len(prov)} provisions, programs: " + ", ".join(f"{p['key']} {p['house_php']:,} -> {p['senate_php']:,}" for p in programs),
          file=sys.stderr)


def _tmp_json(out, key, recs):
    p = f"{out}/{key}/_rows.json"
    with open(p, "w") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return p


if __name__ == "__main__":
    main(*sys.argv[1:4])
