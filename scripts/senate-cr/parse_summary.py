"""General Summary of the Senate committee report: House bill vs committee report by department/agency.

Five columns in thousand pesos: House bill, increase, decrease, net change, committee report.
Long names wrap onto a line above the amounts.

Usage: parse_summary.py <General Summary pdf> <out.json>
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdfwords import amount, page_words, visual_lines  # noqa: E402

COLS = ("gab", "inc", "dec", "net", "sv")
ROMAN = re.compile(r"^[IVXL]+\.$")


def roman(t):
    v = {"I": 1, "V": 5, "X": 10, "L": 50}
    t = t.rstrip(".")
    return sum(-v[a] if i + 1 < len(t) and v[a] < v[t[i + 1]] else v[a] for i, a in enumerate(t))


def main(pdf_path, out_path):
    pdf = pdfplumber.open(pdf_path)
    out = []
    pending = []
    dept = None
    dept_no = None
    for pi, page in enumerate(pdf.pages):
        words = page_words(page)
        hdr = [w for w in words if w["text"] in ("Increase", "Decrease", "Change", "10858)", "10858") and w["top"] < 120]
        inc = next(w for w in hdr if w["text"] == "Increase")
        dec = next(w for w in hdr if w["text"] == "Decrease")
        chg = next(w for w in hdr if w["text"] == "Change")
        gab = min((w for w in hdr if w["text"] == "10858)"), key=lambda w: w["x0"])
        sv = max((w for w in hdr if w["text"] == "10858"), key=lambda w: w["x0"])
        rights = {"gab": gab["x1"] + 3, "inc": inc["x1"] + 13, "dec": dec["x1"] + 15, "net": chg["x1"] + 8, "sv": sv["x1"] + 18}
        top = max(w["bottom"] for w in hdr)
        body = [w for w in words if w["top"] > top + 2 and not w["text"].startswith("Prepared")]
        for ln in visual_lines(body):
            name, amts = [], {}
            for w in ln["words"]:
                a = amount(w["text"]) if w["x0"] > 250 else None
                if a is not None:
                    amts[min(COLS, key=lambda k: abs(rights[k] - w["x1"]))] = a
                else:
                    name.append(w)
            text = " ".join(w["text"] for w in name)
            if "GENERAL SUMMARY" in text or "Prepared by" in text:
                continue
            if not amts:
                if text:
                    pending.append((name[0]["x0"], text))
                continue
            x0 = pending[0][0] if pending else (name[0]["x0"] if name else None)
            full = " ".join([t for _, t in pending] + [text]).strip()
            pending = []
            first = full.split()[0] if full else ""
            # Agencies are lettered (A., I., L., V., X. ...), so a numeral is a department only when it is the
            # next one (or close after it) in order.
            is_dept = bool(ROMAN.match(first)) and x0 is not None and x0 < 60 and \
                0 < roman(first) - (dept_no or 0) <= 12 and not full.startswith("BUDGETS")
            level = "department" if is_dept else "total" if x0 is not None and x0 < 60 and not ROMAN.match(first) \
                else "agency"
            if full.startswith("BUDGETS OF DOE"):
                level, dept, dept_no = "department", full, 99
            if is_dept:
                dept, dept_no = full, roman(first)
            out.append({"pdf_page": pi + 1, "level": level, "department": dept if level != "total" else None,
                        "name": full, **{k: amts.get(k) for k in COLS}})
    json.dump(out, open(out_path, "w"), indent=1, ensure_ascii=False)
    z = lambda v: v or 0
    bad = [r for r in out if z(r["gab"]) + z(r["inc"]) + z(r["dec"]) != z(r["sv"])]
    print(f"{len(out)} rows, {sum(r['level'] == 'department' for r in out)} departments; arithmetic bad {len(bad)}",
          file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
