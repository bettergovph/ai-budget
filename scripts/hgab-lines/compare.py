#!/usr/bin/env python3
"""Line-by-line comparison: HB 10858 (3rd reading) non-infra line items vs the FY2027 NEP
extract (NEP-FY2027.csv, new appropriations = fund 101*).

Each House-bill leaf is matched to the NEP rows under the same agency and activity, at the
depth the bill prints for that leaf (region / operating unit / sub-unit / fund source),
by expense class. NEP rows no bill leaf claims are reported as NEP-only.

Usage: compare.py hb_line_items.csv nep.duckdb out_dir [deped_annex.csv [reading_changes.csv]]
"""
import csv, collections, difflib, json, os, re, sys
import duckdb

REG_CODE = {'NCR': '13', 'I': '01', 'CAR': '14', 'II': '02', 'III': '03', 'IVA': '04', 'IVB': '17',
            'V': '05', 'VI': '06', 'NIR': '18', 'VII': '07', 'VIII': '08', 'IX': '09', 'X': '10',
            'XI': '11', 'XII': '12', 'XIII': '16', 'BARMM': '19', 'ARMM': '19'}


def norm(s):
    if s is None or s == '':
        return None
    s = s.lower().replace('&', ' and ')
    s = re.sub(r'\bsub-?program\b', 'subprogram', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def norm_name(s):
    """Agency/department names: drop acronyms in parentheses and leading 'the'."""
    if s is None or s == '':
        return None
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'\bIncorporated\b', 'Inc', s, flags=re.I)
    s = norm(s)
    return re.sub(r'^the ', '', s)


def region_code(lab):
    if not lab:
        return None
    m = re.match(r'^Regi?on(al)?\s+(IV-?[AB]|[IVX]+[AB]?)\b', lab)
    if m:
        return REG_CODE.get(m.group(2).replace('-', ''))
    for k, rx in (('NCR', 'National Capital'), ('CAR', 'Cordillera'), ('NIR', 'Negros Island'),
                  ('NIR', 'National Island'), ('BARMM', 'Bangsamoro'), ('ARMM', 'Autonomous Region in Muslim')):
        if lab.startswith(rx):
            return REG_CODE[k]
    if lab == 'Nationwide':
        return 'NW'
    return '?' + lab


def fund_kind_hb(lab):
    if not lab:
        return None
    l = lab.lower()
    if 'counterpart' in l or 'gop' in l:
        return 'GOP'
    if 'loan' in l:
        return 'LOAN'
    if 'grant' in l:
        return 'GRANT'
    return lab


def fund_kind_nep(fundcd):
    if fundcd == '10102151':
        return 'GOP'
    if fundcd and fundcd.startswith('101021'):
        return 'LOAN'
    return None


# How firmly nep_pages.py pinned a row to its page, strongest first.
PAGE_HOW = ['line', 'amount', 'division', 'division_list', 'program', 'activity']


def nep_page(rows):
    """The NEP page for a line made of these NEP rows: the most firmly pinned, then the largest."""
    pinned = [n for n in rows if n.get('pg')]
    if not pinned:
        return {'nep_doc': '', 'nep_pdf_page': '', 'nep_printed_page': '', 'nep_page_how': ''}
    n = min(pinned, key=lambda n: (PAGE_HOW.index(n['pg']['nep_page_how']), -n['amt']))
    return {k: n['pg'][k] for k in ('nep_doc', 'nep_pdf_page', 'nep_printed_page', 'nep_page_how')}


def best(name, choices, cutoff=0.86):
    m = difflib.get_close_matches(name, choices, n=1, cutoff=cutoff)
    return m[0] if m else None


