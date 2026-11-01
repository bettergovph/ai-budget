"""Find the NEP page that prints each NEP line, so every line in the explorer can cite both documents.

The NEP CSV (DBM's data) carries no page numbers. The NEP PDF volumes (machine-read scans, the same
copies the DPWH workbench uses) print the same lines in each agency's table "New Appropriations, by
Programs/Activities/Projects (Cash-Based), by Operating Units": the activity's UACS code, then each
region and office on one visual line with its amounts by expense class.

For every NEP row (agency x activity x region x office x fund x expense class, as compare.py groups
them) this finds the visual line that prints its amount under the right activity, preferring the line
whose label is the office's name. Where no line can be pinned, it falls back to the page that opens
the activity, then to the agency's table.

  python nep_pages.py nep.duckdb out_dir [deped_niu_schools.csv]
  NEP_PDF_DIR   the four volumes (default: the workbench clone's dbm-nep-data/)

Writes out_dir/nep_pages.csv (one row per NEP row, keyed like compare.py's query) and caches the
page text as out_dir/nep_pdf_lines.json.gz.
"""
import csv, collections, difflib, gzip, hashlib, json, os, re, sys

NEP_PDF_DIR = os.environ.get('NEP_PDF_DIR', '/tmp/dpwh-nep-head/dbm-nep-data')
# Explorer document key -> file. Order is document order (volumes are printed I, II-A, II-B, III).
VOLUMES = {
    'nep2027-vol-i': 'NEP-2027-VOLUME-1_OCR.pdf',
    'nep2027-vol-iia': 'NEP-2027-VOLUME-2A_OCR.pdf',
    'nep2027-vol-iib': 'NEP-2027-VOLUME-2B_OCR.pdf',
    'nep2027-vol-iii': 'NEP-2027-VOLUME-3_OCR.pdf',
}
CODE = re.compile(r'^\d{15}$')
AMOUNT = re.compile(r'^\d{1,3}(?:,\d{3})+$|^\d{1,3}$')
OCR_DIGIT = str.maketrans({'O': '0', 'o': '0', 'l': '1', 'I': '1', '!': '1', '|': '1', 'S': '5', 'B': '8'})


def fmt(n):
    return f'{n:,}'


