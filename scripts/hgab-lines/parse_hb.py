#!/usr/bin/env python3
"""
Exploratory parser for the non-infrastructure tables of HB 10858 (FY 2027 GAB,
third reading). Native text layer only (InDesign PDFs), geometry first.

Per agency the bill prints three money tables:
  S  "New Appropriations, by Programs/Projects"            program level, pesos
  D  "New Appropriations, by Programs/Activities/Projects"  activity > region > OU, pesos
     (inside the special provision "Appropriations for Activities or Projects")
  O  "New Appropriations, by Object of Expenditures"        object level, thousands

Output: one JSON per volume with every parsed table (tree + checks) and a flat
list of leaf line items in a GAA-like shape.

Usage: parse_hb.py <vol> [first_pdf_idx] [last_pdf_idx] > out.json
"""
import json, re, sys
import pymupdf
from rows import VOL

AMT = re.compile(r'^\(?\d{1,3}(,\d{3})*(\.0+)?\)?$')  # the bill misprints a few as "117,681,000.0" 
INT = re.compile(r'^\d{1,3}$')
SUBTOTAL = re.compile(r'^(sub-?total|total)\b', re.I)
TABLE_HDR = [
    ('D', re.compile(r'^New Appropriations,? by Programs?/Activities/Projects', re.I)),
    ('S', re.compile(r'^New Appropriations,? by Programs?/Projects', re.I)),
    ('S', re.compile(r'^New Appropriations,? by Programs?$', re.I)),
    ('P', re.compile(r'^New Appropriations,? by Purpose', re.I)),
    ('O', re.compile(r'^New Appropriations,?\.? by Object of Expenditures', re.I)),
]
DEPT_RE = re.compile(r'^([IVXL]+)\.?\s+(.+)$')
AGY_RE = re.compile(r'^([A-Z]{1,2}(?:\.\d+)?)\.?\s+(.+)$')
COLS = ['PS', 'MOOE', 'FinEx', 'CO', 'Total']
EVEN_LINENO_X1 = 45.0  # left line-number right edge on even printed pages


def visual_rows(page, ymerge=2.5):
    ws = sorted(page.get_text('words'), key=lambda w: (w[1], w[0]))
    out = []
    for w in ws:
        t = w[4]
        if re.fullmatch(r'[.…_]+', t):
            continue
        t = re.sub(r'(?<=\w)\.{2,}[_.]*$', '', t)
        w = (w[0], w[1], w[2], w[3], t)
        if out and w[1] - out[-1][0] <= ymerge:
            out[-1][1].append(w)
            out[-1][0] = min(out[-1][0], w[1])
        else:
            out.append([w[1], [w]])
    return [(y, sorted(ws, key=lambda w: w[0])) for y, ws in out]


def strip_margins(ws, page_w):
    """Remove printed line numbers at both margins; return (lineno, shift, words)."""
    lineno = None
    shift = None
    ws = [w for w in ws if w[4] not in ('DS', '1”')]
    left = False
    if ws and INT.match(ws[0][4]) and ws[0][2] < 85:
        left = True
        lineno = int(ws[0][4])
        shift = ws[0][2] - EVEN_LINENO_X1
        ws = ws[1:]
    if ws and INT.match(ws[-1][4]) and (
            (lineno is not None and int(ws[-1][4]) == lineno and ws[-1][0] > page_w - 110)
            or (lineno is None and ws[-1][0] > page_w - 75)):
        if lineno is None:
            lineno = int(ws[-1][4])
        ws = ws[:-1]
    # the "DS" / 1" crop marks
    ws = [w for w in ws if w[4] not in ('DS', '1”')]
    return lineno, shift, ws, left


