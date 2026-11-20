"""Annex A-2 of the Senate committee report: DOH Health Facilities Enhancement Program items.

A tree (category > sub-category > region > province > facility) with three amount columns
(infrastructure, medical equipment, motor vehicle) and a total, in pesos. These are the facilities the
committee report funds under HFEP. Leaves are rows with no deeper row under them.

Usage: parse_hfep.py <Annex A-2 pdf> <out.json>
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdfwords import amount, page_words, visual_lines  # noqa: E402

COLS = ("infrastructure", "medical_equipment", "motor_vehicle", "total")


def main(pdf_path, out_path):
    pdf = pdfplumber.open(pdf_path)
    rows = []
    for pi, page in enumerate(pdf.pages):
        words = page_words(page)
        hdr = {w["text"]: w for w in words if w["top"] < 105}
        rights = {"infrastructure": hdr["Infrastructure"]["x1"] + 4, "medical_equipment": hdr["Equipment"]["x1"] + 10,
                  "motor_vehicle": hdr["Vehicle"]["x1"], "total": hdr["Total"]["x1"] + 20}
        body = [w for w in words if w["top"] > hdr["Equipment"]["bottom"] + 2]
        for ln in visual_lines(body):
            name, amts = [], {}
            for w in ln["words"]:
                m = re.match(r"^(\w*)\(([A-Za-z]+)([\d,]+\))$", w["text"])
                if m:  # a long name's last letters drawn over a negative amount: "Sanitariu(m100,000,000)"
                    name.append({**w, "text": m.group(1) + m.group(2)})
                    w = {**w, "text": "(" + m.group(3), "x0": w["x1"] - 1}
                a = amount(w["text"]) if w["x0"] > 300 else None
                if a is not None:
                    amts[min(COLS, key=lambda k: abs(rights[k] - w["x1"]))] = a
                else:
                    name.append(w)
            text = " ".join(w["text"] for w in name)
            if not amts:
                if text.startswith("DOH-HFEP") or not text:
                    continue
                if rows:  # a wrapped name
                    rows[-1]["name"] += " " + text
                continue
            rows.append({"pdf_page": pi + 1, "x0": round(name[0]["x0"]) if name else None, "name": text,
                         **{k: amts.get(k, 0) for k in COLS}})
    # Levels from the indent; parents from the nearest shallower row above.
    xs = sorted({r["x0"] for r in rows if r["x0"] is not None and not r["name"].startswith("Grand Total")})
    stack, out = [], []
    for i, r in enumerate(rows):
        if r["name"].startswith("Grand Total"):
            r["kind"] = "grand_total"
            out.append(r)
            continue
        while stack and stack[-1]["x0"] >= r["x0"]:
            stack.pop()
        r["path"] = [s["name"] for s in stack]
        stack.append(r)
        nxt = rows[i + 1] if i + 1 < len(rows) else None
        r["kind"] = "facility" if not nxt or nxt["name"].startswith("Grand Total") or nxt["x0"] <= r["x0"] else "group"
        out.append(r)
    for r in out:
        if r["kind"] == "facility":
            p = r["path"]
            r["category"] = next((x for x in p if re.match(r"^\d+\.\s", x)), "")
            r["subcategory"] = next((x for x in p if re.match(r"^\d+\.[a-z]\.?\s", x)), "")
            r["region"] = next((x for x in p if re.match(r"^(Region|Cordillera|National Capital|Negros Island|BARMM|Bangsamoro)", x)), "")
            r["province"] = p[-1] if p and p[-1] != r["region"] else ""
    json.dump(out, open(out_path, "w"), indent=1, ensure_ascii=False)
    gt = next(r for r in out if r["kind"] == "grand_total")
    leaves = [r for r in out if r["kind"] == "facility"]
    print(f"{len(leaves)} facilities; " + ", ".join(
        f"{k} {sum(r[k] for r in leaves):,} vs {gt[k]:,}" for k in COLS), file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
