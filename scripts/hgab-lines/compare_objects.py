#!/usr/bin/env python3
"""Agency x object-of-expenditure comparison: HB 10858 (3rd reading) "New Appropriations, by
Object of Expenditures" tables vs FY2027 NEP UACS object codes (fund 101*, thousands of pesos).

The bill prints objects at mixed depth. Under MOOE and Capital Outlays it usually prints the UACS
group ("Supplies and Materials Expenses" = 50203xx, "Travelling Expenses" = 50201xx); under
Personnel Services it prints sub-objects that the NEP extract folds into one object
("Productivity Enhancement Incentive", "Medical Allowance", "Step Increment" all sit in NEP
5010299000 / 5010499000). So each bill leaf is mapped to one or more NEP code prefixes, and per
agency the leaves and NEP objects that touch the same codes form one comparison unit. Most units
are one bill line against one NEP object or group; the rest say so in `grain`.

Mapping, in order (method recorded per row):
  1 name = NEP object      bill label equals an NEP object description (suffixes such as
                           "- Civilian", "(MUP)", "Lump-sum for" dropped; plurals folded)
  2 name = UACS sub-object bill label equals a sub-object name in earlier GAAs (UACS_CHART,
                           GAA 2020-25 in transparency-dashboard), rolled up to its 7-digit object
  3 sum evidence           bill amount equals one NEP code prefix (7-digit object or 5-digit
                           group) in at least half the agencies that print the label (>= 2)
  4 variant of             typo/plural/word-order variant of a label resolved above
  5 name tokens            all label words appear in UACS names; may give several objects
                           ("Magna Carta for Public Health Workers" -> subsistence, laundry,
                           quarters, honoraria, hazard pay, longevity)
  6 fuzzy name             difflib >= 0.85 against NEP/UACS names
  A name-matched object that is empty in the NEP everywhere the label is printed is re-tested
  on residuals (NEP object minus the other bill lines mapped to it); that is how "Medical
  Allowance" lands in 5010299000 rather than its empty namesake 5010218000.
Per agency, an object shared between a multi-object leaf and its own bill line is split off when
the own line equals the NEP object to the thousand. A heading printed with an amount (PopCom's
"Other Benefits") is matched by amount to an unclaimed NEP object of the same class. An NEP object
no bill line claims is folded into the one bill unit of the same 5-digit UACS group whose gap it
closes exactly (DepEd "Non-Permanent Positions" = casual/contractual + substitute teachers).

Output, one row per agency x comparison unit (bill lines and NEP objects that share codes; 1:1
for most): HB labels and paths, NEP codes, thousands on each side, delta, status (same /
increased / decreased / bill-only / NEP-only), match method, provenance. Bill-only rows carry the
target code prefix(es) in nep_obj_cd. Agencies on one side only (Unprogrammed Appropriations,
IBC) are kept and flagged in the summary.

Usage: compare_objects.py tables-vol1a.json tables-vol1b.json agency_map.json nep.duckdb out.csv
  UACS_CHART  GAA objects aggregate with sub-object names
              (default ~/projects/transparency-dashboard/public/data/gaa/aggregates/objects.json;
              optional: without it, step 2 is skipped)
"""
import collections, csv, difflib, json, os, re, sys
import duckdb

CLS_RX = [('1', r'^personnel services$'), ('2', r'^maintenance and other operating expen'),
          ('3', r'^financial expenses$'), ('6', r'^capital outlay|^property plant and equipment outlay$')]
CLS_NAME = {'1': 'PS', '2': 'MOOE', '3': 'FinEx', '6': 'CO'}
STOP = {'and', 'of', 'for', 'the', 'to', 'in', 'a', 'an', 'on', 'under', 'per'}
GENERIC = {'personnel', 'benefit'}


def norm(s):
    s = (s or '').lower().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def sing(t):
    return t[:-1] if len(t) > 3 and t.endswith('s') and not t.endswith(('ss', 'us', 'is')) else t