class Table:
    def __init__(self, kind, ctx, loc):
        self.kind = kind
        self.ctx = dict(ctx)
        self.loc = loc
        self.cols = None      # list of (name, center_x normalized)
        self.hdr_words = []
        self.rows = []        # parsed rows
        self.closed = False

    def set_cols_from_header(self):
        words = self.hdr_words
        found = {}
        def span(pred):
            xs = [(w[0], w[2]) for w in words if pred(w[4])]
            return xs
        def center_of(tokens):
            if not tokens:
                return None
            return (min(t[0] for t in tokens) + max(t[1] for t in tokens)) / 2
        ps = span(lambda t: t in ('Personnel', 'Services'))
        # "Services" also appears nowhere else in headers, but group by proximity to Personnel
        if ps:
            px = [w for w in words if w[4] == 'Personnel']
            if px:
                x0 = px[0][0]
                ps = [(w[0], w[2]) for w in words if w[4] in ('Personnel', 'Services') and abs(w[0] - x0) < 60]
            found['PS'] = center_of(ps)
        mo = [(w[0], w[2]) for w in words if w[4] in ('Maintenance',)]
        if mo:
            found['MOOE'] = center_of(mo)
        fe = [(w[0], w[2]) for w in words if w[4] == 'Financial']
        if fe:
            found['FinEx'] = center_of(fe)
        co = [(w[0], w[2]) for w in words if w[4] == 'Capital']
        if co:
            found['CO'] = center_of(co)
        to = [(w[0], w[2]) for w in words if w[4] == 'Total']
        if to:
            found['Total'] = center_of(to[-1:])
        self.cols = sorted(found.items(), key=lambda kv: kv[1])

    def assign(self, w):
        """Column for an amount token (normalized x); right-aligned numbers sit
        right of the header centre, so compare the number's right edge to the
        header centre plus a small offset."""
        xr = w[2]
        best, bd = None, 1e9
        for name, cx in self.cols:
            d = abs(xr - (cx + 22))
            if d < bd:
                best, bd = name, d
        return best, bd


START_DEPT = {'1a': 0, '1b': 21, '1c': 21, '2': 0}


def roman(s):
    vals = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500}
    total = 0
    for i, ch in enumerate(s):
        v = vals[ch]
        total += -v if i + 1 < len(s) and vals[s[i + 1]] > v else v
    return total


def parse_amount(t):
    neg = t.startswith('(')
    v = int(re.sub(r'\.0+$', '', t.strip('()')).replace(',', ''))
    return -v if neg else v


