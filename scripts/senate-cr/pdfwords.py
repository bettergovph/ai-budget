"""Shared helpers: words of a text PDF page as visual lines, with kerning splits re-joined.

The Senate committee report PDFs are born-digital. pdfplumber gives each word with its box; some
printers split a number at a kerning pair ("2" + ",167,356"), so words that touch are joined back.
"""
import re

NUM_RE = re.compile(r"^\(?-?[\d,]+(\.\d+)?\)?$")


def amount(tok):
    """'(1,167,356)' -> -1167356, '-' -> 0, '1666' -> 1666. Returns None for non-numbers."""
    t = tok.strip()
    if t in ("-", "–", "—"):
        return 0
    if not NUM_RE.match(t) or not re.search(r"\d", t):
        return None
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()").replace(",", "")
    try:
        v = float(t)
    except ValueError:
        return None
    v = -v if neg else v
    return int(round(v)) if float(v).is_integer() else v


def page_words(page, gap=0.8, splits=(), **kw):
    """Words of a page, touching words on the same line joined (kerning splits), never across `splits`
    (x positions of column boundaries)."""
    ws = page.extract_words(keep_blank_chars=False, use_text_flow=False, **kw)
    out = []
    for ln in visual_lines(ws, tol=1.5):
        for w in ln["words"]:
            w = dict(w)
            if out and out[-1]["_ln"] is ln and -1.5 < w["x0"] - out[-1]["x1"] < gap \
                    and not any(out[-1]["x0"] < x <= w["x0"] + 1 for x in splits):
                p = out[-1]
                p["text"] += w["text"]
                p["x1"] = w["x1"]
                p["bottom"] = max(p["bottom"], w["bottom"])
                continue
            w["_ln"] = ln
            out.append(w)
    for w in out:
        del w["_ln"]
    return out


def visual_lines(words, tol=3.0):
    """Group words into lines by their top, within `tol` pt of the line's first word."""
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        for ln in lines[-3:]:
            if abs(ln["top"] - w["top"]) <= tol:
                ln["words"].append(w)
                break
        else:
            lines.append({"top": w["top"], "words": [w]})
    for ln in lines:
        ln["words"].sort(key=lambda w: w["x0"])
    return lines
