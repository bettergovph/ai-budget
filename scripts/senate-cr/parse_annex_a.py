"""Annex A of the Senate committee report on HB 10858: line-by-line amendments.

Each amended row cites the House bill page and line it changes, then gives five columns in thousand
pesos: House bill (GAB), increase, decrease, net change, Senate committee report (SV).

Usage: parse_annex_a.py <Annex A pdf> <out.json>
Writes one record per amount row, in document order, with its department, agency, the text lines
above it (item name, region, operating unit), the cited HB volume/page/line, and any instruction
("Between lines 47 and 49, insert ...") in force. Bracketed rows ([MOOE]) are deletions.
"""
import json
import re
import sys

import pdfplumber

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))

from pdfwords import amount, page_words, visual_lines

COLS = ("gab", "inc", "dec", "net", "sv")
CLASS_LABELS = {
    "PS", "MOOE", "CO", "FINEX", "TOTAL", "FAPS", "LOAN PROCEEDS", "GOP COUNTERPART",
    "SUB-TOTAL", "SUBTOTAL", "GRANT PROCEEDS",
}
ROMAN = re.compile(r"^[IVXL]+\.$")
AGENCY = re.compile(r"^[A-Z]{1,2}(\.\d+)?\.?$")
REF_PAGE = re.compile(r"^\d{1,4}$")
REF_LINE = re.compile(r"^\d{1,3}(\s*-\s*\d{1,3})?$")
INSTR = re.compile(
    r"^(Between|On page|On line|On lines|From line|From lines|In line|In lines|After line|Before line|Insert|Delete|"
    r"Under|Below|Above|Lines?\s+\d)", re.I)


def roman(t):
    v = {"I": 1, "V": 5, "X": 10, "L": 50}
    t = t.rstrip(".")
    return sum(-v[a] if i + 1 < len(t) and v[a] < v[t[i + 1]] else v[a] for i, a in enumerate(t))


def columns(words):
    """Right edges of the five amount columns, read from this page's header."""
    hdr = [w for w in words if 90 < w["top"] < 140]
    def find(t, pick=min):
        c = [w for w in hdr if w["text"] == t]
        return pick(c, key=lambda w: w["x0"]) if c else None
    gab = find("10858)")
    inc, dec, chg = find("Increase"), find("Decrease"), find("Change")
    sv = find("10858", max)
    if not all((gab, inc, dec, chg, sv)):
        return None
    return {"gab": gab["x1"], "inc": inc["x1"] + 6, "dec": dec["x1"] + 7, "net": chg["x1"] + 4, "sv": sv["x1"] + 3}


def split_line(ln, cols):
    """A visual line -> (page ref, line ref, text words, amounts by column)."""
    page_ref = line_ref = None
    text, amts = [], {}
    ws = ln["words"]
    # A line-range ref is sometimes three tokens ("21", "-", "23"); join refs left of the text column.
    left = [w for w in ws if w["x1"] < 116]
    rest = [w for w in ws if w["x1"] >= 116]
    left_txt = [w for w in left]
    if left and all(re.match(r"^[\d\-]+$", w["text"]) for w in left):
        toks = [w for w in left]
        pg = [w for w in toks if w["x1"] <= 80]
        li = [w for w in toks if w["x1"] > 80]
        if pg and REF_PAGE.match(pg[0]["text"]):
            page_ref = int(pg[0]["text"])
        if li:
            s = "".join(w["text"] for w in li)
            if REF_LINE.match(s):
                line_ref = s.replace(" ", "")
        left_txt = []
    for w in left_txt + rest:
        a = amount(w["text"]) if w["x0"] > 270 else None
        if a is not None and cols:
            c = min(COLS, key=lambda k: abs(cols[k] - w["x1"]))
            amts[c] = a
        else:
            text.append(w)
    return page_ref, line_ref, text, amts