def parse_volume(vol, a=None, b=None):
    doc = pymupdf.open(VOL[vol])
    a = a or 0
    b = doc.page_count - 1 if b is None else b
    ctx = {'dept_no': None, 'dept': None, 'agency_no': None, 'agency': None}
    last_dept = [START_DEPT.get(vol, 0)]
    tables = []
    cur = None
    state = 'TEXT'
    pending_label = None
    for pno in range(a, b + 1):
        page = doc[pno]
        pw = page.rect.width
        printed = None
        vrows = visual_rows(page)
        for y, ws in vrows:
            if y < 45 or y > 740:  # running header / footer carry the printed page number
                nums = [w[4] for w in ws if w[4].isdigit() and len(w[4]) <= 4]
                if nums and printed is None:
                    printed = int(nums[0]) if ws[0][4].isdigit() else int(nums[-1])
        for y, ws in vrows:
            if y < 45:
                continue
            if y > 740 and not (ws and INT.match(ws[0][4]) and ws[0][2] < 85):
                continue  # footer (file name / page number); numbered body lines can run this low
            lineno, shift, ws, left_lineno = strip_margins(ws, pw)
            if shift is None:
                shift = 13.6 if (printed or 0) % 2 == 1 else 0.0
            ws = [(w[0] - shift, w[1], w[2] - shift, w[3], w[4]) for w in ws]
            if not ws:
                if cur is not None:
                    cur.rows.append({'blank': True, 'lineno': lineno})
                continue
            text = ' '.join(w[4] for w in ws)
            x0 = ws[0][0]
            xc = (ws[0][0] + ws[-1][2]) / 2
            # headings for department / agency (centred, outside tables)
            centred = x0 > 140
            # agency headings are usually centred, but some (SUCs P.5, DOST I) start at the margin
            if left_lineno and (state in ('TEXT', 'DONE') or x0 > 200) and text.upper() == text and len(text) > 4 \
                    and not any(AMT.match(w[4]) and ',' in w[4] for w in ws):
                m = DEPT_RE.match(text)
                if m:
                    v = roman(m.group(1))
                    # single letters (C, D, I, L, V, X) are also agency letters: a department
                    # heading must continue the Roman sequence
                    if (len(m.group(1)) > 1 and v > last_dept[0]) or v == last_dept[0] + 1:
                        last_dept[0] = v
                        if cur is not None and not cur.closed:
                            cur.closed = 'interrupted'
                        state = 'TEXT'
                        ctx = {'dept_no': m.group(1), 'dept': m.group(2).strip(), 'agency_no': None, 'agency': None}
                        continue
                m = AGY_RE.match(text)
                if m:
                    ctx['agency_no'], ctx['agency'] = m.group(1), m.group(2).strip()
                    if cur is not None and not cur.closed:
                        cur.closed = 'interrupted'
                    state = 'TEXT'
                    continue
            # table start
            kind = None
            for k, rx in TABLE_HDR:
                if rx.match(text):
                    kind = k
                    break
            if kind:
                if cur is not None and not cur.closed:
                    cur.closed = 'interrupted'
                cur = Table(kind, ctx, {'vol': vol, 'pdf_page': pno + 1, 'printed_page': printed, 'line': lineno})
                tables.append(cur)
                state = 'HDR'
                continue
            if state == 'HDR':
                if x0 > 200 or text.startswith('(In Thousand'):
                    cur.hdr_words += ws
                    continue
                if cur.kind != 'O':
                    cur.set_cols_from_header()
                state = 'BODY'
            if state == 'BODY':
                if cur.cols:
                    zone = min(cx for _, cx in cur.cols) - 8
                    is_amt = lambda w: AMT.match(w[4]) and w[2] > zone and w[0] > 180
                else:
                    is_amt = lambda w: (AMT.match(w[4]) and w[0] > 250) or (re.fullmatch(r'\d{4,}', w[4]) and w[0] > 420)
                label_ws = [w for w in ws if not is_amt(w) and w[4] != 'P']
                amt_ws = [w for w in ws if is_amt(w)]
                label = ' '.join(w[4] for w in label_ws)
                row = {'lineno': lineno, 'pdf_page': pno + 1, 'printed_page': printed,
                       'x0': round(label_ws[0][0], 1) if label_ws else None, 'label': label, 'amounts': {}}
                if cur.kind == 'O':
                    if amt_ws:
                        row['amounts']['thousands'] = parse_amount(amt_ws[-1][4])
                else:
                    for w in amt_ws:
                        col, dist = cur.assign(w)
                        if col in row['amounts']:
                            row.setdefault('warn', []).append(f'dup col {col} {w[4]}')
                        row['amounts'][col] = parse_amount(w[4])
                        if dist > 25:
                            row.setdefault('warn', []).append(f'far {w[4]} {dist:.0f}')
                cur.rows.append(row)
                if re.match(r'^TOTAL NEW AP\w*TIONS', label):
                    cur.closed = True
                    state = 'DONE'
                continue
    return tables


def upper_ratio(label):
    letters = re.sub(r'[^A-Za-z]', '', label)
    return (sum(c.isupper() for c in letters) / len(letters)) if letters else 0.0


def is_upper_heading(label):
    letters = re.sub(r'[^A-Za-z]', '', re.sub(r'\(.*?\)', '', label))
    return len(letters) >= 10 and upper_ratio(re.sub(r'\(.*?\)', '', label)) >= 0.9 and len(label.split()) >= 2


def is_upper_text(label):
    letters = re.sub(r'[^A-Za-z]', '', label)
    return len(letters) >= 2 and upper_ratio(label) >= 0.85


REGION_RX = re.compile(
    r'^(National Capital Region|Regi?on(al)?\s+(IV-?[AB]|[IVX]+[AB]?)(\s*[-–]\s*[A-Za-z .()-]+)?|'
    r'Cordillera Administrative Region|Negros Island Region|National Island Region|'  # sic, DSWD p182
    r'Bangsamoro Autonomous Region in Muslim Mindanao|Autonomous Region in Muslim Mindanao|Nationwide)'
    r'(\s*[-–]\s*[A-Z]{2,5}|\s*\([A-Z]{2,5}\))?$')


