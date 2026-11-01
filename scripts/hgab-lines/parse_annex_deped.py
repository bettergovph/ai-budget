#!/usr/bin/env python3
"""DepEd "Non-Implementing Unit Secondary Schools" annex (HB 10858 Vol I-B, printed pp. 711-856).

The main DepEd table prints only implementing-unit schools; every other secondary school is
folded into its division's "Division Office - Proper" line. This annex breaks those lines down:
region > schools division > school (incl. the division office itself), with Junior High PS, MOOE
and Total, and Senior High MOOE.

Usage: parse_annex_deped.py out.csv [first_pdf_idx last_pdf_idx]
Checks: PS + MOOE = Total on every row; schools sum to their division; divisions to their region.
"""
import csv, re, sys
import pymupdf
from rows import VOL
from parse_hb import visual_rows, REGION_RX, parse_amount

AMT = re.compile(r'^\d{1,3}(,\d{3})*$')
COLS = ['jhs_ps', 'jhs_mooe', 'jhs_total', 'shs_mooe']


def page_cols(rows):
    """Column centres from the 'PS MOOE TOTAL MOOE' header row of this page."""
    for _, ws in rows:
        toks = [w[4] for w in ws]
        if toks == ['PS', 'MOOE', 'TOTAL', 'MOOE']:
            return [(c, (w[0] + w[2]) / 2) for c, w in zip(COLS, ws)]
    return None


def main(out, a=728, b=873):
    doc = pymupdf.open(VOL['1b'])
    items = []
    pending = None
    for p in range(a, b + 1):
        rows = visual_rows(doc[p])
        cols = page_cols(rows)
        if cols is None:
            continue
        printed = None
        for y, ws in rows:
            if y < 40 and ws and ws[0][4].isdigit():
                printed = int(ws[0][4])
            elif y < 40 and ws and ws[-1][4].isdigit():
                printed = int(ws[-1][4])
            elif y > 730 and len(ws) == 1 and ws[0][4].isdigit():
                printed = int(ws[0][4])  # the list's first page numbers itself at the foot ("711")
        started = False
        for y, ws in rows:
            toks = [w[4] for w in ws]
            if toks == ['PS', 'MOOE', 'TOTAL', 'MOOE']:
                started = True
                continue
            if not started or y > 745 or (y > 730 and len(ws) == 1 and ws[0][4].isdigit()):
                continue
            amt_zone = cols[0][1] - 40
            amts = [w for w in ws if (AMT.match(w[4]) or w[4] == '-') and w[0] > amt_zone]
            lab_ws = [w for w in ws if w not in amts]
            label = ' '.join(w[4] for w in lab_ws).strip()
            if not label and not amts:
                continue
            row = {'label': label, 'x0': lab_ws[0][0] if lab_ws else None, 'pdf_page': p + 1, 'printed_page': printed}
            for w in amts:
                if w[4] == '-':
                    continue
                col = min(cols, key=lambda c: abs((w[2] - 20) - c[1]))[0]
                row[col] = parse_amount(w[4])
            has_amt = any(c in row for c in COLS) or any(w[4] == '-' for w in amts)
            if pending is not None:
                # wrapped name: the amounts sit on the last line
                pending['label'] = (pending['label'] + ' ' + label).strip()
                pending.update({k: v for k, v in row.items() if k in COLS})
                if has_amt:
                    items.append(pending)
                    pending = None
                continue
            if not has_amt:
                pending = row
                continue
            items.append(row)
    region = division = None
    grand = None
    out_rows, problems = [], []
    groups = {}
    for it in items:
        lab = it['label']
        if lab.lower() == 'grand total':
            grand = {c: it.get(c, 0) for c in COLS}
            continue
        if REGION_RX.match(lab) or lab.startswith('Bangsamoro'):
            region, division, level = lab, None, 'region'
        elif re.match(r'^(Schools )?Division of\b|^Division of\b', lab) and lab != 'Division Office - Proper':
            division, level = lab, 'division'
        else:
            level = 'school'
        v = {c: it.get(c, 0) for c in COLS}
        if v['jhs_ps'] + v['jhs_mooe'] != v['jhs_total']:
            problems.append(f"PS+MOOE != Total: {lab} p{it['printed_page']}")
        rec = {'level': level, 'region': region, 'division': division if level != 'region' else None,
               'school': lab if level == 'school' else None, **v,
               'pdf_page': it['pdf_page'], 'printed_page': it['printed_page']}
        out_rows.append(rec)
        if level == 'school':
            for c in COLS:
                groups.setdefault(('sum_div', region, division), {c: 0 for c in COLS})[c] += v[c]
        elif level == 'division':
            for c in COLS:
                groups.setdefault(('sum_reg', region, None), {c: 0 for c in COLS})[c] += v[c]
    for r in out_rows:
        if r['level'] == 'division':
            s = groups.get(('sum_div', r['region'], r['division']))
            if s is None or any(s[c] != r[c] for c in COLS):
                problems.append(f"schools != division: {r['division']} ({r['region']}) printed {[r[c] for c in COLS]} sum {s and [s[c] for c in COLS]}")
        if r['level'] == 'region':
            s = groups.get(('sum_reg', r['region'], None))
            if s is None or any(s[c] != r[c] for c in COLS):
                problems.append(f"divisions != region: {r['region']} printed {[r[c] for c in COLS]} sum {s and [s[c] for c in COLS]}")
    with open(out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    n = {lvl: sum(1 for r in out_rows if r['level'] == lvl) for lvl in ('region', 'division', 'school')}
    tot = {c: sum(r[c] for r in out_rows if r['level'] == 'region') for c in COLS}
    if grand != tot:
        problems.append(f'regions != Grand Total: {tot} vs {grand}')
    print(f"{n} rows; region totals {tot}; {len(problems)} problems")
    for p in problems[:30]:
        print('  ', p)


if __name__ == '__main__':
    args = sys.argv[1:]
    main(args[0], *(int(x) for x in args[1:3]))
