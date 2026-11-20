"""Annexes A-1 (DA farm-to-market roads) and A-3 (NIA projects) of the Senate committee report.

Both print the House bill description, the committee report description, then House bill amount,
increase, decrease, net change and committee report amount, in pesos. Amounts sit on an item's first
line; its description wraps below (with START:/END: coordinates in A-1). Headings (program, region,
province) have totals too, and are told apart from projects by their wording, not by indent.

Usage: parse_two_col.py fmr|nia <pdf> <out.json>
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdfwords import amount, page_words, visual_lines  # noqa: E402

COLS = ("gab", "inc", "dec", "net", "sv")
CONF = {
    # x where the committee-report description starts, x where amounts start, right edges of the 5 columns
    "fmr": {"rev_x": 262, "amt_x": 530, "rights": {"gab": 598, "inc": 677, "dec": 761, "net": 841, "sv": 921}},
    "nia": {"rev_x": 278, "amt_x": 548, "rights": {"gab": 621, "inc": 695, "dec": 771, "net": 848, "sv": 920}},
}
COORD = re.compile(r"^(START|END)\s*:", re.I)
NIA_HEAD = re.compile(
    r"(Sub-Program$|^Improvement of Service Roads in (National|Communal) Irrigation Systems$|"
    r"^(Repair|Restoration) of (National|Communal|Pump) Irrigation Systems$|^Climate Change Adaptation Works|"
    r"^Establishment of Pump Irrigation Projects$|^Rehabilitation and Protection of Watershed Management$|"
    r"^Extension/Expansion of Existing (National|Communal) Irrigation Systems$|"
    r"Program$|Projects$)")


def is_heading(kind, hb, rev):
    t = hb or rev
    letters = re.sub(r"[^A-Za-z]", "", t)
    caps = letters and letters.upper() == letters
    if kind == "fmr":
        return bool(caps)
    # NIA: capitals (program, region, province) or one of the activity / sub-program names; everything else,
    # with or without the "System: work" colon form, is a project.
    return bool(caps) or bool(NIA_HEAD.search(hb or "")) and not rev or t.startswith("GRAND TOTAL")


def main(kind, pdf_path, out_path):
    cf = CONF[kind]
    pdf = pdfplumber.open(pdf_path)
    items = []
    for pi, page in enumerate(pdf.pages):
        words = page_words(page, splits=(cf["rev_x"], cf["amt_x"]), x_tolerance=1.5)
        if any(w["text"] == "A-3B." for w in words[:40]):
            break  # Annex A-3B, the watershed list, is a different table
        hdr = [w for w in words if w["text"] in ("Description", "(Amount)")]
        top = max((w["bottom"] for w in hdr), default=0)
        body = [w for w in words if w["top"] > top + 2 and not re.match(r"^Page$", w["text"])]
        body = [w for w in body if not (w["top"] > page.height - 45)]  # "Page n of m" footer
        for ln in visual_lines(body):
            hb, rev, amts = [], [], {}
            for w in ln["words"]:
                if w["x0"] >= cf["amt_x"]:
                    a = amount(w["text"])
                    if a is not None:
                        amts[min(COLS, key=lambda k: abs(cf["rights"][k] - w["x1"]))] = a
                        continue
                (rev if w["x0"] >= cf["rev_x"] else hb).append(w)
            hbt = " ".join(w["text"] for w in hb)
            rvt = " ".join(w["text"] for w in rev)
            if amts:
                items.append({"pdf_page": pi + 1, "hb": [hbt] if hbt else [], "rev": [rvt] if rvt else [],
                              **{k: amts.get(k) for k in COLS}})
            elif items and (hbt or rvt):
                if hbt:
                    items[-1]["hb"].append(hbt)
                if rvt:
                    items[-1]["rev"].append(rvt)
            elif hbt or rvt:
                # A heading whose amounts sit on its second line (the program title above the first region).
                items.append({"pdf_page": pi + 1, "hb": [hbt] if hbt else [], "rev": [rvt] if rvt else [],
                              "_pending": True, **{k: None for k in COLS}})
    # Merge a pending heading line into the item that carries its amounts.
    merged = []
    for it in items:
        if merged and merged[-1].get("_pending") and not (it["hb"] and it["rev"]):
            p = merged.pop()
            it = {**it, "hb": p["hb"] + it["hb"], "rev": p["rev"] + it["rev"]}
        merged.append(it)
    # NIA prints a large project as an activity: its name alone, then region / province headings (or one
    # project row restating it) carrying the same amounts. Treat that first line as a heading.
    if kind == "nia":
        for i, it in enumerate(merged[:-1]):
            nxt = merged[i + 1]
            hb, nhb, nrv = join(it["hb"]), join(nxt["hb"]), join(nxt["rev"])
            if hb and not it["rev"] and not is_heading(kind, hb, "") and (
                    is_heading(kind, nhb, nrv) and heading_level(kind, nhb or nrv) == 4
                    and all(it[k] == nxt[k] for k in ("gab", "sv"))
                    or nhb == hb and nrv and all(it[k] == nxt[k] for k in ("gab", "sv"))):
                it["_activity"] = True
    out, path = [], []
    for it in merged:
        hb = join([l for l in it["hb"] if not COORD.match(l)])
        rev = join([l for l in it["rev"] if not COORD.match(l)])
        rec = {"pdf_page": it["pdf_page"], "hb_title": hb, "senate_title": rev,
               "hb_coords": [l for l in it["hb"] if COORD.match(l)],
               "senate_coords": [l for l in it["rev"] if COORD.match(l)],
               **{k: it[k] for k in COLS}}
        if it.get("_activity") or is_heading(kind, hb, rev):
            rec["kind"] = "heading"
            name = hb or rev
            level = 3 if it.get("_activity") else heading_level(kind, name)
            path = (path + [""] * level)[:level] + [name]
            rec["path"] = [p for p in path[:-1] if p]
            rec["level"] = level
        else:
            rec["kind"] = "project"
            rec["path"] = [p for p in path if p]
        out.append(rec)
    json.dump(out, open(out_path, "w"), indent=1, ensure_ascii=False)
    print(f"{len(out)} rows ({sum(r['kind'] == 'project' for r in out)} projects) -> {out_path}", file=sys.stderr)


def heading_level(kind, name):
    n = name.upper()
    if n.startswith("GRAND TOTAL"):
        return 0
    if kind == "fmr":
        return 1 if n.startswith(("REGION", "NATIONAL CAPITAL", "CORDILLERA", "BANGSAMORO", "NEGROS ISLAND",
                                  "MIMAROPA", "CALABARZON", "CARAGA")) else 0
    if "PROGRAM" in n and "SUB-PROGRAM" not in n:
        return 1
    if "SUB-PROGRAM" in n:
        return 2
    if name != n:  # mixed case, no colon: an activity under the sub-program
        return 3
    if n.startswith(("REGION", "CORDILLERA", "NATIONAL CAPITAL", "BANGSAMORO", "NEGROS ISLAND", "MIMAROPA",
                     "CALABARZON", "CARAGA")) or n in ("MARIIS", "UPRIIS"):
        return 4  # MARIIS / UPRIIS: NIA's integrated-system offices, peers of the regional offices
    return 5  # province


def join(lines):
    return re.sub(r"Sub- Program", "Sub-Program", re.sub(r"\s+", " ", " ".join(lines))).strip()


if __name__ == "__main__":
    main(*sys.argv[1:4])