def region_key(lab):
    m = re.match(r'^Regi?on(al)?\s+(IV-?[AB]|[IVX]+[AB]?)\b', lab)
    if m:
        return m.group(2).replace('-', '')
    for k, rx in (('NCR', 'National Capital'), ('CAR', 'Cordillera'), ('NIR', 'Negros Island'), ('NIR', 'National Island'),
                  ('BARMM', 'Bangsamoro'), ('ARMM', 'Autonomous Region in Muslim')):
        if lab.startswith(rx):
            return k
    return lab


FUND_RX = re.compile(r'^(Loan Proceeds|GOP Counterpart|GOP Equity|Grant Proceeds|Counterpart Fund|Peso Counterpart)\b|^Grants?$', re.I)
SECTION_RX = re.compile(r'^([A-Z]\.\s*)?(REGULAR PROGRAMS?|PROJECTS?(\(S\))?|PROJECT\(S\)|PURPOSES?(\(S\))?)$')
KIND_RX = re.compile(r'^(Locally\s*-?\s*Funded|Foreign\s*-?\s*Assisted)[\s-]*Projects?\s*(\(s\))?$', re.I)
CLASS_RX = re.compile(r'^(General Administration and Support|Support to Operations|Operations)$')
RANK = {'SECTION': 0, 'KIND': 1, 'CLASS': 1, 'PROGRAM': 2, 'SUBPROGRAM': 3, 'ACTIVITY': 4,
        'REGION': 6, 'OU': 7, 'SUBOU': 7.5, 'FUND': 8}


def classify(it, stack, kind):
    lab = it['label']
    if kind == 'O':
        return None
    if SECTION_RX.match(lab):
        return 'SECTION'
    if KIND_RX.match(lab):
        return 'KIND'
    if CLASS_RX.match(lab):
        return 'CLASS'
    if FUND_RX.match(lab):
        return 'FUND'
    reg = next((n for n in reversed(stack) if n.get('type') == 'REGION'), None)
    act = next((n for n in reversed(stack) if n.get('type') == 'ACTIVITY'), None)
    if (is_upper_heading(lab) and reg is not None and it['x0'] > reg['x0'] + 2
            and (act is None or it['x0'] > act['x0'] + 4)):
        return 'OU'  # uppercase office names, e.g. "DATRC CALABARZON"
    if is_upper_heading(lab):
        return 'SUBPROGRAM' if re.search(r'SUB-?PROGRAM', lab) else 'PROGRAM'
    if REGION_RX.match(lab):
        # an office named after its region ("National Capital Region", no acronym) sits well
        # inside the region row; numbered / acronym forms are always regions
        # ...and Coast Guard districts are "Region I - Northwestern Luzon" under "Region I - Ilocos"
        if reg is not None and it['x0'] > reg['x0'] + 8 and (
                region_key(lab) == region_key(reg['label'])
                or not (re.match(r'^Regi?on(al)?\s', lab) or re.search(r'\((NCR|CAR|NIR|BARMM|ARMM)\)$', lab))):
            return 'OU'
        return 'REGION'
    if lab.startswith('Central Office') and reg is None and act is None:
        return 'REGION'
    ou = next((n for n in reversed(stack) if n.get('type') == 'OU'), None)
    if reg is not None:
        if ou is not None and it['x0'] > ou['x0'] + 6:
            return 'SUBOU'  # e.g. DepEd: schools division > division office / high school
        if it['x0'] > reg['x0'] + 2 and (act is None or it['x0'] > act['x0'] + 4):
            return 'OU'
        return 'ACTIVITY'
    if act is not None and it['x0'] > act['x0'] + 8:
        return 'OU'  # operating units listed straight under the activity (no region level)
    return 'ACTIVITY'


