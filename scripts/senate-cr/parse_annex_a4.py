"""Annex A-4 of the Senate committee report: DPWH programs/projects (House bill Vol I-C) the Senate changed.

Columns: HB page | HB project name | revised project name (only when the Senate renames it) |
House bill amount | increase | decrease | net change | Senate amount, all in pesos.
Headings (program, region, office) carry totals; project rows sit at the deepest indent.

Usage: parse_annex_a4.py <Annex A-4 pdf> <out.json>
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdfwords import amount, page_words, visual_lines  # noqa: E402

COLS = ("gab", "inc", "dec", "net", "sv")
REV_X = 326     # the revised-name column starts here
AMT_X = 545     # amounts start here
PROJECT_X = 104  # project rows are indented at least this far
COORD = re.compile(r"^(Start|End)\s*:", re.I)


def columns(words):
    hdr = {w["text"]: w for w in words if w["top"] < 34}
    return {"gab": hdr["10858)"]["x1"] + 7, "inc": hdr["Increase"]["x1"] + 18, "dec": hdr["Decrease"]["x1"] + 23,
            "net": hdr["Change"]["x1"] + 13, "sv": hdr["REPORT)"]["x1"]}


def heading_kind(text, x0):
    t = text.lower()
    if re.search(r"(district engineering office|central office|regional office|engineering office|\boffice\b)", t):
        return "office"
    if re.search(r"(\bregion\b|national capital region|cordillera|barmm|bangsamoro|mimaropa|calabarzon|caraga|\bncr\b|\bcar\b)", t):
        return "region"
    return "program"


def main(pdf_path, out_path):
    pdf = pdfplumber.open(pdf_path)
    items = []
    hb_page = None
    for pi, page in enumerate(pdf.pages):
        words = page_words(page, splits=(REV_X, AMT_X), x_tolerance=1.5)
        cols = columns(words)
        body = [w for w in words if w["top"] > 33]
        foot = [w for w in body if w["text"] == "Page" and w["top"] > page.height - 40]
        if foot:
            body = [w for w in body if w["top"] < foot[0]["top"] - 2]
        for ln in visual_lines(body):
            pref = None
            hb, rev, amts = [], [], {}
            for w in ln["words"]:
                if w["x1"] < 41 and re.match(r"^\d{1,4}$", w["text"]):
                    pref = int(w["text"])
                    continue
                if w["x0"] >= AMT_X:
                    a = amount(w["text"])
                    if a is not None:
                        amts[min(COLS, key=lambda k: abs(cols[k] - w["x1"]))] = a
                        continue
                (rev if w["x0"] >= REV_X else hb).append(w)
            if pref is not None:
                hb_page = pref
            if amts and not hb and items and all(not v for v in amts.values()):
                amts = {}  # a wrapped name line printed with dashes in the amount columns
            if amts:
                x0 = (hb or rev)[0]["x0"] if (hb or rev) else None
                items.append({"pdf_page": pi + 1, "hb_page": hb_page, "x0": x0, "top": ln["top"],
                              "hb": [" ".join(w["text"] for w in hb)] if hb else [],
                              "rev": [" ".join(w["text"] for w in rev)] if rev else [],
                              "hb_x0": hb[0]["x0"] if hb else None,
                              **{k: amts.get(k) for k in COLS}})
            elif items and (hb or rev):
                it = items[-1]
                if hb:
                    it["hb"].append(" ".join(w["text"] for w in hb))
                    if it["hb_x0"] is None:
                        it["hb_x0"] = hb[0]["x0"]
                if rev:
                    it["rev"].append(" ".join(w["text"] for w in rev))
    # Foreign-assisted projects print the project as a heading and its money as fund rows (GOP, Loan
    # Proceeds) below it: mark those rows as funds of the heading, and the heading as the project.
    FUND = ("GOP", "GOP Counterpart", "Loan Proceeds", "Grant Proceeds")
    for i, it in enumerate(items):
        it["fund_of"] = None
        if join(it["hb"]) in FUND:
            j = i - 1
            while j >= 0 and join(items[j]["hb"]) in FUND:
                j -= 1
            head = items[j]
            hx = head["hb_x0"] if head["hb_x0"] is not None else head["x0"]
            if j >= 0 and hx is not None and hx < PROJECT_X and not re.search(r"office$", join(head["hb"]), re.I):
                it["fund_of"] = j
                head["fap_project"] = True
            else:
                it["fund_total"] = True  # all foreign-assisted projects' GOP / loan money, under the office
    # Context: headings form a stack by indent; projects take the stack as their path.
    stack = []
    out = []
    for it in items:
        name = join(it["hb"])
        rev = join(it["rev"])
        x0 = it["hb_x0"] if it["hb_x0"] is not None else it["x0"]
        is_project = (x0 is not None and x0 >= PROJECT_X or not it["hb"]) and it["fund_of"] is None \
            and not it.get("fund_total") \
            or it.get("fap_project")
        coords = [c for c in it["hb"] + it["rev"] if COORD.match(c)]
        rec = {
            "pdf_page": it["pdf_page"], "hb_page": it["hb_page"], "x0": round(x0, 1) if x0 is not None else None,
            "hb_title": strip_coords(it["hb"]), "senate_title": strip_coords(it["rev"]),
            "hb_coords": [c for c in it["hb"] if COORD.match(c)], "senate_coords": [c for c in it["rev"] if COORD.match(c)],
            **{k: it[k] for k in COLS},
        }
        if it.get("fund_total"):
            rec["kind"] = "fund_total"
            rec["path"] = [s["name"] for s in stack]
        elif it["fund_of"] is not None:
            rec["kind"] = "fund"
            rec["path"] = [s["name"] for s in stack]
        elif is_project:
            rec["kind"] = "project"
            if it.get("fap_project"):
                rec["hb_title"] = re.sub(r"^[a-z]\.\s*", "", rec["hb_title"])
                while stack and stack[-1]["x0"] >= x0 - 0.5:
                    stack.pop()
            rec["path"] = [s["name"] for s in stack]
            rec["office"] = next((s["name"] for s in reversed(stack) if s["kind"] == "office"), None)
            rec["region"] = next((s["name"] for s in reversed(stack) if s["kind"] == "region"), None)
        else:
            while stack and stack[-1]["x0"] >= x0 - 0.5:
                stack.pop()
            kind = heading_kind(name, x0)
            stack.append({"x0": x0, "name": name, "kind": kind})
            rec["kind"] = kind
            rec["path"] = [s["name"] for s in stack[:-1]]
        out.append(rec)
    json.dump(out, open(out_path, "w"), indent=1, ensure_ascii=False)
    print(f"{len(out)} rows ({sum(r['kind'] == 'project' for r in out)} projects) -> {out_path}", file=sys.stderr)


def join(lines):
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def strip_coords(lines):
    return join([l for l in lines if not COORD.match(l)])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
