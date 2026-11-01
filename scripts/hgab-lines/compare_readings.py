#!/usr/bin/env python3
"""Compare HB 10858 line items between the 2nd-reading and 3rd-reading prints.

Full outer join of the two hb_line_items.csv files (flatten.py output) on
  dept_no, agency_no, pap_path, region, operating_unit, sub_unit, fund_source, uacs_exp_cd
(plus an occurrence index, in case a key repeats inside one reading).

Status per row:
  same      key and amount equal
  changed   amount differs (key equal, or equal after normalising spacing/case/dashes)
  relabel   a 2nd-only row and a 3rd-only row with the same agency, expense class and
            amount whose labels differ: at most one of pap_path / region / operating_unit /
            sub_unit / fund_source differs and the rows print within 3 PDF pages of each
            other, or the labels are at least 80% similar. Not a money change.
  2nd-only  printed in the 2nd reading only (dropped by the 3rd)
  3rd-only  printed in the 3rd reading only (added by the 3rd)

Also reads the "Summary of FY 2027 New Appropriations" in each reading's Vol I-B
(printed p. 637 onward, thousands), checks its TOTAL NEW APPROPRIATIONS against that
reading's line items, and diffs the Summary lines between the readings.

Usage: compare_readings.py [r2_csv r3_csv out_csv]
  defaults: data/hgab-lines/2027/reading2/hb_line_items.csv, data/hgab-lines/2027/hb_line_items.csv,
            data/hgab-lines/2027/reading_changes.csv
  HB2_PDF_1B / HB3_PDF_1B   Vol I-B of each reading, for the Summary check
                            (defaults: the workbench's HB_BUDGET copy / ~/.paseo/uploads/*/hb-10858-vol-1b.pdf)
"""
import collections, csv, difflib, glob, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', '..', 'data', 'hgab-lines', '2027')
KEY = ('dept_no', 'agency_no', 'pap_path', 'region', 'operating_unit', 'sub_unit', 'fund_source', 'uacs_exp_cd')
LABELS = ('pap_path', 'region', 'operating_unit', 'sub_unit', 'fund_source')
PROV = ('volume', 'pdf_page', 'printed_page', 'line')