def build_tree(tbl):
    """Merge wrapped labels, type every row, then nest by type rank
    (section > class > program > sub-program > activity > region > OU > fund);
    indentation only decides OU-vs-activity and object-table nesting."""
    items = []
    prev = None
    for idx, r in enumerate(tbl.rows):
        if r.get('blank'):
            prev = None
            continue
        # first line after r's run of consecutive label-only lines (a wrapped name's amount line)
        j = idx + 1
        while (j < len(tbl.rows) and not tbl.rows[j].get('blank') and not tbl.rows[j].get('amounts')
               and tbl.rows[j].get('lineno') == tbl.rows[j - 1].get('lineno', -9) + 1):
            j += 1
        nxt = tbl.rows[j] if j < len(tbl.rows) else None
        if nxt is not None and not nxt.get('blank') and nxt.get('lineno') != tbl.rows[j - 1].get('lineno', -9) + 1:
            nxt = None
        if (prev is not None and not prev['amounts'] and prev['x0'] is not None and r['x0'] is not None
                and (-4 < r['x0'] - prev['x0'] < (2.5 if tbl.kind == 'O' else 14 if r['label'].startswith('(') else 12))  # hanging indents
                and prev['_last'] is not None and r['lineno'] is not None
                and r['lineno'] == prev['_last'] + 1 and not SUBTOTAL.match(r['label'])
                # a dangling hyphen always continues ("Revenue Region No. 2 -" / "Cordillera Administrative Region")
                and (prev['label'].endswith('-') or not
                     (tbl.kind != 'O' and ((is_upper_text(prev['label']) and not is_upper_text(r['label']))
                                             or (not is_upper_text(prev['label']) and is_upper_heading(r['label']))
                                             or (REGION_RX.match(r['label']) and not (r['label'] == 'Nationwide' and abs(r['x0'] - prev['x0']) < 2.5))
                                             or FUND_RX.match(r['label'])
                                             or CLASS_RX.match(prev['label']) or SECTION_RX.match(prev['label'])
                                             or KIND_RX.match(prev['label']))))):
            prev['label'] = (prev['label'] + ' ' + r['label']).strip()
            prev['amounts'] = r['amounts']
            prev['wrapped'] = prev.get('wrapped', 1) + 1
            prev['_last'] = r['lineno']
            if r.get('warn'):
                prev.setdefault('warn', []).extend(r['warn'])
            continue
        if (tbl.kind != 'O' and prev is not None and prev['amounts'] and not r['amounts']
                and prev['x0'] is not None and r['x0'] is not None and -4 < r['x0'] - prev['x0'] < 8.5
                and prev['_last'] is not None and r['lineno'] == prev['_last'] + 1
                and not SUBTOTAL.match(r['label']) and not REGION_RX.match(r['label'])
                and not CLASS_RX.match(r['label']) and not SECTION_RX.match(r['label'])
                and not KIND_RX.match(r['label']) and not FUND_RX.match(r['label'])
                and is_upper_text(prev['label']) == is_upper_text(r['label'])
                # ...unless this line starts a wrapped name whose amounts follow on the next line
                # (DepEd school lists run on consecutive lines: "Longos National High School" /
                # "(Malabon National High School - Longos Annex)  56,486,000")
                and not (nxt is not None and not nxt.get('blank') and nxt.get('amounts')
                         and nxt.get('x0') is not None
                         and -4 < nxt['x0'] - r['x0'] < (14 if nxt.get('label', '').startswith('(') else 12))):
            prev['label'] = (prev['label'] + ' ' + r['label']).strip()
            prev['wrapped'] = prev.get('wrapped', 1) + 1
            prev['_last'] = r['lineno']
            prev.setdefault('warn', []).append('amounts on first line of wrapped label')
            continue
        it = dict(r)
        it['_last'] = r['lineno']
        items.append(it)
        prev = it
    # DPWH prints some activity labels twice in a row with the same amounts: keep one
    dedup = []
    for it in items:
        if (dedup and not SUBTOTAL.match(it['label']) and it['amounts']
                and re.sub(r'\s+', ' ', dedup[-1]['label']) == re.sub(r'\s+', ' ', it['label'])
                and dedup[-1]['amounts'] == it['amounts']):
            dedup[-1].setdefault('warn', []).append(f"label printed twice (line {it['lineno']})")
            continue
        dedup.append(it)
    items = dedup
    TOL = 4.0
    root = {'label': '<root>', 'x0': -1, 'rank': -1, 'children': [], 'amounts': {}}
    stack = [root]
    checks = []
    for it in items:
        it['children'] = []
        if it['x0'] is None:
            it['x0'] = 0
        if SUBTOTAL.match(it['label']) or re.match(r'^TOTAL NEW AP\w*TIONS', it['label']):
            checks.append(it)
            it['is_total'] = True
            it['_closes'] = stack[-1]['label'] if len(stack) > 1 else '<root>'
            continue
        def _leafsum(n):
            return n['amounts'].get('thousands', 0) if not n['children'] else sum(_leafsum(c) for c in n['children'])
        if tbl.kind == 'O' and it['amounts'] and any(n.get('label') == it['label'] and n['children']
                                                     and abs(n['x0'] - it['x0']) < 2
                                                     and _leafsum(n) == it['amounts'].get('thousands') for n in stack[1:]):
            it.setdefault('warn', []).append('subtotal printed without "Total"')
            checks.append(it)
            it['is_total'] = True
            it['_closes'] = it['label']
            continue
        if tbl.kind == 'O':
            it['rank'] = it['x0']
            while len(stack) > 1 and stack[-1]['rank'] > it['rank'] - TOL:
                stack.pop()
        else:
            it['type'] = classify(it, stack, tbl.kind)
            it['rank'] = RANK[it['type']]
            if it['type'] == 'FUND':
                # DAR prints project > region > OU > fund; DSWD prints project > fund > region > OU
                reg = next((n for n in reversed(stack) if n.get('type') == 'REGION'), None)
                if reg is None or it['x0'] <= reg['x0'] + 2:
                    it['rank'] = 5
            while len(stack) > 1 and stack[-1]['rank'] >= it['rank']:
                stack.pop()
        stack[-1]['children'].append(it)
        stack.append(it)
    return root, checks