def name_key(s):
    """Object name without person-class suffixes, acronyms in parentheses, 'Lump-sum for', plurals."""
    s = re.sub(r'\([^)]*\)', ' ', s or '')
    s = norm(s)
    s = re.sub(r'\b(duty based allowance|military uniformed personnel|civilian personnel|civilian|mup|dba)\b', ' ', s)
    s = re.sub(r'^\s*lump sum for\b', ' ', s)
    return ' '.join(sing(t) for t in s.split() if t not in STOP)


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def agency_key(ctx):
    return (ctx['dept_no'], ctx['dept'], ctx['agency_no'] or '', ctx['agency'] or ctx['dept'])


# ---------------------------------------------------------------------------- bill leaves
def bill_leaves(t, headings):
    out = []

    def walk(n, path):
        for c in n['children']:
            kids = c['children']
            if (kids and not c['amounts'] and len(kids) == 1 and not kids[0]['children']
                    and re.search(r'[-,]\s*$', c['label'])):
                # label wrapped onto the next printed line (PCG "Lump-sum for Filling of Positions -")
                ch = dict(kids[0], label=c['label'].rstrip() + ' ' + kids[0]['label'], children=[])
                out.append((path + [ch['label']], ch, 'label wrapped over two lines'))
            elif kids:
                headings.add(norm(c['label']))
                walk(c, path + [c['label']])
            else:
                out.append((path + [c['label']], c, None))

    walk(t['tree'], [])
    leaves = []
    for path, n, note in out:
        if 'thousands' not in n['amounts']:
            continue  # heading with nothing under it ("Capital Outlays", "Permanent Positions")
        cls = None
        for lab in reversed(path[:-1]):
            cls = next((c for c, rx in CLS_RX if re.search(rx, norm(lab))), None)
            if cls:
                break
        mup = False
        for lab in reversed(path):
            if 'military uniformed personnel' in norm(lab):
                mup = True
                break
            if norm(lab) == 'civilian personnel':
                break
        leaves.append({'label': n['label'], 'path': ' > '.join(path), 'cls': cls, 'mup': mup,
                       'key': name_key(n['label']), 'thousands': n['amounts']['thousands'],
                       'vol': t['loc']['vol'], 'pdf_page': n.get('pdf_page'), 'printed_page': n.get('printed_page'),
                       'line': n.get('lineno'), 'note': note})
    return leaves


def total_new_approps(t):
    for x in reversed(t['totals']):
        if x['label'].upper().startswith('TOTAL NEW AP'):
            return x['amounts'].get('thousands')
    return None


# ---------------------------------------------------------------------------- name indexes
def load_chart(path):
    """UACS sub-object names from earlier GAAs: name_key -> {7-digit object: (latest year, count)}."""
    idx = collections.defaultdict(dict)
    if not path or not os.path.exists(path):
        return idx
    for r in json.load(open(path))['data']:
        c = r.get('object_code')
        if not c or not re.fullmatch(r'\d{10}', c):
            continue
        k = name_key(r['description'])
        yr = max(int(y) for y in r['years']) if r.get('years') else 0
        y0, n0 = idx[k].get(c[:7], (0, 0))
        idx[k][c[:7]] = (max(y0, yr), n0 + 1)
    return idx