def norm(s):
    s = (s or '').lower().replace('!', 'i')
    s = re.sub(r'\([^)]*\)', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# ---------------------------------------------------------------------------------------------------
# Page text: visual lines of (label, amounts)
# ---------------------------------------------------------------------------------------------------

def numeric(tok):
    t = tok.strip().rstrip('.')
    if not t or not re.search(r'\d', t):
        return None
    t2 = t.translate(OCR_DIGIT) if sum(c.isdigit() for c in t) >= len(t.replace(',', '').replace(' ', '')) - 1 else t
    return t2 if re.fullmatch(r'[\d,]+', t2) else None


def page_lines(page):
    """Visual lines: [y, label, [amount strings], code or None]."""
    ws = sorted(page.get_text('words'), key=lambda w: (round(w[1]), w[0]))
    rows = []
    for w in ws:
        yc = (w[1] + w[3]) / 2
        if rows and abs(yc - rows[-1][0]) <= 3.0:
            rows[-1][1].append(w)
        else:
            rows.append([yc, [w]])
    out = []
    for yc, words in rows:
        words.sort(key=lambda w: w[0])
        label, nums, code = [], [], None
        cur, cur_x1 = None, None  # number being joined from OCR fragments ("1 , 072, 011 , 000")
        for w in words:
            t = w[4]
            if CODE.match(t) and not label and not nums:
                code = t
                continue
            n = numeric(t)
            if n is not None and (cur is not None and w[0] - cur_x1 < 9 or n.strip(',') != ''):
                if cur is not None and w[0] - cur_x1 < 9:
                    cur += n
                else:
                    if cur is not None:
                        nums.append(cur)
                    cur = n
                cur_x1 = w[2]
                continue
            if t in (',',) and cur is not None:
                cur += ','
                cur_x1 = w[2]
                continue
            if cur is not None:
                nums.append(cur)
                cur = None
            label.append(t)
        if cur is not None:
            nums.append(cur)
        amounts = [re.sub(r',+', ',', n).strip(',') for n in nums]
        amounts = [a for a in amounts if AMOUNT.match(a)]
        out.append([round(yc, 1), ' '.join(label), amounts, code])
    return out


def printed_page(lines):
    """The page number printed in the running head ("50 EXPENDITURE PROGRAM ..." or
    "DEPARTMENT OF AGRICULTURE 147"): the lone number on the head line, above the body."""
    for y, _, amounts, _ in lines[:2]:
        if y < 55 and len(amounts) == 1 and amounts[0].isdigit():
            return int(amounts[0])
    return 0


def load_pages(cache):
    import pymupdf
    sig = {k: os.path.getsize(os.path.join(NEP_PDF_DIR, f)) for k, f in VOLUMES.items()}
    sig['extract'] = 3  # bump when page_lines() or printed_page() change
    if os.path.exists(cache):
        with gzip.open(cache, 'rt') as f:
            data = json.load(f)
        if data.get('sig') == sig:
            return data
    data = {'sig': sig, 'sha256': {}, 'pages': []}
    for key, fname in VOLUMES.items():
        path = os.path.join(NEP_PDF_DIR, fname)
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        data['sha256'][key] = h.hexdigest()
        doc = pymupdf.open(path)
        for i in range(doc.page_count):
            lines = page_lines(doc[i])
            data['pages'].append({'doc': key, 'pdf': i + 1, 'printed': printed_page(lines), 'lines': lines})
        print(f'   {key}: {doc.page_count} pages', file=sys.stderr)
    fill_printed(data['pages'])
    with gzip.open(cache, 'wt') as f:
        json.dump(data, f)
    return data


def fill_printed(pages):
    """Pages whose running head the scan lost: printed numbers run consecutively, so take the number
    from the known pages on either side when both give the same offset."""
    known = [i for i, p in enumerate(pages) if p['printed']]
    for a, b in zip(known, known[1:]):
        pa, pb = pages[a], pages[b]
        if pa['doc'] != pb['doc'] or pb['printed'] - pa['printed'] != b - a:
            continue
        for i in range(a + 1, b):
            pages[i]['printed'] = pa['printed'] + (i - a)


# ---------------------------------------------------------------------------------------------------
# NEP rows (exactly compare.py's grouping and order)
# ---------------------------------------------------------------------------------------------------

KEY_COLS = ['SORDER', 'DEPARTMENT', 'UACS_DPT_DSC', 'AGENCY', 'UACS_AGY_DSC', 'PREXC_FPAP_ID', 'DSC',
            'UACS_REG_ID', 'UACS_OPERDIV_ID', 'UACS_DIV_DSC', 'OPERUNIT', 'UACS_OPER_DSC', 'FUNDCD', 'UACS_EXP_CD']


def nep_key(vals):
    """The join key compare.py uses to look a row up: every grouping column, '' for null."""
    return '|'.join('' if v is None else str(v) for v in vals)


def load_nep(nep_db):
    import duckdb
    con = duckdb.connect(nep_db, read_only=True)
    rows = con.execute(f"""
        select {', '.join(KEY_COLS)}, sum(pesos) as amt
        from nep where pesos is not null and FUNDCD like '101%' and pesos <> 0
        group by all
        order by all""").fetchall()
    return [dict(zip(KEY_COLS + ['amt'], r)) for r in rows]


# ---------------------------------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------------------------------

def head_of(page):
    for y, label, _, _ in page['lines'][:2]:
        if y < 55 and label and 'EXPEND' not in label.upper().replace(' ', ''):
            return norm(re.sub(r'^[IVXL]+\.\s*', '', label))
    return None


def flatten(pages):
    """Every visual line in document order, with the running head and activity code in force.
    A label that wraps onto the next line (the amounts sit on the last one) is joined."""
    out, head, code, doc = [], None, None, None
    for pi, p in enumerate(pages):
        if p['doc'] != doc:
            doc, head, code = p['doc'], None, None
        h = head_of(p)
        # OCR varies the running head ("DEPARTMENT DF EDUCATION"): only a real change of section resets.
        if h and ratio(h, head or '') < 0.85:
            head, code = h, None
        p['head'] = head
        pending = []
        for y, label, amounts, c in p['lines']:
            if y < 55:
                continue  # running head
            if c:
                code, pending = c, []
            if not amounts:
                pending = (pending + [label])[-2:] if label else pending
                continue
            full = ' '.join(pending + [label]).strip()
            pending = []
            out.append({'page': pi, 'label': full, 'nlabel': norm(full), 'amounts': amounts, 'code': code})
    return out


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio() if a and b else 0.0


# Words every school or office name shares; left in, "Tinubdan Integrated School" looks like
# "Tabunan Integrated School".
GENERIC = set('national high school integrated elementary central memorial annex extension senior junior '
              'of the and de del division office regional proper district engineering campus '
              'main center centre'.split())


def name_sim(a, b):
    """Similarity of two normalised names on their distinctive words (all words when none are left)."""
    ca = ' '.join(w for w in a.split() if w not in GENERIC)
    cb = ' '.join(w for w in b.split() if w not in GENERIC)
    return ratio(ca, cb) if ca and cb else ratio(a, b)


def kadane(scores, penalty):
    """Best contiguous run of pages: maximise sum(score - penalty)."""
    best, best_rng, cur, start = 0.0, None, 0.0, 0
    for i, s in enumerate(scores):
        if cur <= 0:
            cur, start = 0.0, i
        cur += s - penalty
        if cur > best:
            best, best_rng = cur, (start, i)
    return best_rng


def norm_school(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def load_niu(path):
    """Schools that run no budget of their own (the House bill's Vol I-B list): the NEP folds them into
    their division office's line."""
    if not path or not os.path.exists(path):
        return set()
    return {norm_school(r['school']) for r in csv.DictReader(open(path))}


def match(pages, rows, niu=frozenset()):
    lines = flatten(pages)
    by_page = collections.defaultdict(list)
    for ln in lines:
        by_page[ln['page']].append(ln)
    heads = sorted({p['head'] for p in pages if p['head']})

    def pages_for(names):
        ok = {h for h in heads if any(ratio(h, n) >= 0.86 or (len(n) > 12 and n in h) for n in names)}
        return [i for i, p in enumerate(pages) if p['head'] in ok]

    results, unresolved = {}, []
    agencies = collections.OrderedDict()
    for r in rows:
        agencies.setdefault((r['SORDER'], r['DEPARTMENT'], r['AGENCY']), []).append(r)
    dept_count = collections.Counter((s, d) for s, d, _ in agencies)

    for (so, dept, agy), rs in agencies.items():
        dname = norm(rs[0]['UACS_DPT_DSC'])
        aname = norm(rs[0]['UACS_AGY_DSC'])
        cand = pages_for([dname, aname])
        if not cand:
            continue
        # The agency's own pages inside its department: where its amounts cluster.
        want = {fmt(r['amt']) for r in rs if r['amt'] >= 10_000}
        ou_tot = collections.Counter()
        for r in rs:
            ou_tot[(r['PREXC_FPAP_ID'], r['UACS_REG_ID'], r['OPERUNIT'], r['UACS_OPER_DSC'])] += r['amt']
        want |= {fmt(v) for v in ou_tot.values() if v >= 10_000}
        window = cand
        if dept_count[(so, dept)] > 1:
            scores = [sum(1 for ln in by_page[i] for a in ln['amounts'] if a in want) for i in cand]
            rng = kadane(scores, 1.0)
            if rng:
                window = cand[max(0, rng[0] - 1): rng[1] + 2]
        wset = set(window)
        idx = collections.defaultdict(list)
        code_page = {}
        div, div_code = None, None  # DepEd: the "Division of ..." a line sits under, within its activity
        div_block = collections.defaultdict(list)  # (activity code, division) -> its lines, header first
        for i in window:
            for ln in by_page[i]:
                if ln['code'] != div_code:
                    div, div_code = None, ln['code']
                if ln['nlabel'].startswith('division of '):
                    div = ln['nlabel'][12:]
                ln['div'] = div
                if div:
                    div_block[(ln['code'], div)].append(ln)
                for a in ln['amounts']:
                    idx[a].append(ln)
                if ln['code'] and ln['code'] not in code_page:
                    code_page[ln['code']] = i
        fund_tot = collections.Counter()
        for r in rs:
            fund_tot[(r['PREXC_FPAP_ID'], r['UACS_REG_ID'], r['OPERUNIT'], r['UACS_OPER_DSC'], r['UACS_EXP_CD'])] += r['amt']
        crowd = collections.Counter(ln['code'] for i in window for ln in by_page[i])
        for r in rs:
            ou = norm(r['UACS_OPER_DSC'])
            dsc = norm(r['DSC'])
            code = r['PREXC_FPAP_ID']
            best, best_sim = None, -1.0
            for amount in dict.fromkeys([fmt(r['amt']),
                                         fmt(fund_tot[(code, r['UACS_REG_ID'], r['OPERUNIT'], r['UACS_OPER_DSC'], r['UACS_EXP_CD'])]),
                                         fmt(ou_tot[(code, r['UACS_REG_ID'], r['OPERUNIT'], r['UACS_OPER_DSC'])])]):
                for ln in idx.get(amount, ()):
                    if ln['code'] != code:
                        continue
                    # A school under its own division: several divisions have a "Santiago Integrated School".
                    if r['UACS_DIV_DSC'] and ln['div'] and ratio(ln['div'], norm(r['UACS_DIV_DSC'])[12:]) < 0.85:
                        continue
                    # The label names the office, or (an office printed on its activity's own line, such as
                    # DPWH's and NIA's Central Office projects) the activity.
                    sim = max(name_sim(ln['nlabel'], ou), name_sim(ln['nlabel'], dsc))
                    # Under a crowded activity (DepEd's thousands of school lines) an equal amount alone is
                    # often another office's, so the label must agree; elsewhere code and amount suffice.
                    if ou and sim < 0.6 and crowd[code] > 40:
                        continue
                    if sim > best_sim:
                        best, best_sim = ln, sim
                if best is not None and best_sim >= 0.75:
                    break
            if best is not None:
                how = 'line' if best_sim >= 0.75 else 'amount'
                results[nep_key([r[c] for c in KEY_COLS])] = (best['page'], how)
            elif r['UACS_DIV_DSC'] and (block := next((lns for (c, d), lns in div_block.items()
                                                        if c == code and ratio(d, norm(r['UACS_DIV_DSC'])[12:]) >= 0.85), None)):
                k = nep_key([r[c] for c in KEY_COLS])
                school = ou and ou != norm(r['UACS_DIV_DSC'])
                named = max(block, key=lambda ln: name_sim(ln['nlabel'], ou)) if school else None
                office = next((ln for ln in block if ln['nlabel'].startswith('division office')), None)
                if school and norm_school(r['UACS_OPER_DSC']) not in niu and named and name_sim(named['nlabel'], ou) >= 0.8:
                    results[k] = (named['page'], 'amount')  # its own line; the scan misread the amount
                elif office and (not school or norm_school(r['UACS_OPER_DSC']) in niu):
                    results[k] = (office['page'], 'division')  # inside "Division Office - Proper"
                else:
                    results[k] = (block[0]['page'], 'division_list')  # listed under its division from here
            elif r['PREXC_FPAP_ID'] in code_page:
                results[nep_key([r[c] for c in KEY_COLS])] = (code_page[r['PREXC_FPAP_ID']], 'activity')
            else:
                unresolved.append((r, cand))

    # Second pass, for rows the agency's pages did not place.
    # 1. The exact activity code and amount anywhere in the NEP (generic department names such as
    #    "New General Appropriations" give no running head to find the agency by).
    everywhere = collections.defaultdict(list)
    for ln in lines:
        for a in ln['amounts']:
            everywhere[a].append(ln)
    for r, cand in unresolved:
        k = nep_key([r[c] for c in KEY_COLS])
        ou = norm(r['UACS_OPER_DSC'])
        hits = [ln for ln in everywhere.get(fmt(r['amt']), ()) if ln['code'] == r['PREXC_FPAP_ID']
                and (not ou or name_sim(ln['nlabel'], ou) >= 0.6)]
        if hits:
            best = max(hits, key=lambda ln: name_sim(ln['nlabel'], ou))
            results[k] = (best['page'], 'line' if name_sim(best['nlabel'], ou) >= 0.75 else 'amount')
            continue
        # 2. Printed only inside a total: the nearest parent program line in the agency's own section,
        #    which opens on the page that carries the agency's name (GOCC subsidies, e.g. PhilHealth's
        #    two activities inside "National Health Insurance Program").
        aname = norm(r['UACS_AGY_DSC'])
        starts = [i for i in cand if any('..' not in label and (ratio(norm(label), aname) >= 0.85 or (len(aname) > 15 and aname in norm(label)))
                                         for _, label, _, _ in pages[i]['lines'])]
        code = r['PREXC_FPAP_ID'] or ''
        parents = [code[:n] + '0' * (15 - n) for n in (12, 10, 9, 7, 6, 4)] if len(code) == 15 else []
        found = None
        for s0 in starts[:1]:
            section = [ln for i in range(s0, s0 + 6) for ln in by_page.get(i, ())]
            for parent in parents:
                if parent != code and (hit := next((ln for ln in section if ln['code'] == parent), None)):
                    found = (hit['page'], 'program')
                    break
        if found:
            results[k] = found
    return results


def main(nep_db, out_dir, niu_csv=None):
    data = load_pages(f'{out_dir}/nep_pdf_lines.json.gz')
    pages = data['pages']
    rows = load_nep(nep_db)
    res = match(pages, rows, load_niu(niu_csv))
    hows = collections.Counter()
    pesos = collections.Counter()
    with open(f'{out_dir}/nep_pages.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['nep_key', 'nep_doc', 'nep_pdf_page', 'nep_printed_page', 'nep_page_how'])
        for r in rows:
            k = nep_key([r[c] for c in KEY_COLS])
            hit = res.get(k)
            if hit is None:
                hows['none'] += 1
                pesos['none'] += r['amt']
                w.writerow([k, '', '', '', 'none'])
                continue
            p = pages[hit[0]]
            hows[hit[1]] += 1
            pesos[hit[1]] += r['amt']
            w.writerow([k, p['doc'], p['pdf'], p['printed'] or '', hit[1]])
    total = sum(pesos.values())
    print(f'   {len(rows):,} NEP rows: ' + ', '.join(f'{h} {n:,} ({pesos[h] / total:.1%} of pesos)' for h, n in hows.most_common()))
    with open(f'{out_dir}/nep_pdf_sha256.json', 'w') as f:
        json.dump(data['sha256'], f, indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:4])