def sums(node, cols):
    return {c: sum(ch['amounts'].get(c, 0) for ch in node['children']) for c in cols}


def validate(root, cols):
    bad = []
    def walk(n, path):
        if n['children'] and n['amounts'] and any(n['amounts'].values()):
            s = sums(n, cols)
            for c in cols:
                if n['amounts'].get(c, 0) != s[c]:
                    bad.append({'path': path, 'col': c, 'printed': n['amounts'].get(c, 0), 'sum_children': s[c]})
        for ch in n['children']:
            walk(ch, path + [ch['label']])
    walk(root, [])
    return bad


def leaves(root):
    out = []
    def walk(n, path):
        if not n['children']:
            if n is not root:
                out.append((path, n))
            return
        for ch in n['children']:
            walk(ch, path + [ch['label']])
    walk(root, [])
    return out


if __name__ == '__main__':
    vol = sys.argv[1]
    a = int(sys.argv[2]) if len(sys.argv) > 2 else None
    b = int(sys.argv[3]) if len(sys.argv) > 3 else None
    tables = parse_volume(vol, a, b)
    out = []
    for t in tables:
        root, checks = build_tree(t)
        cols = ['thousands'] if t.kind == 'O' else COLS
        bad = validate(root, cols)
        # every table's leaves must add up to its printed TOTAL NEW APPROPRIATIONS
        fin = next((c for c in reversed(checks) if re.match(r'^TOTAL NEW AP\w*TIONS', c['label'])), None)
        if fin is not None and not root['children']:
            pass  # totals-only summary table (special purpose funds print one before the itemised one)
        elif fin is not None:
            lv = [n for _, n in leaves(root)]
            for c in cols:
                if c == 'Total' and t.kind == 'O':
                    continue
                s_ = sum(n['amounts'].get(c, 0) for n in lv)
                if s_ != fin['amounts'].get(c, 0):
                    bad.append({'path': ['<TOTAL NEW APPROPRIATIONS>'], 'col': c, 'printed': fin['amounts'].get(c, 0), 'sum_children': s_})
        else:
            bad.append({'path': ['<no TOTAL NEW APPROPRIATIONS row>'], 'col': None, 'printed': None, 'sum_children': None})
        out.append({'kind': t.kind, 'ctx': t.ctx, 'loc': t.loc, 'closed': t.closed,
                    'cols': t.cols, 'tree': root, 'bad': bad,
                    'totals': [{'label': c['label'], 'amounts': c['amounts'], 'closes': c['_closes']} for c in checks]})
    json.dump(out, sys.stdout, indent=1, default=str)