def main(hb_csv, nep_db, out_dir, annex_csv=None, relabels_csv=None):
    hb = list(csv.DictReader(open(hb_csv)))
    for r in hb:
        r['amount'] = int(r['amount'])
    con = duckdb.connect(nep_db, read_only=True)
    nep = con.execute("""
        select SORDER, DEPARTMENT, UACS_DPT_DSC, AGENCY, UACS_AGY_DSC, PREXC_FPAP_ID, DSC,
               UACS_REG_ID, UACS_OPERDIV_ID, UACS_DIV_DSC, OPERUNIT, UACS_OPER_DSC, FUNDCD, UACS_EXP_CD,
               sum(pesos) as amt
        from nep where pesos is not null and FUNDCD like '101%' and pesos <> 0
        group by all
        order by all""").fetchall()  # fixed order: claim() takes the first free candidate
    cols = ['sorder', 'dept', 'dept_dsc', 'agency', 'agy_dsc', 'pap', 'dsc', 'reg', 'operdiv', 'div_dsc',
            'operunit', 'oper_dsc', 'fundcd', 'exp', 'amt']
    raw, nep = nep, [dict(zip(cols, r)) for r in nep]
    # The NEP page that prints each row (nep_pages.py), keyed on every grouping column.
    pages = {}
    if os.path.exists(f'{out_dir}/nep_pages.csv'):
        pages = {x['nep_key']: x for x in csv.DictReader(open(f'{out_dir}/nep_pages.csv')) if x['nep_doc']}
    for n, r in zip(nep, raw):
        n['pg'] = pages.get('|'.join('' if v is None else str(v) for v in r[:14]))
    hdr = {}
    for so, d, a, code, dsc in con.execute("""select distinct SORDER, DEPARTMENT, AGENCY, PREXC_FPAP_ID, DSC
                                              from nep where PREXC_FPAP_ID is not null""").fetchall():
        hdr[(so, d, a, code)] = dsc
    for r in nep:
        anc = set()
        if r['pap']:
            for k in (1, 2, 4, 6, 9):
                code = r['pap'][:k] + '0' * (15 - k)
                dsc = hdr.get((r['sorder'], r['dept'], r['agency'], code))
                if dsc:
                    anc.add(norm(dsc))
        r['anc'] = anc

    # ---- agency map --------------------------------------------------------------------
    nep_ag = collections.OrderedDict()
    for r in nep:
        k = (r['sorder'], r['dept'], r['agency'])
        a = nep_ag.setdefault(k, {'sorder': r['sorder'], 'dept': r['dept'], 'dept_dsc': r['dept_dsc'],
                                  'agency': r['agency'], 'agy_dsc': r['agy_dsc'], 'amt': 0})
        a['amt'] += r['amt']
    dept_by_name = {}
    for a in nep_ag.values():
        if a['sorder'] == '1':
            dept_by_name[norm_name(a['dept_dsc'])] = a['dept']
    AGENCY_ALIAS = {'budgetary support to government corporations others': 'bsgc others'}
    DEPT_ALIAS = {'budgetary support to government corporations': '35',
                  'allocations to local government units': '36'}
    hb_ag = collections.OrderedDict()
    for r in hb:
        k = (r['dept_no'], r['department'], r['agency_no'], r['agency'])
        hb_ag.setdefault(k, 0)
        hb_ag[k] += r['amount']
    agency_map = {}
    for k, total in hb_ag.items():
        dept_no, dept, agy_no, agy = k
        dn = norm_name(dept)
        dcode = dept_by_name.get(dn) or DEPT_ALIAS.get(dn) or dept_by_name.get(best(dn, list(dept_by_name), 0.8) or '')
        cands = [a for a in nep_ag.values() if a['sorder'] == '1' and a['dept'] == dcode]
        an = norm_name(agy)
        if agy == dept or not agy_no:
            # no agency heading printed (single-agency departments; DepEd's "A." heading is missed)
            osec = [a for a in cands if norm_name(a['agy_dsc']) == 'office of the secretary']
            an = norm_name(osec[0]['agy_dsc']) if osec and len(cands) > 1 else an
        an = AGENCY_ALIAS.get(an, an)
        hit = None
        if len(cands) == 1 and (not agy_no or agy == dept):
            hit, how = cands[0], 'only agency'
        if hit is None:
            exact = [a for a in cands if norm_name(a['agy_dsc']) == an]
            if exact:
                hit, how = exact[0], 'name'
        if hit is None:
            # attached agencies the bill files under another department (e.g. NAPC, PCUP)
            exact = [a for a in nep_ag.values() if norm_name(a['agy_dsc']) == an]
            if len(exact) == 1:
                hit, how = exact[0], 'name, other department'
        if hit is None:
            names = {norm_name(a['agy_dsc']): a for a in cands}
            m = best(an, list(names), 0.9)
            if m:
                hit, how = names[m], 'fuzzy name'
        if hit is None:
            # special purpose funds / LGU allocations sit in NEP section 2
            pool = [a for a in nep_ag.values() if a['sorder'] == '2']
            names = {norm_name(a['agy_dsc']): a for a in pool}
            m = best(an, list(names), 0.75)
            if m:
                hit, how = names[m], 'fuzzy name, special purpose funds'
        agency_map[k] = (hit, how if hit else 'unmatched', dcode)

    # ---- NEP rows indexed by agency + activity ----------------------------------------
    by_act = collections.defaultdict(list)
    for i, r in enumerate(nep):
        r['i'] = i
        r['act'] = norm(r['dsc'])
        r['fk'] = fund_kind_nep(r['fundcd'])
        div = r['operdiv']
        if div and div != r['operunit'] and r['div_dsc']:
            r['ou'], r['sub'] = norm(r['div_dsc']), norm(r['oper_dsc'])
        elif div and div == r['operunit'] and r['div_dsc']:
            r['ou'], r['sub'] = norm(r['div_dsc']), 'division office proper'
        else:
            r['ou'], r['sub'] = norm(r['oper_dsc']), None
        by_act[(r['sorder'], r['dept'], r['agency'], r['act'])].append(r)
    acts_by_agency = collections.defaultdict(set)
    for (so, d, a, act) in by_act:
        acts_by_agency[(so, d, a)].add(act)
    rows_by_agency = collections.defaultdict(list)
    labels_by_agency = collections.defaultdict(set)
    for r in nep:
        ak = (r['sorder'], r['dept'], r['agency'])
        rows_by_agency[ak].append(r)
        labels_by_agency[ak] |= r['anc']

    # ---- DepEd annex: each "Division Office - Proper" line (JHS PS/MOOE, SHS MOOE) splits into the
    # division office itself plus its non-implementing schools, the grain the NEP uses
    if annex_csv:
        ann = collections.defaultdict(list)
        for a in csv.DictReader(open(annex_csv)):
            if a['level'] == 'school':
                ann[(a['region'], a['division'])].append(a)
        ANNEX_COL = {('Operation of Schools - Junior High School (Grade 7 to Grade 10)', '1'): 'jhs_ps',
                     ('Operation of Schools - Junior High School (Grade 7 to Grade 10)', '2'): 'jhs_mooe',
                     ('Operation of Schools - Senior High School (Grade 11 to Grade 12)', '2'): 'shs_mooe'}
        expanded = []
        n_split = 0
        for r in hb:
            col = ANNEX_COL.get((r['activity'], r['uacs_exp_cd']))
            schools = ann.get((r['region'], r['operating_unit'])) if col else None
            if (r['department'] == 'DEPARTMENT OF EDUCATION' and r['sub_unit'] == 'Division Office - Proper'
                    and schools and sum(int(x[col]) for x in schools) == r['amount']):
                n_split += 1
                for x in schools:
                    if int(x[col]):
                        e = dict(r)
                        e.update({'sub_unit': x['school'], 'amount': int(x[col]), 'leaf_type': 'ANNEX_SCHOOL',
                                  'volume': '1b',  # the schools list is in Vol I-B; the division line it splits is in I-A
                                  'pdf_page': x['pdf_page'], 'printed_page': x['printed_page'], 'line': '',
                                  'warn': 'from the non-implementing-schools annex'})
                        expanded.append(e)
            else:
                expanded.append(r)
        print(f'annex: {n_split} division-office lines split into school lines; {len(hb)} -> {len(expanded)} lines')
        hb = expanded

    # ---- labels the 3rd reading renamed: the 2nd reading's label is the bridge to the NEP name
    # (DOH "Medical Assistance Program (MAP)" was printed as MAIFIP, same amounts, in the 2nd reading)
    renamed = {}
    if relabels_csv:
        for x in csv.DictReader(open(relabels_csv)):
            if x['status'] == 'relabel':
                new_l, old_l = x['pap_path'].split(' > ')[-1], x['pap_path_2nd'].split(' > ')[-1]
                if new_l != old_l:
                    renamed[(x['dept_no'], x['agency_no'], norm(new_l))] = norm(old_l)

    # ---- match: resolve each bill leaf to an NEP activity and its location / fund filters
    act_match = {}
    specs = []
    for r in hb:
        k = (r['dept_no'], r['department'], r['agency_no'], r['agency'])
        hit, how, dcode = agency_map[k]
        sp = {'r': r, 'hit': hit, 'how': how, 'nact': None, 'act_how': None, 'nep_amt': 0, 'paps': set(),
              'match': None, 'remainder': False}
        if hit:
            ak = (hit['sorder'], hit['dept'], hit['agency'])
            # deepest P/A/P level the bill prints for this leaf
            lvl, label = next(((l, r[l]) for l in ('activity', 'subprogram', 'program', 'project_kind', 'class')
                               if r[l]), (None, None))
            ou_as_activity = False
            if r['operating_unit'] and (not r['region'] or not r['activity'] or r['section'] == 'PURPOSE(S)'):
                # special purpose funds: items printed one indent in are NEP activities, not offices
                o = norm(r['operating_unit'])
                if o in acts_by_agency[ak] or (r['section'] == 'PURPOSE(S)' and best(o, list(acts_by_agency[ak]), 0.9)):
                    lvl, label, ou_as_activity = 'activity', r['operating_unit'], True
            act = norm(label)
            mk = (ak, lvl, act)
            if mk not in act_match:
                pool = acts_by_agency[ak] if lvl == 'activity' else labels_by_agency[ak]
                old_label = renamed.get((r['dept_no'], r['agency_no'], act))
                if act not in pool and old_label in pool:
                    act_match[mk] = (old_label, 'name (2nd-reading label, renamed in the 3rd)')
                elif act in pool:
                    act_match[mk] = (act, 'name' if lvl == 'activity' else f'name ({lvl} level)')
                elif lvl == 'activity' and act in labels_by_agency[ak]:
                    act_match[mk] = (act, 'name (NEP header level)')
                else:
                    m = best(act or '', list(pool | (labels_by_agency[ak] if lvl == 'activity' else set())), 0.88)
                    if m:
                        act_match[mk] = (m, 'fuzzy name')
                    else:
                        # the bill shortens some NEP names (DPWH drops "...and Other Related Activities -"):
                        # every word of the bill's name inside exactly one NEP name of the agency
                        words = set((act or '').split())
                        hits = [x for x in pool if len(words) >= 6 and words <= set(x.split())]
                        act_match[mk] = (hits[0], 'fuzzy name (bill name contained in NEP name)') if len(hits) == 1 \
                            else (None, 'unmatched')
            sp['nact'], sp['act_how'] = act_match[mk]
            if sp['nact'] is not None:
                sp['ak'] = ak
                sp['reg'] = None if ou_as_activity else region_code(r['region'])
                sp['ou'] = None if ou_as_activity else norm(r['operating_unit'])
                sp['sub'] = norm(r['sub_unit'])
                if r['sub_unit'] == 'Division Office - Proper' and r['leaf_type'] != 'ANNEX_SCHOOL':
                    # DepEd lines the annex does not break down: the division office takes what its
                    # division has left once the named schools have been matched
                    sp['sub'], sp['remainder'] = None, True
                sp['fk'] = fund_kind_hb(r['fund_source'])
                key = ak + (sp['nact'],)
                sp['cand'] = by_act[key] if key in by_act else [n for n in rows_by_agency[ak] if sp['nact'] in n['anc']]
        specs.append(sp)

    used = set()
    claimed_by = {}

    def claim(sp, name_ok, how):
        r = sp['r']
        got = False
        for n in sp['cand']:
            if n['i'] in used or n['exp'] != r['uacs_exp_cd']:
                continue
            if sp['fk'] is not None and n['fk'] != sp['fk']:
                continue
            if sp['reg'] is not None and sp['reg'] != 'NW' and n['reg'] != sp['reg']:
                continue
            if not name_ok(sp, n):
                continue
            used.add(n['i'])
            claimed_by[n['i']] = (sp['ak'], sp['nact'], r['uacs_exp_cd'])
            sp['nep_amt'] += n['amt']
            sp['paps'].add(n['pap'])
            sp.setdefault('pgs', []).append(n)
            got = True
        if got and sp['match'] is None:
            sp['match'] = how

    def exact(sp, n):
        return (sp['ou'] is None or n['ou'] == sp['ou']) and (sp['sub'] is None or n['sub'] == sp['sub'])

    def strip_paren(x):
        return norm(re.sub(r'\([^)]*\)', ' ', x or '')) if x else x

    # pass 1: exact names
    for sp in specs:
        if sp.get('cand') is not None and not sp['remainder']:
            claim(sp, exact, 'exact')
    # pass 2: office / school names that differ in spelling, within the same parent
    def fuzzy_pick(sp):
        """Best unclaimed NEP name for this leaf's office (or school, within its office)."""
        r = sp['r']
        level = 'sub' if sp['sub'] is not None else 'ou'
        mine = sp[level]
        pool = collections.defaultdict(int)
        for n in sp['cand']:
            if n['i'] in used or n['exp'] != r['uacs_exp_cd'] or n[level] is None:
                continue
            if sp['reg'] is not None and sp['reg'] != 'NW' and n['reg'] != sp['reg']:
                continue
            if level == 'sub' and n['ou'] != sp['ou'] and difflib.SequenceMatcher(None, n['ou'] or '', sp['ou'] or '').ratio() < 0.85:
                continue
            pool[n[level]] += 1
        best_name, best_score = None, 0
        for name in pool:
            sc = max(difflib.SequenceMatcher(None, mine, name).ratio(),
                     difflib.SequenceMatcher(None, strip_paren(mine) or '', strip_paren(name) or '').ratio(),
                     1.0 if (strip_paren(mine) and strip_paren(mine) == strip_paren(name)) else 0)
            if sc > best_score:
                best_name, best_score = name, sc
        return (best_name, level) if best_score >= 0.85 else (None, level)

    for sp in specs:
        if sp.get('cand') is None or sp['remainder'] or sp['nep_amt'] or (sp['ou'] is None and sp['sub'] is None):
            continue
        name, level = fuzzy_pick(sp)
        if name is None:
            continue
        if level == 'sub':
            claim(sp, lambda s, n, nm=name: n['sub'] == nm and difflib.SequenceMatcher(None, n['ou'] or '', s['ou'] or '').ratio() >= 0.85,
                  f'fuzzy school/unit name: {name}')
        else:
            claim(sp, lambda s, n, nm=name: n['ou'] == nm and (s['sub'] is None or n['sub'] == s['sub']),
                  f'fuzzy office name: {name}')
    # pass 3: DepEd division-office remainders
    for sp in specs:
        if sp.get('cand') is not None and sp['remainder']:
            claim(sp, exact, 'division remainder')

    out = []
    for sp in specs:
        r, hit, how = sp['r'], sp['hit'], sp['how']
        rec = dict(r)
        rec.update({'nep_dept': hit['dept'] if hit else None, 'nep_agency': hit['agency'] if hit else None,
                    'nep_agency_dsc': hit['agy_dsc'] if hit else None, 'agency_match': how})
        nep_amt, act_how, hb_amt = sp['nep_amt'], sp['act_how'], r['amount']
        if not hit and r['department'] == 'UNPROGRAMMED APPROPRIATIONS':
            status = 'unprogrammed_not_in_nep_extract'
        elif not hit:
            status = 'agency_unmatched'
        elif act_how == 'unmatched':
            status = 'house_only_activity'
        elif nep_amt == 0:
            status = 'house_only_line'
        elif nep_amt == hb_amt:
            status = 'same'
        else:
            status = 'increased' if hb_amt > nep_amt else 'decreased'
        scope = 'non-infra'
        if r['department'].startswith('DEPARTMENT OF PUBLIC WORKS') and r['class'] not in (
                'General Administration and Support', 'Support to Operations'):
            scope = 'infra: DPWH (workbench)'  # DPWH administration and support count as non-infra
        elif 'IRRIGATION ADMINISTRATION' in r['agency']:
            scope = 'infra: NIA (workbench)'
        elif re.search(r'farm-to-market', r['pap_path'], re.I) and r['department'] == 'DEPARTMENT OF AGRICULTURE':
            scope = 'infra: DA FMR (workbench)'
        elif re.search(r'health facilities enhancement', r['pap_path'], re.I):
            scope = 'infra: DOH HFEP (workbench)'
        rec['scope'] = scope
        pg = nep_page(sp.get('pgs', []))
        if not pg['nep_doc'] and status == 'house_only_line':
            # Proof of absence: the page where the NEP prints this activity, without this line.
            first = min((n for n in sp.get('cand') or () if n.get('pg')),
                        key=lambda n: (n['pg']['nep_doc'], int(n['pg']['nep_pdf_page'])), default=None)
            if first:
                pg = {**{k: first['pg'][k] for k in ('nep_doc', 'nep_pdf_page', 'nep_printed_page')}, 'nep_page_how': 'activity_table'}
        rec.update(pg)
        rec.update({'activity_match': act_how, 'location_match': sp['match'],
                    'nep_prexc_fpap_id': ';'.join(sorted(p for p in sp['paps'] if p)),
                    'nep_amount': nep_amt, 'hb_amount': hb_amt, 'delta': hb_amt - nep_amt, 'status': status})
        out.append(rec)

    # NEP rows nobody claimed, rolled up to activity x region x OU x sub x fund x exp
    mapped_agencies = {(h['sorder'], h['dept'], h['agency']) for h, _, _ in agency_map.values() if h}
    rest = collections.defaultdict(int)
    rest_rows = collections.defaultdict(list)
    for n in nep:
        if n['i'] in used:
            continue
        key = (n['sorder'], n['dept'], n['dept_dsc'], n['agency'], n['agy_dsc'], n['pap'], n['dsc'], n['reg'],
               n['div_dsc'] if n['operdiv'] and n['operdiv'] != n['operunit'] else None, n['oper_dsc'], n['fk'], n['exp'])
        rest[key] += n['amt']
        rest_rows[key].append(n)
    nep_only = []
    for key, amt in rest.items():
        so, d, dd, a, ad, pap, dsc, reg, div, ou, fk, exp = key
        nep_only.append({'nep_sorder': so, 'nep_dept': d, 'nep_dept_dsc': dd, 'nep_agency': a, 'nep_agency_dsc': ad,
                         'nep_prexc_fpap_id': pap, 'activity': dsc, 'uacs_reg_id': reg, 'division': div,
                         'operating_unit': ou, 'fund_kind': fk, 'uacs_exp_cd': exp, 'nep_amount': amt,
                         'agency_in_bill': (so, d, a) in mapped_agencies,
                         'status': 'nep_only_line' if (so, d, a) in mapped_agencies else 'nep_only_agency',
                         **nep_page(rest_rows[key])})

    with open(f'{out_dir}/hb_vs_nep_lines.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader(); w.writerows(out)
    with open(f'{out_dir}/nep_only_lines.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(nep_only[0].keys()))
        w.writeheader(); w.writerows(nep_only)
    amap = [{'hb': list(k), 'nep': ([h['sorder'], h['dept'], h['agency'], h['agy_dsc']] if h else None), 'how': how,
             'hb_total': hb_ag[k], 'nep_total': h['amt'] if h else None}
            for k, (h, how, _) in agency_map.items()]
    json.dump(amap, open(f'{out_dir}/agency_map.json', 'w'), indent=1)

    # ---- everything a person should look at before publishing: unmatched and fuzzy pairings
    review = []
    for r in out:
        why = []
        if r['status'] in ('house_only_activity', 'agency_unmatched'):
            why.append(r['status'])
        if (r['activity_match'] or '').startswith('fuzzy') or (r['agency_match'] or '').startswith('fuzzy'):
            why.append('fuzzy name: ' + (r['activity_match'] or '') + ' / ' + (r['agency_match'] or ''))
        if (r['location_match'] or '').startswith('fuzzy'):
            why.append(r['location_match'])
        if r['activity_match'] and '2nd-reading' in r['activity_match']:
            why.append(r['activity_match'])
        if why:
            review.append({'reason': '; '.join(why), 'agency': r['agency'], 'activity': r['activity'] or r['program'],
                           'region': r['region'], 'operating_unit': r['operating_unit'], 'sub_unit': r['sub_unit'],
                           'uacs_exp_cd': r['uacs_exp_cd'], 'hb_amount': r['hb_amount'], 'nep_amount': r['nep_amount'],
                           'nep_prexc_fpap_id': r['nep_prexc_fpap_id'], 'volume': r['volume'],
                           'printed_page': r['printed_page'], 'line': r['line'], 'scope': r['scope']})
    review.sort(key=lambda x: -(x['hb_amount'] + x['nep_amount']))
    with open(f'{out_dir}/review_matches.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(review[0].keys()))
        w.writeheader(); w.writerows(review)
    print(f'review list: {len(review)} lines')

    # ---- activity rollup: separates money that changed from money that only moved between
    # offices / regions inside the same activity (e.g. PDEA's regional PS printed under Central Office)
    roll = collections.defaultdict(lambda: {'hb': 0, 'nep': 0, 'hb_lines': 0, 'changed_lines': 0, 'label': None,
                                            'agency': None, 'scope': None})
    for sp, rec in zip(specs, out):
        if not sp['hit'] or sp['nact'] is None:
            continue
        k = (sp['ak'], sp['nact'], rec['uacs_exp_cd'])
        g = roll[k]
        g['hb'] += rec['hb_amount']; g['hb_lines'] += 1
        g['changed_lines'] += rec['status'] != 'same'
        g['label'] = g['label'] or (rec['activity'] or rec['program'])
        g['agency'] = g['agency'] or rec['agency']
        g['scope'] = g['scope'] or rec['scope']
    for n in nep:
        k = claimed_by.get(n['i'], ((n['sorder'], n['dept'], n['agency']), n['act'], n['exp']))
        g = roll[k]
        g['nep'] += n['amt']
        g['label'] = g['label'] or n['dsc']
        g['agency'] = g['agency'] or n['agy_dsc']
    rollup = []
    for (ak, act, exp), g in roll.items():
        if g['hb'] == g['nep'] == 0:
            continue
        if g['hb'] == g['nep']:
            st_ = 'same' if g['changed_lines'] == 0 else 'same total, moved between locations'
        elif g['nep'] == 0:
            st_ = 'bill-only'
        elif g['hb'] == 0:
            st_ = 'NEP-only'
        else:
            st_ = 'increased' if g['hb'] > g['nep'] else 'decreased'
        rollup.append({'nep_sorder': ak[0], 'nep_dept': ak[1], 'nep_agency': ak[2], 'agency': g['agency'],
                       'activity': g['label'], 'uacs_exp_cd': exp, 'scope': g['scope'] or '',
                       'nep_amount': g['nep'], 'hb_amount': g['hb'], 'delta': g['hb'] - g['nep'],
                       'bill_lines': g['hb_lines'], 'bill_lines_not_same': g['changed_lines'], 'status': st_})
    rollup.sort(key=lambda r: -abs(r['delta']))
    with open(f'{out_dir}/activity_rollup.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rollup[0].keys()))
        w.writeheader(); w.writerows(rollup)
    rs = collections.Counter(r['status'] for r in rollup)
    rp = collections.defaultdict(int)
    for r in rollup:
        rp[r['status']] += abs(r['delta']) if r['delta'] else r['hb_amount']
    print('activity rollup:', {k: (v, f'{rp[k]:,}') for k, v in rs.items()})

    # ---- likely renames: House-only and NEP-only activities in the same agency + expense class
    ho = collections.defaultdict(int)
    for r in out:
        if r['status'] in ('house_only_activity', 'house_only_line') and r['nep_agency']:
            ho[(r['nep_dept'], r['nep_agency'], r['activity'] or r['program'], r['uacs_exp_cd'])] += r['hb_amount']
    no_ = collections.defaultdict(int)
    for r in nep_only:
        no_[(r['nep_dept'], r['nep_agency'], r['activity'], r['uacs_exp_cd'])] += r['nep_amount']
    renames = []
    for (d, a, act, exp), hb_amt in ho.items():
        cands = [(k[2], v) for k, v in no_.items() if k[0] == d and k[1] == a and k[3] == exp]
        if cands:
            for nep_act, nep_amt in sorted(cands, key=lambda c: -difflib.SequenceMatcher(None, norm(act) or '', norm(c[0]) or '').ratio())[:2]:
                renames.append({'nep_dept': d, 'nep_agency': a, 'uacs_exp_cd': exp, 'hb_activity': act, 'hb_amount': hb_amt,
                                'nep_activity': nep_act, 'nep_amount': nep_amt,
                                'similarity': round(difflib.SequenceMatcher(None, norm(act) or '', norm(nep_act) or '').ratio(), 2)})
    renames.sort(key=lambda r: -(r['hb_amount'] + r['nep_amount']))
    if renames:
        with open(f'{out_dir}/rename_candidates.csv', 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(renames[0].keys()))
            w.writeheader(); w.writerows(renames)

    # ---- summary ----------------------------------------------------------------------
    st = collections.Counter()
    for r in out:
        st[r['status']] += 1
    pes = collections.defaultdict(lambda: [0, 0])
    for r in out:
        pes[r['status']][0] += r['hb_amount']; pes[r['status']][1] += r['nep_amount']
    print('agencies:', collections.Counter(how for _, how, _ in agency_map.values()))
    print('activity matches:', collections.Counter(v[1] for v in act_match.values()))
    print(f"{'status':22} {'lines':>7} {'HB pesos':>20} {'NEP pesos':>20}")
    for s_, n in st.most_common():
        print(f'{s_:22} {n:7d} {pes[s_][0]:20,d} {pes[s_][1]:20,d}')
    tot_hb = sum(r['hb_amount'] for r in out)
    tot_nep_claimed = sum(r['nep_amount'] for r in out)
    no = collections.Counter(); nop = collections.defaultdict(int)
    for r in nep_only:
        no[r['status']] += 1; nop[r['status']] += r['nep_amount']
    print('NEP-only:', {k: (no[k], f'{nop[k]:,}') for k in no})
    print(f'HB total {tot_hb:,}  NEP claimed {tot_nep_claimed:,}  NEP all new approps {sum(n["amt"] for n in nep):,}')


if __name__ == '__main__':
    main(*sys.argv[1:6])