def main(vol_a, vol_b, amap_path, nep_db, out_csv):
    tables = [t for p in (vol_a, vol_b) for t in json.load(open(p)) if t['kind'] == 'O']
    amap = {tuple(x['hb']): x for x in json.load(open(amap_path))}
    headings = set()
    bill = collections.OrderedDict()   # hb agency key -> leaves
    bill_total = {}
    for t in tables:
        k = agency_key(t['ctx'])
        bill.setdefault(k, []).extend(bill_leaves(t, headings))
        bill_total[k] = bill_total.get(k, 0) + (total_new_approps(t) or 0)
    heading_keys = {name_key(h) for h in headings}  # labels some table prints as a heading

    con = duckdb.connect(nep_db, read_only=True)
    nep = collections.defaultdict(lambda: collections.defaultdict(int))  # (sorder, dept, agency) -> obj -> thousands
    nep_dsc, nep_agy = {}, {}
    bad_units = 0
    for so, d, a, adsc, obj, odsc, pesos in con.execute("""
            select SORDER, DEPARTMENT, AGENCY, any_value(UACS_AGY_DSC), UACS_OBJ_CD, any_value(UACS_OBJ_DSC), sum(pesos)
            from nep where FUNDCD like '101%' and pesos is not null group by 1, 2, 3, 5""").fetchall():
        if pesos % 1000:
            bad_units += 1
        if obj is None:
            obj = '?'
        nep[(so, d, a)][obj] += pesos // 1000
        nep_dsc[obj] = odsc
        nep_agy[(so, d, a)] = adsc
    # zero-sum objects carry nothing to compare
    for a in nep:
        for o in [o for o, v in nep[a].items() if v == 0]:
            del nep[a][o]
    all_codes = sorted({c for c in nep_dsc if c != '?'})
    nep_names = collections.defaultdict(dict)
    for c in all_codes:
        nep_names[name_key(nep_dsc[c])][c[:7]] = (9999, 1)
    chart = load_chart(os.environ.get('UACS_CHART', os.path.expanduser(
        '~/projects/transparency-dashboard/public/data/gaa/aggregates/objects.json')))

    def prefix_sum(a, p):
        return sum(v for o, v in nep[a].items() if o.startswith(p))

    # NEP side for each mapped bill agency
    hb2nep = {}
    for k in bill:
        x = amap.get(k)
        hb2nep[k] = tuple(x['nep'][:3]) if x and x['nep'] else None

    # ------------------------------------------------------------------------ label mapping
    # per (class, key): agencies -> bill thousands
    by_key = collections.defaultdict(lambda: collections.defaultdict(int))
    for k, ls in bill.items():
        for l in ls:
            if hb2nep[k]:
                by_key[(l['cls'], l['key'])][hb2nep[k]] += l['thousands']
    all_keys = sorted({(l['cls'], l['key']) for ls in bill.values() for l in ls}, key=lambda x: (x[0] or '', x[1]))
    mapping = {}  # (cls, key) -> (tuple of code prefixes, method)

    def in_cls(code7, cls):
        return cls is not None and code7[1:3] == {'1': '01', '2': '02', '3': '03', '6': '06'}[cls]

    def exact(idx, ck):
        cls, key = ck
        cands = {c: v for c, v in idx.get(key, {}).items() if in_cls(c, cls)}
        if not cands:
            return None
        return max(cands, key=lambda c: cands[c])  # latest year, then most agencies

    for ck in all_keys:
        c = exact(nep_names, ck)
        if c:
            mapping[ck] = ((c,), 'name = NEP object')
            continue
        c = exact(chart, ck)
        if c:
            mapping[ck] = ((c,), 'name = UACS sub-object (GAA 2020-25), rolled up')

    cls_prefixes = {cls: sorted({c[:L] for c in all_codes for L in (5, 7) if in_cls(c[:7], cls)}) for cls in '1236'}

    def evidence(ck):
        cls, _ = ck
        amts = {a: v for a, v in by_key[ck].items() if v}
        if not amts or cls is None:
            return None, 0, 0
        sc = collections.Counter()
        for a, v in amts.items():
            for p in cls_prefixes[cls]:
                if prefix_sum(a, p) == v:
                    sc[p] += 1
        if not sc:
            return None, 0, len(amts)
        best = max(sc.items(), key=lambda kv: (kv[1], -len(kv[0])))
        return best[0], best[1], len(amts)

    for ck in all_keys:
        if ck in mapping or ck[1] in heading_keys:
            continue
        p, n, of = evidence(ck)
        if p and n >= 2 and n * 2 >= of:
            mapping[ck] = ((p,), f'sum evidence ({n}/{of} agencies)')

    def variant(ck):
        cls, key = ck
        kt = set(key.split())
        best = None
        for (c2, k2), (codes, how) in list(mapping.items()):
            if c2 != cls or how.startswith('variant'):
                continue
            t2 = set(k2.split())
            r = ratio(key, k2)
            if kt == t2 or (kt and kt < t2) or r >= 0.88:
                score = (kt == t2, r)
                if best is None or score > best[0]:
                    best = (score, codes, k2)
        return best

    def tokens_in_names(ck):
        cls, key = ck
        # "personnel"/"benefit" are filler: "Magna Carta for Science & Technology Personnel" is
        # "... Magna Carta Benefits for Science and Technology under R.A. 8439" in UACS
        kt = set(key.split()) - GENERIC
        if not kt:
            return None
        codes = set()
        for idx in (nep_names, chart):
            for k2, cs in idx.items():
                if kt <= set(k2.split()) - GENERIC:
                    codes |= {c for c in cs if in_cls(c, cls)}
        return tuple(sorted(codes)) or None

    def fuzzy(ck):
        cls, key = ck
        best = None
        for idx in (nep_names, chart):
            for k2, cs in idx.items():
                cs = [c for c in cs if in_cls(c, cls)]
                r = ratio(key, k2)
                if cs and r >= 0.85 and (best is None or r > best[0]):
                    best = (r, max(cs, key=lambda c: idx[k2][c]))
        return best

    for ck in all_keys:
        if ck in mapping:
            continue
        if ck[1] in heading_keys:
            mapping[ck] = ((), 'heading printed as a line')
            continue
        v = variant(ck)
        if v:
            mapping[ck] = (v[1], f'variant of "{v[2]}"')
            continue
        c = tokens_in_names(ck)
        if c:
            mapping[ck] = (c, 'name tokens in UACS name' + ('s' if len(c) > 1 else ''))
            continue
        f = fuzzy(ck)
        if f:
            mapping[ck] = ((f[1],), f'fuzzy name ({f[0]:.2f})')
            continue
        mapping[ck] = ((), 'unmatched')

    # residual re-test: a named object that the NEP leaves empty wherever the label is printed
    for ck, (codes, how) in list(mapping.items()):
        if not how.startswith('name') or not by_key[ck]:
            continue
        if any(prefix_sum(a, p) for a in by_key[ck] for p in codes):
            continue
        sc = collections.Counter()
        amts = {a: v for a, v in by_key[ck].items() if v}
        for a, v in amts.items():
            for p in cls_prefixes[ck[0]]:
                if len(p) != 7:
                    continue
                others = sum(by_key[ck2].get(a, 0) for ck2, (c2, _) in mapping.items()
                             if ck2 != ck and c2 == (p,))
                if prefix_sum(a, p) - others == v:
                    sc[p] += 1
        if sc:
            p, n = sc.most_common(1)[0]
            if n * 2 >= len(amts):
                mapping[ck] = ((p,), f'{how} {codes[0]} is empty in NEP; residual evidence -> {p} ({n}/{len(amts)} agencies)')

    # ------------------------------------------------------------------------ units per agency
    rows = []
    checks = {'hb_ok': 0, 'hb_bad': [], 'nep_ok': 0, 'nep_bad': []}
    seen_nep = set()

    def obj_label(codes):
        return '; '.join(f'{c} {nep_dsc.get(c, "")}'.strip() for c in codes)

    for k, leaves in bill.items():
        na = hb2nep[k]
        x = amap.get(k)
        hb_sum = sum(l['thousands'] for l in leaves)
        if hb_sum == bill_total[k] and (not x or x['hb_total'] == hb_sum * 1000):
            checks['hb_ok'] += 1
        else:
            checks['hb_bad'].append((k, hb_sum, bill_total[k], x and x['hb_total']))
        objs = dict(nep[na]) if na else {}
        if na:
            seen_nep.add(na)
            if sum(objs.values()) * 1000 == x['nep_total']:
                checks['nep_ok'] += 1
            else:
                checks['nep_bad'].append((k, sum(objs.values()), x['nep_total']))
        # expand each leaf to the NEP objects its prefixes cover
        exp = []
        for l in leaves:
            codes, how = mapping[(l['cls'], l['key'])]
            l['method'] = how + (f'; {l["note"]}' if l['note'] else '')
            l['targets'] = codes
            exp.append({o for o in objs if any(o.startswith(p) for p in codes)})
        # heading printed with an amount: an unclaimed NEP object of the same class with that amount
        claimed = set().union(*exp) if exp else set()
        for i, l in enumerate(leaves):
            if l['targets'] == () and l['method'].startswith('heading'):
                hits = [o for o in objs if o not in claimed and in_cls(o[:7], l['cls']) and objs[o] == l['thousands']]
                if len(hits) == 1:
                    exp[i] = {hits[0]}
                    claimed.add(hits[0])
                    l['method'] += f'; matched by amount to {hits[0]}'
        # split shared objects off a multi-object leaf when their own bill lines equal the NEP amount
        own = collections.defaultdict(list)
        for i, e in enumerate(exp):
            if len(e) == 1:
                own[next(iter(e))].append(i)
        for i, e in enumerate(exp):
            if len(e) > 1:
                keep = set()
                for o in e:
                    mine = [j for j in own.get(o, []) if j != i]
                    if mine and sum(leaves[j]['thousands'] for j in mine) == objs[o]:
                        continue
                    keep.add(o)
                if keep != e:
                    leaves[i]['method'] += f'; {len(e) - len(keep)} object(s) split off (own line equals NEP)'
                    exp[i] = keep
        # union-find over leaves and objects
        parent = {}

        def find(u):
            while parent.setdefault(u, u) != u:
                parent[u] = parent[parent[u]]
                u = parent[u]
            return u

        for i, e in enumerate(exp):
            find(('L', i))
            for o in e:
                parent[find(('O', o))] = find(('L', i))
        for o in objs:
            find(('O', o))
        groups = collections.defaultdict(lambda: ([], [], []))
        for u in list(parent):
            g = groups[find(u)]
            (g[0] if u[0] == 'L' else g[1]).append(u[1])
        groups = list(groups.values())
        # an NEP object no bill line claims, equal to the gap of a bill line in the same UACS group
        # (DepEd "Non-Permanent Positions" = casual/contractual + substitute teachers)
        for g in [g for g in groups if not g[0] and len(g[1]) == 1]:
            o = g[1][0]
            cands = [h for h in groups if h[0] and h is not g
                     and any(p[:5] == o[:5] for p in h[1] + [t for i in h[0] for t in leaves[i]['targets']])
                     and sum(leaves[i]['thousands'] for i in h[0]) - sum(objs[x] for x in h[1]) == objs[o]]
            if len(cands) == 1:
                cands[0][1].append(o)
                cands[0][2].append(f'NEP {o} folded in (equals the gap, same UACS group)')
                g[1].clear()
        for li, os_, notes in groups:
            if not li and not os_:
                continue
            li.sort(key=lambda i: (leaves[i]['pdf_page'] or 0, leaves[i]['line'] or 0))
            os_.sort()
            ls = [leaves[i] for i in li]
            hb_amt = sum(l['thousands'] for l in ls)
            nep_amt = sum(objs[o] for o in os_)
            cls = (ls[0]['cls'] if ls else os_[0][1:3].lstrip('0'))
            if not ls:
                status, how = 'NEP-only', 'no bill line maps to this object'
            elif not na:
                status = 'bill-only'
                how = 'agency not in NEP extract' + ('' if k[1] != 'UNPROGRAMMED APPROPRIATIONS' else ' (unprogrammed)')
            elif not os_ or nep_amt == 0:
                status, how = 'bill-only', '; '.join(dict.fromkeys(l['method'] for l in ls))
            else:
                status = 'same' if hb_amt == nep_amt else ('increased' if hb_amt > nep_amt else 'decreased')
                how = '; '.join(dict.fromkeys([l['method'] for l in ls] + notes))
            if not os_ and ls:
                tgt = sorted({p for l in ls for p in l['targets']})
                obj_cd, obj_dsc = ';'.join(tgt), obj_label(tgt) if tgt else ''
            else:
                obj_cd, obj_dsc = ';'.join(os_), obj_label(os_)
            grain = f'{len(ls)}:{len(os_)}'
            rows.append({
                'dept_no': k[0], 'department': k[1], 'agency_no': k[2], 'agency': k[3],
                'nep_sorder': na[0] if na else None, 'nep_dept': na[1] if na else None,
                'nep_agency': na[2] if na else None, 'nep_agency_dsc': nep_agy.get(na) if na else None,
                'uacs_exp_cd': cls, 'exp_class': CLS_NAME.get(cls),
                'hb_label': ' + '.join(l['label'] for l in ls),
                'hb_path': ' | '.join(l['path'] for l in ls),
                'hb_military': 'yes' if any(l['mup'] for l in ls) else '',
                'nep_obj_cd': obj_cd, 'nep_obj_dsc': obj_dsc, 'grain': grain,
                'nep_thousands': nep_amt, 'hb_thousands': hb_amt, 'delta_thousands': hb_amt - nep_amt,
                'status': status, 'match_method': how,
                'volume': ls[0]['vol'] if ls else None,
                'pdf_page': ';'.join(dict.fromkeys(str(l['pdf_page']) for l in ls)),
                'printed_page': ';'.join(dict.fromkeys(str(l['printed_page']) for l in ls)),
                'line': ';'.join(str(l['line']) for l in ls),
            })
    # NEP agencies the bill does not have
    for na, objs in nep.items():
        if na in seen_nep:
            continue
        for o, v in sorted(objs.items()):
            rows.append({'dept_no': None, 'department': None, 'agency_no': None, 'agency': None,
                         'nep_sorder': na[0], 'nep_dept': na[1], 'nep_agency': na[2], 'nep_agency_dsc': nep_agy[na],
                         'uacs_exp_cd': o[1:3].lstrip('0'), 'exp_class': CLS_NAME.get(o[1:3].lstrip('0')),
                         'hb_label': '', 'hb_path': '', 'hb_military': '', 'nep_obj_cd': o, 'nep_obj_dsc': obj_label([o]),
                         'grain': '0:1', 'nep_thousands': v, 'hb_thousands': 0, 'delta_thousands': -v,
                         'status': 'NEP-only', 'match_method': 'agency not in bill', 'volume': None,
                         'pdf_page': '', 'printed_page': '', 'line': ''})

    order = {k: i for i, k in enumerate(bill)}
    rows.sort(key=lambda r: (order.get((r['dept_no'], r['department'], r['agency_no'], r['agency']), len(order)),
                             r['nep_agency_dsc'] or '', r['nep_obj_cd'] or 'z', r['hb_path']))
    with open(out_csv, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # ------------------------------------------------------------------------ summary
    fmt = lambda v: f'{v:,}'
    n_map = sum(1 for k in bill if hb2nep[k])
    print(f'object tables: {len(tables)}; bill agencies {len(bill)}, {n_map} matched to an NEP agency; '
          f'NEP agencies {len(nep)}, {len(nep) - len(seen_nep)} not in the bill')
    print(f'check HB leaves = TOTAL NEW APPROPRIATIONS (and agency_map hb_total): {checks["hb_ok"]}/{len(bill)}')
    for b in checks['hb_bad']:
        print('  HB MISMATCH', b)
    print(f'check NEP fund-101 objects = agency_map nep_total (line-level universe): {checks["nep_ok"]}/{n_map}'
          + (f'; {bad_units} NEP groups not whole thousands' if bad_units else ''))
    for b in checks['nep_bad']:
        print('  NEP MISMATCH', b)
    tot_hb = sum(r['hb_thousands'] for r in rows)
    tot_nep = sum(r['nep_thousands'] for r in rows)
    print(f'totals (thousands): HB {fmt(tot_hb)}  NEP {fmt(tot_nep)}')
    one_side = [r for r in rows if r['dept_no'] is None or r['nep_agency'] is None]
    for (a, s_), v in sorted(collections.Counter(((r['agency'] or r['nep_agency_dsc']), 'bill only' if r['dept_no'] else 'NEP only')
                                                 for r in one_side).items()):
        h = sum(r['hb_thousands'] + r['nep_thousands'] for r in one_side if (r['agency'] or r['nep_agency_dsc']) == a)
        print(f'  agency {s_}: {a} ({v} objects, {fmt(h)})')
    cmp_rows = [r for r in rows if r not in one_side]
    c_hb = sum(r['hb_thousands'] for r in cmp_rows); c_nep = sum(r['nep_thousands'] for r in cmp_rows)
    both = [r for r in cmp_rows if r['status'] in ('same', 'increased', 'decreased')]
    same = [r for r in cmp_rows if r['status'] == 'same']
    print(f'agencies on both sides: HB {fmt(c_hb)}  NEP {fmt(c_nep)}; in matched units HB '
          f'{sum(r["hb_thousands"] for r in both) / c_hb:.2%}, NEP {sum(r["nep_thousands"] for r in both) / c_nep:.2%}; '
          f'"same": HB {sum(r["hb_thousands"] for r in same) / c_hb:.2%}, NEP {sum(r["nep_thousands"] for r in same) / c_nep:.2%}')
    g = collections.Counter(r['grain'] if r['grain'] == '1:1' else
                            ('1:n' if r['grain'].startswith('1:') else 'n:1' if r['grain'].endswith(':1') else 'n:m')
                            for r in both)
    print('grain of matched units (bill lines : NEP objects):', dict(g))
    print(f"{'status':10} {'rows':>6} {'HB thousands':>16} {'NEP thousands':>16} {'delta':>15}")
    st = collections.defaultdict(lambda: [0, 0, 0])
    for r in rows:
        s_ = st[r['status'] + (' *' if r in one_side else '')]
        s_[0] += 1; s_[1] += r['hb_thousands']; s_[2] += r['nep_thousands']
    for s_ in ('same', 'increased', 'decreased', 'bill-only', 'NEP-only', 'bill-only *', 'NEP-only *'):
        n, h, p = st[s_]
        if n:
            print(f'{s_:11} {n:6d} {h:16,d} {p:16,d} {h - p:15,d}')
    print('  (* agency on one side only)')
    print('by class (matched share of HB / NEP thousands):')
    for c in '1236':
        rc = [r for r in cmp_rows if r['uacs_exp_cd'] == c]
        h = sum(r['hb_thousands'] for r in rc); p = sum(r['nep_thousands'] for r in rc)
        hm = sum(r['hb_thousands'] for r in rc if r in both); pm = sum(r['nep_thousands'] for r in rc if r in both)
        print(f'  {CLS_NAME[c]:5} HB {h:15,d} ({hm / h if h else 0:.2%})  NEP {p:15,d} ({pm / p if p else 0:.2%})')
    meth = collections.defaultdict(lambda: [0, 0])
    for ck, (codes, how) in mapping.items():
        m = re.sub(r' \(.*|; .*| ".*"$| \d{7}.*', '', how)
        meth[m][0] += 1
        meth[m][1] += sum(by_key[ck].values())
    print('label mapping (distinct labels, HB thousands):', {m: (n, fmt(v)) for m, (n, v) in sorted(meth.items(), key=lambda kv: -kv[1][1])})
    for ck, (codes, how) in mapping.items():
        if not how.startswith(('name = NEP', 'name = UACS', 'sum evidence')):
            print(f'  {CLS_NAME.get(ck[0])} "{ck[1]}" -> {",".join(codes) or "-"}  [{how}]')
    print('15 biggest object-level changes (thousands; agencies on both sides):')
    for r in sorted((r for r in cmp_rows if r['status'] != 'same'), key=lambda r: -abs(r['delta_thousands']))[:15]:
        who = r['agency'] if r['agency'] == r['department'] else f"{r['department'][:22]} / {r['agency']}"
        print(f"  {r['delta_thousands']:+15,d}  {r['status']:9} {who[:44]:44} "
              f"{r['hb_label'][:34] or '-':34} NEP {r['nep_obj_cd'][:23]:23} {r['nep_thousands']:>13,d} -> {r['hb_thousands']:>13,d}"
              f"  vol {r['volume'] or '-'} p.{r['printed_page'] or '-'} (pdf {r['pdf_page'] or '-'})")


if __name__ == '__main__':
    main(*sys.argv[1:6])
