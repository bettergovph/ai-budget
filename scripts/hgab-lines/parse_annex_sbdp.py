#!/usr/bin/env python3
"""LGSF "Support to the Barangay Development Program" annex (HB 10858 Vol I-B, printed p. 920 on):
the numbered list of qualified (NTF-ELCAC cleared) barangays. No amounts are printed per barangay;
the special provision gives P9,740,000,000 for the 1,948 barangays listed.

Usage: parse_annex_sbdp.py out.csv [first_pdf_idx last_pdf_idx]
Check: rows are numbered 1..N without gaps, and N equals the count in the special provision.
"""
import csv, re, sys
import pymupdf
from rows import VOL
from parse_hb import visual_rows

HEAD = ['REGION', 'PROVINCE', 'CITY/MUNICIPALITY', 'BARANGAY']
EXPECTED = 1948  # "one thousand nine hundred forty eight (1,948) cleared barangays", LGSF special provision 2


def main(out, a=943, b=981):
    doc = pymupdf.open(VOL['1b'])
    rows_out, problems = [], []
    for p in range(a, b + 1):
        rows = visual_rows(doc[p])
        starts = None
        for _, ws in rows:
            if [w[4] for w in ws] == HEAD:
                starts = [w[0] for w in ws]
        if starts is None:
            continue
        printed = next((int(w[4]) for y, ws in rows if y < 40 or y > 725 for w in ws if w[4].isdigit()), None)
        body = [(y, ws) for y, ws in rows
                if ws and re.fullmatch(r'\d+', ws[0][4]) and len(ws) >= 3 and ws[0][2] <= starts[0] and y >= 40]

        def gap_cells(ws):
            # cells are left-aligned under centred headers: split on the wide gaps between cells
            # (words inside a cell sit ~3pt apart, cells 20pt+)
            cells, cur, last_x1 = [], [], None
            for w in ws[1:]:
                if last_x1 is not None and w[0] - last_x1 > 12:
                    cells.append(cur); cur = []
                cur.append(w); last_x1 = w[2]
            cells.append(cur)
            return cells
        # column starts on this page, from the rows that split cleanly into four cells
        col_x = [[], [], [], []]
        for _, ws in body:
            c = gap_cells(ws)
            if len(c) == 4:
                for k in range(4):
                    col_x[k].append(c[k][0][0])
        col_x = [sorted(v)[len(v) // 2] if v else None for v in col_x]
        for y, ws in body:
            c = gap_cells(ws)
            if len(c) == 4:
                cells = [' '.join(w[4] for w in cc) for cc in c]
            else:
                # a long name runs into the next column: place each word by the column starts
                cells = ['', '', '', '']
                for w in ws[1:]:
                    k = max([i for i in range(4) if col_x[i] is not None and w[0] >= col_x[i] - 3] or [0])
                    cells[k] = (cells[k] + ' ' + w[4]).strip()
                if not all(cells):
                    problems.append(f"p{p + 1} no {ws[0][4]}: {cells}")
            rows_out.append({'no': int(ws[0][4]), 'region': cells[0], 'province': cells[1],
                             'city_municipality': cells[2], 'barangay': cells[3],
                             'pdf_page': p + 1, 'printed_page': printed})
    nums = [r['no'] for r in rows_out]
    gaps = [n for n in range(1, max(nums) + 1) if n not in set(nums)]
    dups = len(nums) - len(set(nums))
    with open(out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()))
        w.writeheader()
        w.writerows(rows_out)
    empty = sum(1 for r in rows_out if not all(r[k] for k in ('region', 'province', 'city_municipality', 'barangay')))
    by_region = {}
    for r in rows_out:
        by_region[r['region']] = by_region.get(r['region'], 0) + 1
    print(f'{len(rows_out)} barangays (expected {EXPECTED}); numbering gaps {gaps[:10]}; duplicates {dups}; '
          f'rows with an empty cell {empty}')
    print('by region:', by_region)
    for x in problems[:10]:
        print('  ', x)


if __name__ == '__main__':
    args = sys.argv[1:]
    main(args[0], *(int(x) for x in args[1:3]))
