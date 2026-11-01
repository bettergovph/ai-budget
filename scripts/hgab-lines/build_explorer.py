#!/usr/bin/env python3
"""Data for the House bill explorer (/hgab/2027/explorer): the line-by-line comparison
(compare.py) reshaped for the browser.

  explorer/index.json         totals, status counts and one row per department
  explorer/d/<slug>.json      one department: its agencies, each with the bill's own hierarchy
                              (program > activity > region > office > school > fund) down to
                              lines by expense class, NEP-only rows placed under their activity

Integer pesos throughout. Each bill line carries its published page (volume, PDF page, page
number shown on the page, line) so the UI can open the PDF at that page.

Usage: build_explorer.py <lines_dir> <out_dir>
  lines_dir: compare.py's output (hb_vs_nep_lines.csv, nep_only_lines.csv, agency_map.json,
             object_compare.csv optional)
"""
import collections, csv, datetime, json, os, re, sys
from urllib.parse import quote as urlquote

STATUS = {'same': 'same', 'increased': 'higher', 'decreased': 'lower', 'house_only_line': 'house_only',
          'house_only_activity': 'house_only', 'agency_unmatched': 'house_only',
          'unprogrammed_not_in_nep_extract': 'unprogrammed'}
REGION_NAME = {'13': 'National Capital Region (NCR)', '01': 'Region I - Ilocos', '14': 'Cordillera Administrative Region (CAR)',
               '02': 'Region II - Cagayan Valley', '03': 'Region III - Central Luzon', '04': 'Region IVA - CALABARZON',
               '17': 'Region IVB - MIMAROPA', '05': 'Region V - Bicol', '06': 'Region VI - Western Visayas',
               '18': 'Negros Island Region (NIR)', '07': 'Region VII - Central Visayas', '08': 'Region VIII - Eastern Visayas',
               '09': 'Region IX - Zamboanga Peninsula', '10': 'Region X - Northern Mindanao', '11': 'Region XI - Davao',
               '12': 'Region XII - SOCCSKSARGEN', '16': 'Region XIII - Caraga',
               '19': 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)', '00': 'Nationwide'}
DOC = {'1a': 'hb10858-3r-vol-ia', '1b': 'hb10858-3r-vol-ib'}
LEVELS = [('section', 'section'), ('project_kind', 'kind'), ('class', 'class'), ('program', 'program'),
          ('subprogram', 'subprogram'), ('activity', 'activity'), ('region', 'region'),
          ('operating_unit', 'office'), ('sub_unit', 'unit'), ('fund_source', 'fund')]
SCOPE = {'non-infra': None, 'infra: DPWH (workbench)': 'dpwh', 'infra: NIA (workbench)': 'nia',
         'infra: DA FMR (workbench)': 'fmr', 'infra: DOH HFEP (workbench)': 'hfep'}


def slug(s):
    s = re.sub(r'\([^)]*\)', ' ', s or '').lower().replace('&', ' and ')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


class Node:
    __slots__ = ('k', 'l', 'n', 'h', 'c', 'x', 'idx')

    def __init__(self, k, l):
        self.k, self.l, self.n, self.h, self.c, self.x, self.idx = k, l, 0, 0, [], [], {}

    def child(self, k, l):
        key = (k, l)
        if key not in self.idx:
            self.idx[key] = Node(k, l)
            self.c.append(self.idx[key])
        return self.idx[key]

    def total(self):
        self.n = sum(x['n'] for x in self.x) + sum(c.total()[0] for c in self.c)
        self.h = sum(x['h'] for x in self.x) + sum(c.h for c in self.c)
        return self.n, self.h

    def js(self):
        d = {'k': self.k, 'l': self.l, 'n': self.n, 'h': self.h}
        if self.c:
            d['c'] = [c.js() for c in self.c]
        if self.x:
            d['x'] = self.x
        return d