def main(pdf_path, out_path):
    pdf = pdfplumber.open(pdf_path)
    recs = []
    dept = agency = None
    volume = None
    hb_page = None
    buf = []          # text lines since the last amount row: [{"text", "x0", "page_ref", "line_ref"}]
    item = None       # the item the class rows (PS/MOOE/CO/TOTAL) belong to
    instruction = None
    instr_open = False
    in_note = False
    started = False
    for pi, page in enumerate(pdf.pages):
        words = page_words(page)
        alltext = " ".join(w["text"] for w in words[:80])
        if "Line Item of Appropriations" in " ".join(w["text"] for w in words if w["top"] < 140) or \
                ("Line" in alltext and "Appropriations," in alltext):
            started = True
        if not started:
            continue
        cols = columns(words)
        m = re.search(r"VOLUME (I-[A-C])", alltext)
        if m:
            volume = {"I-A": "1a", "I-B": "1b", "I-C": "1c"}[m.group(1)]
        footer = [w for w in words if w["text"] == "LINE" and w["top"] > 800]
        foot_top = min((w["top"] for w in footer), default=page.height)
        label = None
        fw = [w for w in words if w["top"] >= foot_top - 1]
        if fw:
            label = fw[-1]["text"]
        body = [w for w in words if 133 < w["top"] < foot_top - 1]
        lines = [(ln["top"], *split_line(ln, cols)) for ln in visual_lines(body)]
        # Amounts printed a little above their label land on a line of their own: give them to the next
        # line that has text (and lacks those columns), when it is close below.
        merged = []
        i = 0
        while i < len(lines):
            top, pref, lref, tw, amts = lines[i]
            if amts and not tw and pref is None and lref is None and i + 1 < len(lines):
                ntop, npref, nlref, ntw, namts = lines[i + 1]
                both = {**namts, **amts}
                # ... unless they don't add up with the label's own House amount: then they are a line of their own
                # (SUCs, p. 42-43: an unnamed object, +1,000, printed above "Supplies and Materials Expenses 14,969").
                adds = not ("gab" in namts and "net" in both and "sv" in both) or namts["gab"] + both["net"] == both["sv"]
                if ntw and ntop - top < 12 and not (set(amts) & set(namts)) and adds:
                    lines[i + 1] = (ntop, npref, nlref, ntw, {**namts, **amts})
                    i += 1
                    continue
            merged.append(lines[i])
            i += 1
        for _top, pref, lref, tw, amts in merged:
            text = " ".join(w["text"] for w in tw).strip()
            x0 = tw[0]["x0"] if tw else None
            # Notes ("Note: The totals and sub-totals ... accordingly.", "Note: Refer to Annex ...") run to a full stop.
            if in_note:
                if text.endswith("."):
                    in_note = False
                continue
            if text.startswith("Note:"):
                in_note = not text.endswith(".")
                continue
            if pref is not None:
                hb_page = pref
            # Department / agency headings carry totals and sit at the left margin.
            # Department / agency headings carry totals and start at the left margin; a long name wraps, so
            # the heading may begin on a text line above the amounts.
            head = None
            if amts:
                run = []
                for b in reversed(buf):
                    if b["x0"] is None or b["x0"] >= 100 or b["line_ref"]:
                        break
                    run.insert(0, b)
                # The heading starts at the last left-margin line that opens with a numeral or a letter.
                starts = [i for i, b in enumerate(run) if b["x0"] < 60 and b["text"]
                          and (ROMAN.match(b["text"].split()[0]) or AGENCY.match(b["text"].split()[0]))]
                if starts:
                    head = (" ".join(b["text"] for b in run[starts[-1]:]) + " " + text).strip()
                elif x0 is not None and x0 < 60:
                    head = text
            first = head.split()[0] if head else ""
            if head and ROMAN.match(first) and 0 < roman(first) - (roman(dept["no"]) if dept else 0) <= 12:
                dept = {"no": first.rstrip("."), "name": head[len(first):].strip()}
                agency = None
                hb_page = pref
                buf, item, instruction, instr_open = [], None, None, False
                recs.append(rec("dept_total", dept, agency, volume, hb_page, None, [], dept["name"], amts, pi, label, None))
                continue
            if head and AGENCY.match(first):
                agency = {"no": first.rstrip("."), "name": head[len(first):].strip()}
                buf, item, instruction, instr_open = [], None, None, False
                recs.append(rec("agency_total", dept, agency, volume, hb_page, None, [], agency["name"], amts, pi, label, None))
                continue
            if not amts:
                if not text and pref is None and lref is None:
                    continue
                if text and INSTR.match(text):
                    instruction = text
                    instr_open = not text.rstrip().endswith(":")
                    if lref is None and pref is not None:
                        pass
                    continue
                if instr_open and text:
                    instruction += " " + text
                    if text.rstrip().endswith((":", ".")):
                        instr_open = False
                    continue
                if text.startswith(("By Activity", "By Object", "By Purpose", "By Program")):
                    buf, item = [], None
                    section = text.rstrip(":")
                    recs.append({"kind": "section", "text": section, "pdf_page": pi + 1})
                    continue
                buf.append({"text": text, "x0": x0, "page_ref": pref, "line_ref": lref})
                continue
            # An amount row.
            instr_open = False
            bare = text.strip("[]").upper()
            deleted = text.startswith("[")
            refs_l = [b["line_ref"] for b in buf if b["line_ref"]]
            if bare in CLASS_LABELS or re.match(r"^(PS|MOOE|CO|FINEX)\b", bare):
                if buf:
                    item = {"lines": [b["text"] for b in buf if b["text"]], "line_ref": refs_l[-1] if refs_l else None,
                            "hb_page": hb_page, "deleted": any(b["text"].startswith("[") for b in buf)}
                    buf = []
                lr = lref or (item or {}).get("line_ref")
                if lref and item:
                    pass
                recs.append(rec("class", dept, agency, volume, hb_page, lr, (item or {}).get("lines", []),
                                text.strip("[]"), amts, pi, label, instruction, deleted or (item or {}).get("deleted", False)))
            else:
                ctx = [b["text"] for b in buf if b["text"]]
                lr = lref or (refs_l[-1] if refs_l else None)
                # Wrapped object names: the first part sits on the line(s) just above at the same indent.
                name_parts, ctx_parts = [], []
                for b in buf:
                    if b["text"] and x0 is not None and b["x0"] is not None and abs(b["x0"] - x0) < 3:
                        name_parts.append(b["text"])
                    elif b["text"]:
                        ctx_parts.append(b["text"])
                name = " ".join(name_parts + [text]).strip()
                buf = []
                item = None
                recs.append(rec("object", dept, agency, volume, hb_page, lr, ctx_parts, name.strip("[]"), amts, pi,
                                label, instruction, deleted or name.startswith("[")))
    json.dump(recs, open(out_path, "w"), indent=1, ensure_ascii=False)
    n = sum(1 for r in recs if r["kind"] != "section")
    print(f"{n} amount rows -> {out_path}", file=sys.stderr)


def rec(kind, dept, agency, volume, hb_page, line_ref, ctx, label, amts, pi, page_label, instruction, deleted=False):
    head = " ".join(list(ctx[-1:]) + [label]).upper().lstrip("[")
    subtotal = kind in ("class", "object") and bool(re.match(r"^(SUB-?TOTAL|TOTAL\b)", head)) and label.upper() != "TOTAL" \
        or kind == "class" and bool(ctx) and bool(re.match(r"^\[?(SUB-?TOTAL|TOTAL\b)", ctx[-1].upper()))
    return {
        "kind": kind, "subtotal": subtotal,
        "dept_no": (dept or {}).get("no"), "dept": (dept or {}).get("name"),
        "agency_no": (agency or {}).get("no"), "agency": (agency or {}).get("name"),
        "volume": volume, "hb_page": hb_page, "hb_line": line_ref,
        "context": ctx, "label": label,
        **{k: amts.get(k) for k in COLS},
        "deleted": deleted, "instruction": instruction,
        "pdf_page": pi + 1, "page_label": page_label,
    }


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