def norm(s):
    s = (s or '').casefold()
    s = re.sub(r'\s*[-–—]\s*', '-', s)
    s = re.sub(r'\s*([(),/>])\s*', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip()


def load(path):
    rows = list(csv.DictReader(open(path, newline='')))
    for r in rows:
        r['amount'] = int(r['amount'])
    return rows


def index(rows, keyf):
    seen = collections.Counter()
    out = {}
    for r in rows:
        k = keyf(r)
        seen[k] += 1
        out[k + (seen[k],)] = r
    return out


def page_dist(a, b):
    if a['volume'] != b['volume']:
        return 10 ** 6
    return abs(int(a['pdf_page'] or 0) - int(b['pdf_page'] or 0))


def match(r2, r3):
    """Return list of (status, how, row2 | None, row3 | None)."""
    out = []
    # 1. exact key
    a = index(r2, lambda r: tuple(r[k] for k in KEY))
    b = index(r3, lambda r: tuple(r[k] for k in KEY))
    for k, x in a.items():
        if k in b:
            y = b.pop(k)
            out.append(('same' if x['amount'] == y['amount'] else 'changed', 'exact', x, y))
    matched2 = {id(o[2]) for o in out}
    left2 = [x for x in r2 if id(x) not in matched2]
    left3 = list(b.values())
    # 2. same key after normalising spacing, case and dashes
    na = index(left2, lambda r: tuple(norm(r[k]) for k in KEY))
    nb = index(left3, lambda r: tuple(norm(r[k]) for k in KEY))
    for k in list(na):
        if k in nb:
            x, y = na.pop(k), nb.pop(k)
            out.append(('relabel' if x['amount'] == y['amount'] else 'changed', 'normalised label', x, y))
    left2, left3 = list(na.values()), list(nb.values())
    # 3. relabel: same agency, expense class and amount; labels differ
    g2, g3 = collections.defaultdict(list), collections.defaultdict(list)
    for x in left2:
        g2[(x['dept_no'], x['agency_no'], x['uacs_exp_cd'], x['amount'])].append(x)
    for y in left3:
        g3[(y['dept_no'], y['agency_no'], y['uacs_exp_cd'], y['amount'])].append(y)
    paired = set()
    for gk, xs in g2.items():
        cands = []
        for x in xs:
            for y in g3.get(gk, []):
                diff = [c for c in LABELS if norm(x[c]) != norm(y[c])]
                pd = page_dist(x, y)
                sim = difflib.SequenceMatcher(None, ' | '.join(norm(x[c]) for c in LABELS),
                                              ' | '.join(norm(y[c]) for c in LABELS)).ratio()
                if (len(diff) <= 1 and pd <= 3) or sim >= 0.8:
                    cands.append(((len(diff), pd, -sim), x, y, diff, pd))
        for _, x, y, diff, pd in sorted(cands, key=lambda c: c[0]):
            if id(x) in paired or id(y) in paired:
                continue
            paired.add(id(x)); paired.add(id(y))
            out.append(('relabel', f"relabel ({', '.join(diff) or 'spacing'} differs; same amount; pdf p.{x['pdf_page']} vs p.{y['pdf_page']})", x, y))
    for x in left2:
        if id(x) not in paired:
            out.append(('2nd-only', '', x, None))
    for y in left3:
        if id(y) not in paired:
            out.append(('3rd-only', '', None, y))
    return out


def build_rows(matches):
    rows = []
    for status, how, x, y in matches:
        base = y or x
        r = {'status': status, 'match': how}
        for c in ('dept_no', 'department', 'agency_no', 'agency', 'pap_path', 'region', 'operating_unit',
                  'sub_unit', 'fund_source', 'uacs_exp_cd', 'uacs_exp_dsc'):
            r[c] = base[c]
        a2 = x['amount'] if x else 0
        a3 = y['amount'] if y else 0
        r['amount_2nd'] = a2 if x else ''
        r['amount_3rd'] = a3 if y else ''
        r['delta'] = a3 - a2
        # the 2nd reading's labels, only where they differ from the 3rd's
        for c in LABELS:
            r[f'{c}_2nd'] = x[c] if (x and y and x[c] != y[c]) else ''
        for c in PROV:
            r[f'{c}_2nd'] = x[c] if x else ''
        for c in PROV:
            r[f'{c}_3rd'] = y[c] if y else ''
        r['note'] = ''
        rows.append(r)
    # flag money that only moved between expense classes of one leaf
    leaf = collections.defaultdict(int)
    lk = lambda r: (r['dept_no'], r['agency_no'], norm(r['pap_path']), norm(r['region']), norm(r['operating_unit']),
                    norm(r['sub_unit']), norm(r['fund_source']))
    for r in rows:
        leaf[lk(r)] += r['delta']
    for r in rows:
        if r['delta'] and leaf[lk(r)] == 0:
            r['note'] = 'moved between expense classes (leaf total unchanged)'
    order = {'changed': 0, '3rd-only': 1, '2nd-only': 2, 'relabel': 3, 'same': 4}
    rows.sort(key=lambda r: (order[r['status']], -abs(r['delta']), r['dept_no'], r['agency_no']))
    return rows


# --- Summary of FY 2027 New Appropriations (Vol I-B) -------------------------------------------
AMT = re.compile(r'^\d{1,3}(,\d{3})+$|^\d{1,3}$')


def summary_lines(pdf):
    """(pdf_page, line, label, thousands) for each Summary line, through TOTAL NEW APPROPRIATIONS."""
    import pymupdf
    sys.path.insert(0, HERE)
    from rows import rows as vrows
    doc = pymupdf.open(pdf)
    start = next(i for i in range(40, doc.page_count)
                 if re.search(r'summary of fy 2027 new appropriations', doc[i].get_text(), re.I))
    out = []
    for i in range(start, doc.page_count):
        for y, ws in vrows(doc[i]):
            if y < 45 or y > 740:
                continue
            ws = [w for w in ws if w[4] not in ('DS', '1”')]
            ln = None
            if ws and re.fullmatch(r'\d{1,3}', ws[0][4]) and ws[0][2] < 85:
                ln = int(ws[0][4]); ws = ws[1:]
            if ws and re.fullmatch(r'\d{1,3}', ws[-1][4]) and ws[-1][0] > doc[i].rect.width - 75:
                ws = ws[:-1]
            if not ws:
                continue
            amt = ws[-1][4] if (AMT.match(ws[-1][4]) and ws[-1][0] > 450) else None
            label = ' '.join(w[4] for w in (ws[:-1] if amt else ws)).strip(' .')
            label = re.sub(r'\.{2,}.*$', '', label).strip()
            if amt is None:
                continue
            out.append((i + 1, ln, label, int(amt.replace(',', ''))))
            if label.upper().startswith('TOTAL NEW APPROPRIATIONS'):
                return out
    return out


def summary_check(pdf2, pdf3, tot2, tot3):
    print('\n== Summary of FY 2027 New Appropriations (Vol I-B, thousands)')
    s = {}
    for name, pdf, tot in (('2nd', pdf2, tot2), ('3rd', pdf3, tot3)):
        if not pdf or not os.path.exists(pdf):
            print(f'  {name}: Vol I-B not found ({pdf}); skipped')
            continue
        lines = summary_lines(pdf)
        s[name] = lines
        fin = lines[-1] if lines and lines[-1][2].upper().startswith('TOTAL NEW APPROPRIATIONS') else None
        if fin is None:
            print(f'  {name}: TOTAL NEW APPROPRIATIONS row not found')
            continue
        ok = fin[3] * 1000 == tot
        print(f'  {name}: TOTAL NEW APPROPRIATIONS {fin[3]:,} thousand (pdf p.{fin[0]} line {fin[1]}); '
              f'line items {tot:,} -> {"MATCH" if ok else "MISMATCH, diff " + format(tot - fin[3] * 1000, ",")}'
              f'; {len(lines)} Summary lines from pdf p.{lines[0][0]}')
    if len(s) == 2:
        a, b = s['2nd'], s['3rd']
        sm = difflib.SequenceMatcher(None, [norm(x[2]) for x in a], [norm(x[2]) for x in b], autojunk=False)
        diffs = []
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == 'equal':
                for i, j in zip(range(i1, i2), range(j1, j2)):
                    if a[i][3] != b[j][3]:
                        diffs.append((a[i][2], a[i][3], b[j][3], a[i][0], b[j][0]))
            else:
                for i in range(i1, i2):
                    diffs.append((a[i][2] + ' [2nd label]', a[i][3], None, a[i][0], None))
                for j in range(j1, j2):
                    diffs.append((b[j][2] + ' [3rd label]', None, b[j][3], None, b[j][0]))
        print(f'  Summary lines that differ between readings: {len(diffs)}')
        for lab, x, y, p2, p3 in diffs:
            d = (y or 0) - (x or 0)
            print(f'    {lab[:70]:70} {x if x is None else format(x, ","):>15} -> {y if y is None else format(y, ","):>15}'
                  f'  ({d:+,})  pdf p.{p2}/{p3}')


def peso(v):
    return f'{v / 1e9:,.3f}B'


def main():
    args = sys.argv[1:]
    r2p = args[0] if args else os.path.join(DATA, 'reading2', 'hb_line_items.csv')
    r3p = args[1] if len(args) > 1 else os.path.join(DATA, 'hb_line_items.csv')
    outp = args[2] if len(args) > 2 else os.path.join(DATA, 'reading_changes.csv')
    r2, r3 = load(r2p), load(r3p)
    rows = build_rows(match(r2, r3))
    with open(outp, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    t2, t3 = sum(r['amount'] for r in r2), sum(r['amount'] for r in r3)
    print(f'2nd reading: {len(r2):,} line items, {t2:,} pesos')
    print(f'3rd reading: {len(r3):,} line items, {t3:,} pesos   (3rd - 2nd = {t3 - t2:+,})')
    print(f'wrote {len(rows):,} rows to {os.path.relpath(outp)}')
    print(f'\n{"status":10} {"rows":>7} {"2nd pesos":>22} {"3rd pesos":>22} {"delta":>18}')
    for st in ('same', 'changed', 'relabel', '2nd-only', '3rd-only'):
        rs = [r for r in rows if r['status'] == st]
        s2 = sum(r['amount_2nd'] or 0 for r in rs)
        s3 = sum(r['amount_3rd'] or 0 for r in rs)
        print(f'{st:10} {len(rs):>7,} {s2:>22,} {s3:>22,} {s3 - s2:>+18,}')
    moved = [r for r in rows if r['delta']]
    print(f'\nlines with a money change: {len(moved)}; gross movement {sum(abs(r["delta"]) for r in moved):,} pesos '
          f'(+{sum(r["delta"] for r in moved if r["delta"] > 0):,} / {sum(r["delta"] for r in moved if r["delta"] < 0):,})')
    ag = collections.defaultdict(int)
    for r in moved:
        ag[(r['dept_no'], r['agency_no'], r['agency'])] += r['delta']
    print('\nnet change by agency (3rd - 2nd):')
    for (d, a, n), v in sorted(ag.items(), key=lambda kv: -abs(kv[1])):
        print(f'  {d:>6} {a:>4} {n[:55]:55} {v:>+18,}')
    print('\ntop 20 changes by |delta| (pesos):')
    for r in sorted(moved, key=lambda r: -abs(r['delta']))[:20]:
        act = r['pap_path'].split(' > ')[-1]
        where = ' / '.join(x for x in (r['region'], r['operating_unit'], r['sub_unit'], r['fund_source']) if x)
        a2 = r['amount_2nd'] if r['amount_2nd'] != '' else '-'
        a3 = r['amount_3rd'] if r['amount_3rd'] != '' else '-'
        pp = r['printed_page_3rd'] or r['printed_page_2nd']
        print(f"  {r['status']:8} {r['dept_no']:>5} {r['agency_no']:>3} exp {r['uacs_exp_cd']}  {act[:60]} | {where[:50]}\n"
              f"           {a2 if a2 == '-' else format(a2, ','):>17} -> {a3 if a3 == '-' else format(a3, ','):>17}  ({r['delta']:+,})"
              f"  vol {r['volume_3rd'] or r['volume_2nd']} pdf p.{r['pdf_page_2nd'] or '-'}/{r['pdf_page_3rd'] or '-'}"
              f" printed p.{pp} line {r['line_2nd'] or '-'}/{r['line_3rd'] or '-'}"
              + (f"  [{r['note']}]" if r['note'] else ''))
    rel = [r for r in rows if r['status'] == 'relabel']
    if rel:
        print(f'\nrelabels ({len(rel)} rows, {sum(r["amount_3rd"] for r in rel):,} pesos):')
        for r in rel:
            ch = [f"{c}: {r[c + '_2nd']!r} -> {r[c]!r}" for c in LABELS if r[c + '_2nd']]
            print(f"  {r['dept_no']:>5} {r['agency_no']:>3} exp {r['uacs_exp_cd']} {r['amount_3rd']:>16,}  "
                  f"pdf p.{r['pdf_page_2nd']}/{r['pdf_page_3rd']}  " + ('; '.join(ch) or r['match'])[:400])
    pdf2 = os.environ.get('HB2_PDF_1B', '/tmp/dpwh-nep-head/HB_BUDGET/2 - HB 10858 VOL IB.pdf')
    pdf3 = os.environ.get('HB3_PDF_1B') or (glob.glob(os.path.expanduser('~/.paseo/uploads/*/hb-10858-vol-1b.pdf')) or [None])[0]
    summary_check(pdf2, pdf3, t2, t3)


if __name__ == '__main__':
    main()
