#!/usr/bin/env python3
"""Flatten parsed HB 10858 tables into GAA-like line items and per-agency checks.

Line item grain (detail table "D"): agency x P/A/P path x region x operating unit
x [sub-unit] x [fund source] x expense class, amounts in pesos — the same shape as
the GAA/NEP extract rows aggregated over object codes.
"""
import csv, json, os, sys, collections

EXP = {'PS': ('1', 'Personnel Services'), 'MOOE': ('2', 'Maintenance and Other Operating Expenses'),
       'FinEx': ('3', 'Financial Expenses'), 'CO': ('6', 'Capital Outlays')}


def leaves(node, path):
    if not node['children']:
        yield path, node
        return
    for ch in node['children']:
        yield from leaves(ch, path + [ch])


def total_of(t):
    for x in reversed(t['totals']):
        if x['label'].upper().startswith('TOTAL NEW AP'):
            a = x['amounts']
            return a.get('thousands', 0) * 1000 if t['kind'] == 'O' else a.get('Total')
    return None


def agency_key(ctx):
    return (ctx['dept_no'], ctx['dept'], ctx['agency_no'], ctx['agency'])


def main(paths, out_csv, out_checks):
    tables = []
    for p in paths:
        tables += json.load(open(p))
    by_agency = collections.OrderedDict()
    for t in tables:
        by_agency.setdefault(agency_key(t['ctx']), []).append(t)
    rows = []
    checks = []
    for key, ts in by_agency.items():
        dept_no, dept, agy_no, agy = key
        kinds = collections.Counter(t['kind'] for t in ts)
        tot = {k: [total_of(t) for t in ts if t['kind'] == k] for k in ('S', 'D', 'O', 'P')}
        leaf_sum = 0
        has_d = any(t['kind'] == 'D' for t in ts)
        for t in ts:
            # the itemised table: "D" for agencies, the itemised "P" (by Purpose) for SPFs/ALGU/BSGC-others
            if not (t['kind'] == 'D' or (t['kind'] == 'P' and not has_d and t['tree']['children'])):
                continue
            for path, leaf in leaves(t['tree'], []):
                if leaf is t['tree']:
                    continue
                types = [n.get('type') for n in path]
                get = lambda ty: next((n['label'] for n in path if n.get('type') == ty), None)
                pap_nodes = [n for n in path if n.get('type') in ('SECTION', 'KIND', 'CLASS', 'PROGRAM', 'SUBPROGRAM', 'ACTIVITY')]
                for col, (code, name) in EXP.items():
                    amt = leaf['amounts'].get(col)
                    if not amt:
                        continue
                    leaf_sum += amt
                    rows.append({
                        'source': f"HB 10858 {os.environ.get('HB_READING', '3rd reading')}", 'volume': t['loc']['vol'],
                        'pdf_page': leaf.get('pdf_page'), 'printed_page': leaf.get('printed_page'), 'line': leaf.get('lineno'),
                        'dept_no': dept_no, 'department': dept, 'agency_no': agy_no, 'agency': agy or dept,
                        'section': get('SECTION'), 'project_kind': get('KIND'), 'class': get('CLASS'),
                        'program': get('PROGRAM'), 'subprogram': get('SUBPROGRAM'), 'activity': get('ACTIVITY'),
                        'pap_path': ' > '.join(n['label'] for n in pap_nodes),
                        'fund_source': get('FUND'), 'region': get('REGION'), 'operating_unit': get('OU'),
                        'sub_unit': get('SUBOU'), 'leaf_type': leaf.get('type'),
                        'uacs_exp_cd': code, 'uacs_exp_dsc': name, 'amount': amt,
                        'warn': '; '.join(leaf.get('warn', []) or []),
                    })
        chk = {'dept_no': dept_no, 'department': dept, 'agency_no': agy_no, 'agency': agy or dept,
               'tables': dict(kinds), 'S': tot['S'], 'D': tot['D'], 'O': tot['O'], 'P': tot['P'], 'D_leaf_sum': leaf_sum,
               'bad_tables': sum(1 for t in ts if t['bad'])}
        vals = [v for k in ('S', 'D', 'O', 'P') for v in tot[k] if v is not None] + ([leaf_sum] if (tot['D'] or tot['P']) else [])
        chk['consistent'] = len(set(vals)) <= 1
        checks.append(chk)
    with open(out_csv, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    json.dump(checks, open(out_checks, 'w'), indent=1)
    n_ok = sum(c['consistent'] for c in checks)
    print(f'{len(rows)} line items, {len(checks)} agencies, {n_ok} consistent across S/D/O/leaf sums')
    for c in checks:
        if not c['consistent']:
            print('  INCONSISTENT', c['dept_no'], c['agency_no'], (c['agency'] or '')[:45], c['tables'], 'S', c['S'], 'D', c['D'], 'O', c['O'], 'leaf', c['D_leaf_sum'])


if __name__ == '__main__':
    main(sys.argv[1:-2], sys.argv[-2], sys.argv[-1])