# Short names for the boards: the NEP's own acronym, plainer where the acronym is not one people use.
SHORT_FIX = {'CONGRESS': 'Congress', 'JUD': 'Judiciary', 'OMB': 'Ombudsman', 'OEOs': 'Other executive offices',
             'BSGC': 'GOCC subsidies', 'ALGU': 'LGU allocations', 'SUCs': 'State universities'}
SPF_SHORT = {'NATIONAL DISASTER RISK REDUCTION AND MANAGEMENT FUND (CALAMITY FUND)': 'Calamity fund (NDRRMF)',
             'REVISED AFP MODERNIZATION PROGRAM': 'AFP Modernization Program'}
SMALL = {'of', 'the', 'and', 'for', 'in', 'on', 'to', 'a', 'an', 'at', 'by', 'or'}
KEEP_UPPER = {'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'XIII', 'AFP', 'NCR', 'BARMM', 'MMDA', 'LGU',
              'LGUS', 'SUC', 'SUCS', 'GOCC', 'GOCCS', 'NEP', 'UP', 'PNP', 'NBI', 'TESDA', 'CHED', 'PAGASA', 'DOST'}


def title_case(s):
    if s != s.upper():
        return s
    out = []
    for i, w in enumerate(re.split(r'(\s+|-)', s.lower())):
        core = re.sub(r'[^a-z]', '', w)
        if core.upper() in KEEP_UPPER:
            out.append(w.upper().replace('LGUS', 'LGUs').replace('SUCS', 'SUCs').replace('GOCCS', 'GOCCs'))
        elif i > 0 and w in SMALL:
            out.append(w)
        else:
            out.append(re.sub(r'^([^a-z]*)([a-z])', lambda m: m.group(1) + m.group(2).upper(), w))
    return ''.join(out)


