"""Annex B of the Senate committee report: amendments to the special and general provisions.

Each amendment cites a House bill volume, page and line(s), then says what to delete, insert or replace,
often followed by "The amended provision will now read as follows:" and the full new text.

Usage: parse_annex_b.py <Annex B pdf> <out.json>
One record per cited line reference: department, agency, part (special / general provisions), volume,
House page, line reference, the instruction, and the amended text when given.
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdfwords import page_words, visual_lines  # noqa: E402

TEXT_X = 185
NOW_READS = re.compile(r"The amended provision(s)? (will|shall) now read as follows:?", re.I)


def main(pdf_path, out_path):
    pdf = pdfplumber.open(pdf_path)
    recs = []
    dept = agency = None
    part = "special"
    vol = page_no = None
    cur = None
    for pi, page in enumerate(pdf.pages):
        words = page_words(page)
        head = " ".join(w["text"] for w in words if w["top"] < 100)
        if pi == 0 and "Table of Contents" in head + " ".join(w["text"] for w in words[:40]):
            continue
        if "GENERAL PROVISIONS" in head.upper():
            part = "general"
        foot = [w for w in words if w["top"] > page.height - 70]
        body = [w for w in words if 100 <= w["top"] <= page.height - 70]
        for ln in visual_lines(body):
            ws = ln["words"]
            t = " ".join(w["text"] for w in ws)
            if t.startswith("DEPARTMENT :") or t.startswith("DEPARTMENT:"):
                dept = re.sub(r"^DEPARTMENT\s*:\s*", "", t)
                agency = None
                continue
            if t.startswith("AGENCY :") or t.startswith("AGENCY:"):
                agency = re.sub(r"^AGENCY\s*:\s*", "", t)
                continue
            if re.fullmatch(r"(VOL\.|NO\./ LINE|NO\./|PARTICULARS|PAGE NO\.|NO\.|LINE|PAGE|NO\./ LINE PARTICULARS)( .*)?", t) \
                    and all(w["x0"] < 360 for w in ws) and len(t) < 30:
                continue
            left = [w for w in ws if w["x1"] < TEXT_X]
            text = " ".join(w["text"] for w in ws if w["x1"] >= TEXT_X)
            new_ref = None
            for w in left:
                if re.fullmatch(r"I-[ABC]", w["text"]):
                    vol = w["text"]
                elif w["x0"] < 120 and re.fullmatch(r"\d{1,4}", w["text"]):
                    page_no = int(w["text"])
                    if cur and cur["hb_page"] is None:
                        cur["hb_page"] = page_no
                else:
                    new_ref = (new_ref + " " if new_ref else "") + w["text"]
            # A reference printed down the narrow column ("Between / lines 50 / and 51") continues the one above.
            cont = new_ref and re.match(r"^(lines?|and|to|&)\b", new_ref) and cur is not None
            if new_ref and not cont and (re.match(r"^\d", new_ref) or re.match(r"^(Between|After|Before|From|Lines?)\b", new_ref)
                                         or cur is None):
                cur = {"part": part, "dept": dept, "agency": agency, "volume": vol, "hb_page": page_no,
                       "line_ref": new_ref, "lines": [], "senate_pdf_page": pi + 1}
                recs.append(cur)
            elif new_ref and cur:
                cur["line_ref"] += " " + new_ref  # "Between / lines 3 / and 4" printed down the column
            if text and cur:
                cur["lines"].append(text)
    for r in recs:
        body = " ".join(r.pop("lines"))
        m = NOW_READS.search(body)
        r["instruction"] = body[:m.start()].strip() if m else body.strip()
        r["amended_text"] = body[m.end():].strip() if m else ""
        r["line_ref"] = re.sub(r"\s+", " ", r["line_ref"] or "").strip()
    json.dump(recs, open(out_path, "w"), indent=1, ensure_ascii=False)
    print(f"{len(recs)} amendments ({sum(r['part'] == 'general' for r in recs)} general) -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
