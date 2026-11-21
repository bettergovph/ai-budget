"""Join Annex A (Senate line-by-line amendments) to the House bill's parsed tables.

Each Annex A row cites a House bill volume, printed page and line. The House bill tables
(data/hgab-lines/2027/tables-vol{1a,1b}.json, from scripts/hgab-lines/parse_hb.py) hold every printed row
with its volume, printed page, first and last line and amounts. A row matches when the node at that place
prints the same House bill amount for the same column (PS/MOOE/CO/FinEx/Total, a fund line, or an object
of expenditure in thousands).

Usage: map_annex_a.py <annex_a.json> <hgab-lines dir> <out.csv>
status: exact      the cited node prints the same House amount
        ref_only   a node sits at the cited line but its amount differs (or the class is new to it)
        new        no House amount (an insertion) and no node to compare
        unmatched  a House amount but no node at the cited place
"""
import csv
import json
import re
import sys
from collections import defaultdict

CLS = {"PS": "PS", "MOOE": "MOOE", "CO": "CO", "FINEX": "FinEx", "TOTAL": "Total"}


def nodes_of(tables):
    """Yield (kind, ctx, node, path) for every printed node."""
    for t in tables:
        def walk(n, path):
            for c in n.get("children", []):
                p = path + [c["label"]]
                yield t["kind"], t["ctx"], c, p
                yield from walk(c, p)
        yield from walk(t["tree"], [])


def line_hit(n, lr):
    return not (n.get("_last", n["lineno"]) < lr[0] or n["lineno"] > lr[1])


def norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def line_range(ref):
    if not ref:
        return None
    m = re.match(r"^(\d+)(?:-(\d+))?$", ref)
    if not m:
        return None
    a = int(m.group(1))
    return a, int(m.group(2) or a)


def main(annex, lines_dir, out):
    recs = json.load(open(annex))
    idx = defaultdict(list)  # (vol, printed_page) -> [(kind, ctx, node, path)]
    for v in ("1a", "1b"):
        for kind, ctx, n, path in nodes_of(json.load(open(f"{lines_dir}/tables-vol{v}.json"))):
            idx[(v, n["printed_page"])].append((kind, ctx, n, path))
    rows = []
    stats = defaultdict(int)
    for r in recs:
        if r["kind"] not in ("class", "object"):
            continue
        lr = line_range(r["hb_line"])
        cls = CLS.get(r["label"].upper().strip())
        want = r["gab"] * 1000 if r["gab"] else None
        best, have, page_used = None, None, r["hb_page"]
        # The cited page first; the Senate copy sometimes forgets to print a page change, so the pages
        # either side are tried too, but there only an equal House amount (and, for objects, label) counts.
        tries = [(0, 0), (1, 0), (-1, 0), (2, 0), (0, 4)]
        for dp, slack in tries:
            if not (r["volume"] and r["hb_page"] and lr):
                break
            pg = r["hb_page"] + dp
            for kind, ctx, n, path in idx.get((r["volume"], pg), []):
                lo, hi = n["lineno"], n.get("_last", n["lineno"])
                if hi < lr[0] - slack or lo > lr[1] + slack:
                    continue
                if (r["kind"] == "object") != (kind == "O"):
                    continue
                a = n.get("amounts", {})
                if r["kind"] == "object":
                    got = a.get("thousands")
                    got = got * 1000 if got is not None else None
                    if dp and norm(n["label"]) != norm(r["label"]):
                        continue
                else:
                    got = a.get(cls) if cls else a.get("Total", next(iter(a.values()), None))
                if (dp or slack) and (want is None or got != want):
                    continue
                if best is None or (got == want and have != want) or \
                        (got == want and have == want and n["lineno"] >= best[2]["lineno"]):
                    best, have, page_used = (kind, ctx, n, path), got, pg
            if best and (have == want or not want):
                break
        if not best and not lr and want and r["volume"] and r["hb_page"] and r["kind"] == "class":
            # No line cited (e.g. a project TOTAL whose lines sit on its fund rows): the node on the cited page
            # that prints this amount and whose label is one of the context lines, if there is exactly one.
            ctxn = {norm(c) for c in r["context"]}
            hits = [(k, c, n, p) for k, c, n, p in idx.get((r["volume"], r["hb_page"]), [])
                    if k != "O" and n.get("amounts", {}).get(cls or "Total") == want and norm(n["label"]) in ctxn]
            if len(hits) == 1:
                best, have, page_used = hits[0], want, r["hb_page"]
                lr = (best[2]["lineno"], best[2]["lineno"])
        if best and want is not None and have == want:
            status = "exact" if page_used == r["hb_page"] and line_hit(best[2], lr) else "exact_nearby"
        elif best and not want and have is None:
            status = "new_class"
        elif best:
            status = "ref_only"
        elif not want:
            status = "new"
        elif r["dept_no"] == "XLIII" or not r["volume"]:
            status = "no_hb_table"  # Unprogrammed Appropriations and the DOE corporations: not in our House tables
        else:
            status = "unmatched"
        if r.get("subtotal"):
            status = "subtotal"
        stats[status] += 1
        kind, ctx, n, path = best if best else (None, {}, {}, [])
        rows.append({
            "senate_pdf_page": r["pdf_page"], "dept_no": r["dept_no"], "dept": r["dept"],
            "agency_no": r["agency_no"], "agency": r["agency"],
            "volume": r["volume"], "hb_page": r["hb_page"], "hb_line": r["hb_line"],
            "row_kind": r["kind"], "context": " > ".join(r["context"]), "label": r["label"],
            "deleted": int(bool(r["deleted"])), "subtotal": int(bool(r.get("subtotal"))),
            "hb_thousands": r["gab"], "inc_thousands": r["inc"], "dec_thousands": r["dec"],
            "net_thousands": r["net"], "senate_thousands": r["sv"],
            "instruction": r["instruction"] or "",
            "status": status,
            "hb_table": kind or "", "hb_node_line": n.get("lineno", ""), "hb_node_type": n.get("type", ""),
            "hb_node_label": n.get("label", ""), "hb_path": " > ".join(path),
            "hb_node_amount": have if have is not None else "",
            "hb_pdf_page": n.get("pdf_page", ""),
            # The explorer's key for a House line: document, PDF page, line, expense class code.
            "hb_doc": f"hb10858-3r-vol-{r['volume'][1:]}".replace("vol-a", "vol-ia").replace("vol-b", "vol-ib") if r["volume"] and best else "",
            "exp_cd": {"PS": 1, "MOOE": 2, "FinEx": 3, "CO": 6}.get(cls or "", "") if best else "",
        })
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(dict(stats), file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:4])