def build_boards(lines_dir, out_dir, index_rows, dept_docs, built_at):
    """explorer/boards.json: departments, agencies and budget lines ranked by the leaderboards
    (src/lib/hgab-leaderboard.ts, section "whole-bill"). Integer pesos; the boards rank, this file lists."""
    import duckdb
    con = duckdb.connect(f'{lines_dir}/nep.duckdb', read_only=True)
    dpt = {d: x for d, x in con.execute(
        "select distinct DEPARTMENT, UACS_DPT_DSC from nep where SORDER = '1' and UACS_DPT_DSC is not null").fetchall()}
    con.close()
    amap = json.load(open(f'{lines_dir}/agency_map.json'))
    nep_dept_of = {}  # bill department name -> NEP department code (section 1)
    for m in amap:
        if m['nep'] and m['nep'][0] == '1':
            nep_dept_of.setdefault(m['hb'][1], m['nep'][1])

    def short_of(dept_name):
        code = nep_dept_of.get(dept_name)
        full = dpt.get(code or '')
        if full and full_matches(full, dept_name):
            m = re.search(r'\(([^)]+)\)\s*$', full)
            if m:
                return SHORT_FIX.get(m.group(1), m.group(1))
        return title_case(dept_name)

    def full_matches(nep_full, bill_name):
        a = re.sub(r'\s*\([^)]*\)\s*$', '', nep_full).lower().replace('the ', '')
        b = bill_name.lower().replace('the ', '')
        return re.sub(r'[^a-z]', '', a) == re.sub(r'[^a-z]', '', b)

    def pct(n, h):
        return round((h - n) / n * 100, 2) if n else None

    explorer = '/hgab/2027/explorer'
    departments, agencies = [], []
    for r in index_rows:
        if r['name'] == 'UNPROGRAMMED APPROPRIATIONS':
            continue
        spf = r['name'] not in nep_dept_of
        short = short_of(r['name']) if not spf else SPF_SHORT.get(r['name'], title_case(r['name']))
        departments.append({'label': short,
                            'sub': title_case(r['name']) if not spf else 'Special purpose fund',
                            'nep_php': r['nep'], 'hgab3_php': r['house'], 'delta_php': r['house'] - r['nep'],
                            'delta_pct': pct(r['nep'], r['house']), 'href': f"{explorer}/{r['id']}"})
        for a in dept_docs[r['id']]['agencies']:
            own = a['name'] != r['name']
            name = title_case(a['name']) if own else (short if spf else (a['nep_name'] or title_case(a['name'])))
            # "Office of the Secretary" alone says nothing on a board: prefix the department
            if re.match(r'^Office of the Secretary', name) or not own:
                label = name if spf else f'{short} {name}' if name != short else name
            else:
                label = name
            agencies.append({'label': label,
                             'sub': 'Special purpose fund' if spf else title_case(r['name']),
                             'nep_php': a['nep'], 'hgab3_php': a['house'], 'delta_php': a['house'] - a['nep'],
                             'delta_pct': pct(a['nep'], a['house']),
                             'href': f"{explorer}/{r['id']}" + (f"?q={urlquote(a['name'])}" if own else '')})

    # Budget lines: the bill's program, activity or project, all regions, offices and expense classes added up.
    # Lines the DPWH, farm-to-market, HFEP and NIA pages cover project by project are left out.
    dept_id = {r['name']: r['id'] for r in index_rows}
    agency_name = {}
    for m in amap:
        if m['nep']:
            agency_name[(m['nep'][1], m['nep'][2])] = (m['hb'][1], m['hb'][3] if m['hb'][3] != m['hb'][1] else m['nep'][3])
    groups = collections.OrderedDict()
    for r in csv.DictReader(open(f'{lines_dir}/hb_vs_nep_lines.csv')):
        if r['scope'] != 'non-infra' or r['status'] in ('unprogrammed_not_in_nep_extract', 'agency_unmatched'):
            continue
        # BARMM's allocations name their purposes one level in, where offices usually sit
        label = r['activity'] or r['program'] or r['class'] or r['operating_unit'] or r['agency']
        k = (r['nep_dept'], r['nep_agency'], norm(label))
        g = groups.setdefault(k, {'label': label, 'dept': r['department'], 'agency': r['agency'], 'nep': 0, 'house': 0,
                                  'renamed': None})
        g['nep'] += int(r['nep_amount']); g['house'] += int(r['hb_amount'])
        if 'renamed' in (r['activity_match'] or ''):
            g['renamed'] = True
    for r in csv.DictReader(open(f'{lines_dir}/nep_only_lines.csv')):
        pap = r['nep_prexc_fpap_id'] or ''
        infra = ((r['nep_dept'] == '18' and pap.startswith('3')) or 'irrigation' in (r['nep_agency_dsc'] or '').lower()
                 or re.search(r'farm-to-market|health facilities enhancement', r['activity'] or '', re.I))
        if infra:
            continue
        k = (r['nep_dept'], r['nep_agency'], norm(r['activity']))
        if k not in groups:
            d, a = agency_name.get((r['nep_dept'], r['nep_agency']), (None, r['nep_agency_dsc']))
            if d is None:
                continue
            groups[k] = {'label': r['activity'], 'dept': d, 'agency': a, 'nep': 0, 'house': 0, 'renamed': None}
        groups[k]['nep'] += int(r['nep_amount'])
    lines = []
    for (nd, na, _), g in groups.items():
        if g['nep'] == g['house'] == 0:
            continue
        d_short = short_of(g['dept']) if g['dept'] in nep_dept_of else SPF_SHORT.get(g['dept'], title_case(g['dept']))
        ag = title_case(g['agency'])
        sub = d_short if ag.lower() in (title_case(g['dept']).lower(), d_short.lower()) else f'{d_short} · {ag}'
        status = ('house_only' if g['nep'] == 0 else 'nep_only' if g['house'] == 0
                  else 'same' if g['nep'] == g['house'] else 'higher' if g['house'] > g['nep'] else 'lower')
        label = title_case(re.sub(r'^\d+\.\s+', '', g['label']))  # funds number their purposes; programs are in capitals
        lines.append({'label': label, 'sub': sub, 'nep_php': g['nep'], 'hgab3_php': g['house'],
                      'delta_php': g['house'] - g['nep'], 'delta_pct': pct(g['nep'], g['house']), 'status': status,
                      'note': 'Renamed in the third reading; same line as in the NEP' if g['renamed'] else None,
                      'href': f"{explorer}/{dept_id.get(g['dept'], '')}?q={urlquote(g['label'])}"})
    doc = {'schema': 1, 'built_at': built_at,
           'scope': {'hgab3_php': sum(r['house'] for r in index_rows if r['name'] != 'UNPROGRAMMED APPROPRIATIONS'),
                     'nep_php': sum(r['nep'] for r in index_rows),
                     'unprogrammed_php': sum(r['house'] for r in index_rows if r['name'] == 'UNPROGRAMMED APPROPRIATIONS'),
                     'line_groups': len(lines)},
           'departments': departments, 'agencies': agencies, 'lines': lines}
    with open(f'{out_dir}/boards.json', 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    st = collections.Counter(x['status'] for x in lines)
    print(f"boards.json: {len(departments)} departments, {len(agencies)} agencies, {len(lines)} budget lines {dict(st)}")


def main(lines_dir, out_dir):
    lines = list(csv.DictReader(open(f'{lines_dir}/hb_vs_nep_lines.csv')))
    nep_only = list(csv.DictReader(open(f'{lines_dir}/nep_only_lines.csv')))
    amap = json.load(open(f'{lines_dir}/agency_map.json'))
    os.makedirs(f'{out_dir}/d', exist_ok=True)

    # departments and agencies in the bill's own order
    depts = collections.OrderedDict()
    for m in amap:
        dept_no, dept, agy_no, agy = m['hb']
        d = depts.setdefault(dept, {'roman': dept_no, 'name': dept, 'agencies': collections.OrderedDict()})
        d['agencies'][(agy_no, agy)] = {'no': agy_no or None, 'name': agy if agy != dept else dept,
                                        'nep': m['nep'], 'nep_total': m['nep_total'] or 0,
                                        'match': m['how'], 'root': Node('agency', agy)}
    nep_key = {}
    for d in depts.values():
        for a in d['agencies'].values():
            if a['nep']:
                nep_key[(a['nep'][1], a['nep'][2])] = a

    for r in lines:
        a = depts[r['department']]['agencies'][(r['agency_no'], r['agency'])]
        node = a['root']
        for col, kind in LEVELS:
            if r[col]:
                node = node.child(kind, r[col])
        x = {'e': r['uacs_exp_cd'], 'n': int(r['nep_amount']), 'h': int(r['hb_amount']), 's': STATUS[r['status']]}
        if r['pdf_page']:
            x['p'] = [DOC.get(r['volume'], r['volume']), int(r['pdf_page']), int(r['printed_page'] or 0), int(r['line'] or 0)]
        if r['leaf_type'] == 'ANNEX_SCHOOL':
            x['a'] = 1  # from the non-implementing-schools annex
        scope = SCOPE.get(r['scope'])
        if scope:
            x['z'] = scope
        notes = []
        if (r['activity_match'] or '').startswith('fuzzy') or 'renamed' in (r['activity_match'] or ''):
            notes.append(r['activity_match'])
        if (r['location_match'] or '').startswith('fuzzy'):
            notes.append(r['location_match'])
        if notes:
            x['m'] = '; '.join(notes)
        node.x.append(x)

    # NEP rows no bill line claimed: under the bill's activity of the same name, else their own group
    placed = unplaced = 0
    for r in nep_only:
        a = nep_key.get((r['nep_dept'], r['nep_agency']))
        if a is None:
            continue
        root = a['root']
        target = None
        want = norm(r['activity'])
        stack = [root]
        while stack and target is None:
            n = stack.pop()
            if n.k == 'activity' and norm(n.l) == want:
                target = n
            stack.extend(n.c)
        if target is None:
            target = root.child('group', 'In the NEP only').child('activity', r['activity'])
            unplaced += 1
        else:
            placed += 1
        node = target
        if r['uacs_reg_id']:
            node = node.child('region', REGION_NAME.get(r['uacs_reg_id'], r['uacs_reg_id']))
        if r['division']:
            node = node.child('office', r['division'])
        if r['operating_unit']:
            node = node.child('unit' if r['division'] else 'office', r['operating_unit'])
        if r['fund_kind']:
            node = node.child('fund', {'GOP': 'GOP Counterpart', 'LOAN': 'Loan Proceeds'}.get(r['fund_kind'], r['fund_kind']))
        node.x.append({'e': r['uacs_exp_cd'], 'n': int(r['nep_amount']), 'h': 0, 's': 'nep_only'})

    objects = collections.defaultdict(list)
    if os.path.exists(f'{lines_dir}/object_compare.csv'):
        for o in csv.DictReader(open(f'{lines_dir}/object_compare.csv')):
            objects[(o.get('hb_dept_no'), o.get('hb_agency_no'), o.get('hb_agency'))].append(o)

    counts = collections.Counter()
    index_rows = []
    dept_docs = {}
    used_slugs = set()
    for d in depts.values():
        ds = slug(d['name'])
        assert ds not in used_slugs, ds
        used_slugs.add(ds)
        out_agencies = []
        dn = dh = dl = dc = 0
        a_slugs = set()
        for (agy_no, agy), a in d['agencies'].items():
            root = a['root']
            root.total()
            leaves = []
            stack = [root]
            while stack:
                n = stack.pop()
                leaves.extend(n.x)
                stack.extend(n.c)
            st = collections.Counter(x['s'] for x in leaves)
            counts.update(st)
            asl = slug(a['name']) or 'agency'
            while asl in a_slugs:
                asl += '-x'
            a_slugs.add(asl)
            nep_total = a['nep_total']
            out_agencies.append({
                'id': asl, 'no': a['no'], 'name': a['name'],
                'nep_name': a['nep'][3] if a['nep'] else None,
                'nep_code': f"{a['nep'][1]}-{a['nep'][2]}" if a['nep'] else None,
                'nep': nep_total, 'house': root.h, 'lines': len(leaves),
                'status': dict(st), 'tree': root.js()['c'] if root.c else [],
            })
            dn += nep_total; dh += root.h; dl += len(leaves); dc += len(leaves) - st.get('same', 0)
        doc = {'id': ds, 'roman': d['roman'], 'name': d['name'], 'nep': dn, 'house': dh, 'lines': dl,
               'agencies': out_agencies}
        with open(f'{out_dir}/d/{ds}.json', 'w') as f:
            json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
        dept_docs[ds] = doc
        index_rows.append({'id': ds, 'roman': d['roman'], 'name': d['name'], 'nep': dn, 'house': dh,
                           'lines': dl, 'changed': dc, 'agencies': len(out_agencies),
                           'bytes': os.path.getsize(f'{out_dir}/d/{ds}.json')})
    total_h = sum(r['house'] for r in index_rows)
    total_n = sum(r['nep'] for r in index_rows)
    unprog = sum(r['house'] for r in index_rows if r['name'] == 'UNPROGRAMMED APPROPRIATIONS')
    index = {'built_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
             'house_total': total_h, 'nep_total': total_n, 'unprogrammed': unprog,
             'lines': sum(r['lines'] for r in index_rows), 'status': dict(counts), 'departments': index_rows}
    with open(f'{out_dir}/index.json', 'w') as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
    build_boards(lines_dir, out_dir, index_rows, dept_docs, index['built_at'])
    big = sorted(index_rows, key=lambda r: -r['bytes'])[:3]
    print(f"{len(index_rows)} departments, {index['lines']:,} lines; House bill {total_h:,}, NEP {total_n:,}; "
          f"NEP-only rows placed under their activity {placed}, in their own group {unplaced}")
    print('status:', dict(counts))
    print('largest files:', [(r['id'], f"{r['bytes'] / 1e6:.1f} MB") for r in big])


if __name__ == '__main__':
    main(*sys.argv[1:3])
