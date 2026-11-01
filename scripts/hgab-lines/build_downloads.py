#!/usr/bin/env python3
"""The line-by-line dataset as public downloads: data/hgab/2027/explorer/downloads/.

Clean, documented copies of what the pipeline extracted, in integer pesos with plain column names:

  house-bill-2027-lines              every House bill line as published (3rd reading), CSV + Parquet
  house-bill-2027-lines-2nd-reading  the same for the 2nd reading, CSV
  house-bill-2027-reading-changes    the lines that differ between the two readings, CSV
  house-bill-2027-lines-vs-nep       each line beside its NEP line (DepEd schools from the annex), CSV + Parquet
  nep-2027-lines-not-in-house-bill   NEP lines no House bill line matched, CSV
  house-bill-2027-objects-vs-nep     objects of expenditure, each agency, against NEP objects, CSV + Parquet
  house-bill-2027-deped-schools      DepEd non-implementing secondary schools annex, CSV
  house-bill-2027-sbdp-barangays     barangays listed for the Barangay Development Program, CSV
  README.md                          what every file and column means
  manifest.json                      files, rows, bytes, SHA-256, totals, sources (the pages read this)
  house-bill-2027-line-by-line.zip   every CSV and the README in one file

Usage: build_downloads.py <lines_dir> <out_dir>
"""
import csv, datetime, hashlib, io, json, os, re, subprocess, sys, zipfile
import duckdb

EXP = {'1': 'Personnel services', '2': 'Maintenance and other operating expenses', '3': 'Financial expenses',
       '6': 'Capital outlays'}
VOL = {'1a': 'I-A', '1b': 'I-B'}
DOC_SHA = {'I-A': '79f56b8d57724634', 'I-B': '4cc0f17e472d1af3'}  # first 16 hex of the published PDFs' SHA-256
STATUS = {'same': 'same', 'increased': 'higher', 'decreased': 'lower', 'house_only_line': 'house_bill_only_line',
          'house_only_activity': 'house_bill_only_activity', 'agency_unmatched': 'agency_not_in_nep',
          'unprogrammed_not_in_nep_extract': 'unprogrammed'}
SCOPE = {'non-infra': 'whole_bill', 'infra: DPWH (workbench)': 'dpwh_projects', 'infra: NIA (workbench)': 'nia_irrigation',
         'infra: DA FMR (workbench)': 'farm_to_market_roads', 'infra: DOH HFEP (workbench)': 'health_facilities'}
REGION_NAME = {'13': 'National Capital Region (NCR)', '01': 'Region I - Ilocos', '14': 'Cordillera Administrative Region (CAR)',
               '02': 'Region II - Cagayan Valley', '03': 'Region III - Central Luzon', '04': 'Region IVA - CALABARZON',
               '17': 'Region IVB - MIMAROPA', '05': 'Region V - Bicol', '06': 'Region VI - Western Visayas',
               '18': 'Negros Island Region (NIR)', '07': 'Region VII - Central Visayas', '08': 'Region VIII - Eastern Visayas',
               '09': 'Region IX - Zamboanga Peninsula', '10': 'Region X - Northern Mindanao', '11': 'Region XI - Davao',
               '12': 'Region XII - SOCCSKSARGEN', '16': 'Region XIII - Caraga',
               '19': 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)', '00': 'Nationwide'}

# Column dictionary: README and manifest both read it.
COMMON = {
    'department_no': 'Department number in the House bill (Roman numeral).',
    'department': 'Department or fund, as the House bill names it.',
    'agency_no': 'Agency letter in the House bill (blank where the department is one agency).',
    'agency': 'Agency, as the House bill names it.',
    'section': 'REGULAR PROGRAMS, PROJECT(S) or PURPOSE(S), as published.',
    'project_kind': 'Locally-Funded or Foreign-Assisted Project(s), where published.',
    'class': 'General Administration and Support, Support to Operations or Operations.',
    'program': 'Program, as published.',
    'subprogram': 'Sub-program, as published.',
    'activity': 'Activity or project, as published.',
    'fund_source': 'Loan Proceeds or GOP Counterpart, for foreign-assisted projects that split them.',
    'region': 'Region, as published.',
    'operating_unit': 'Office (operating unit); for DepEd, the schools division.',
    'sub_unit': 'For DepEd, the school or the division office.',
    'expense_class_code': 'UACS expense class: 1, 2, 3 or 6.',
    'expense_class': 'Personnel services, maintenance and other operating expenses, financial expenses or capital outlays.',
    'volume': 'House bill volume the line is published in (I-A or I-B).',
    'pdf_page': 'Page of the PDF file.',
    'page': 'Page number shown on the page.',
    'line': 'Printed line number on the page (blank for the DepEd schools list).',
}
# The NEP page that prints a line (nep_pages.py), in the NEP volumes on R2 (hgab/2027/pdf/nep2027-vol-*.pdf).
NEP_PAGE_COLUMNS = {
    'nep_volume': 'NEP volume with the page (I, II-A, II-B or III); blank when no page was found.',
    'nep_pdf_page': 'Page of that NEP PDF file.',
    'nep_page': 'Page number shown on that NEP page (blank where the scan lost it).',
    'nep_page_holds': 'What that page prints: line (this line), division_office (a DepEd school inside its division '
                      'office’s line), division_list (where its division’s list begins), program_total (an activity '
                      'printed only inside its program’s total), activity_start (where the activity’s table begins), '
                      'activity_without_line (House-bill-only lines: the NEP’s table for the activity, without this line).',
}
NEP_VOL = {'nep2027-vol-i': 'I', 'nep2027-vol-iia': 'II-A', 'nep2027-vol-iib': 'II-B', 'nep2027-vol-iii': 'III'}
NEP_HOLDS = {'line': 'line', 'amount': 'line', 'division': 'division_office', 'division_list': 'division_list',
             'program': 'program_total', 'activity': 'activity_start', 'activity_table': 'activity_without_line'}


def nep_page_cols(r):
    if not r.get('nep_doc'):
        return {'nep_volume': '', 'nep_pdf_page': '', 'nep_page': '', 'nep_page_holds': ''}
    return {'nep_volume': NEP_VOL.get(r['nep_doc'], r['nep_doc']), 'nep_pdf_page': i(r['nep_pdf_page']),
            'nep_page': i(r['nep_printed_page']), 'nep_page_holds': NEP_HOLDS.get(r['nep_page_how'], r['nep_page_how'])}
FILES = {
    'house-bill-2027-lines': {
        'title': 'Every House bill line, third reading',
        'about': 'Each line of the appropriation tables by program, activity, project and purpose, as published, by expense class. DPWH’s project list (Vol. I-C) is not included.',
        'columns': {**COMMON, 'amount_php': 'Amount in pesos, as published.'},
    },
    'house-bill-2027-lines-2nd-reading': {
        'title': 'Every House bill line, second reading',
        'about': 'The same lines in the second-reading print, for comparing readings.',
        'columns': {**COMMON, 'amount_php': 'Amount in pesos, as published.'},
    },
    'house-bill-2027-reading-changes': {
        'title': 'Lines that differ between the second and third readings',
        'about': 'Every line whose amount or label changed between the two prints. All other lines are the same.',
        'columns': {
            'status': 'changed, relabel (same amount, new label), 2nd_only or 3rd_only.',
            'department': COMMON['department'], 'agency': COMMON['agency'],
            'path': 'Program > activity path in the third reading.', 'path_2nd_reading': 'The same in the second reading.',
            'region': COMMON['region'], 'operating_unit': COMMON['operating_unit'], 'sub_unit': COMMON['sub_unit'],
            'fund_source': COMMON['fund_source'], 'expense_class_code': COMMON['expense_class_code'],
            'amount_2nd_reading_php': 'Second reading, pesos.', 'amount_3rd_reading_php': 'Third reading, pesos.',
            'change_php': 'Third minus second reading.',
            'pdf_page_2nd_reading': 'PDF page in the second-reading volume.', 'pdf_page_3rd_reading': 'PDF page in the third-reading volume.',
            'volume': COMMON['volume'],
        },
    },
    'house-bill-2027-lines-vs-nep': {
        'title': 'Each House bill line beside its NEP line',
        'about': 'The line-by-line comparison behind the explorer. DepEd’s division offices are split into schools using the bill’s list of non-implementing schools. Matches are by name within each agency: candidates, not findings.',
        'columns': {
            **COMMON,
            'from_annex': 'yes when the row comes from the DepEd non-implementing schools list.',
            'scope': 'whole_bill, or the infrastructure program covered project by project elsewhere: dpwh_projects, farm_to_market_roads, health_facilities, nia_irrigation.',
            'nep_department_code': 'NEP department code.', 'nep_agency_code': 'NEP agency code.', 'nep_agency': 'NEP agency name.',
            'nep_prexc_fpap_id': 'NEP program, activity or project code(s) the line matched.',
            'nep_php': 'NEP amount, pesos (new appropriations).', 'house_bill_php': 'House bill amount, pesos.',
            'change_php': 'House bill minus the NEP.',
            'status': 'same, higher, lower, house_bill_only_line (activity found, place not), house_bill_only_activity (no NEP activity of that name), unprogrammed (not in the NEP data), agency_not_in_nep.',
            'activity_match': 'How the activity was matched: name, name at program level, fuzzy name, second-reading label, or unmatched.',
            'location_match': 'How the place was matched: exact, fuzzy office or school name, or division remainder.',
            **NEP_PAGE_COLUMNS,
        },
    },
    'nep-2027-lines-not-in-house-bill': {
        'title': 'NEP lines no House bill line matched',
        'about': 'NEP rows (new appropriations) that no House bill line claimed. Candidates: they may be renamed or moved, not removed.',
        'columns': {
            'nep_department_code': 'NEP department code.', 'nep_department': 'NEP department name.',
            'nep_agency_code': 'NEP agency code.', 'nep_agency': 'NEP agency name.',
            'nep_prexc_fpap_id': 'NEP program, activity or project code.', 'activity': 'NEP activity or project.',
            'region_code': 'NEP region code.', 'region': 'Region name.', 'division': 'DepEd schools division.',
            'operating_unit': 'NEP operating unit.', 'fund_kind': 'GOP (counterpart) or LOAN for foreign-assisted funds.',
            'expense_class_code': COMMON['expense_class_code'], 'nep_php': 'NEP amount, pesos.',
            **NEP_PAGE_COLUMNS,
        },
    },
    'house-bill-2027-objects-vs-nep': {
        'title': 'Objects of expenditure against NEP objects',
        'about': 'Each agency’s table by object of expenditure (published in thousands, given here in pesos) beside the NEP’s object codes. A row may join several House bill lines or NEP objects where the two documents group them differently.',
        'columns': {
            'department_no': COMMON['department_no'], 'department': COMMON['department'], 'agency_no': COMMON['agency_no'],
            'agency': COMMON['agency'], 'nep_department_code': 'NEP department code.', 'nep_agency_code': 'NEP agency code.',
            'expense_class_code': COMMON['expense_class_code'], 'house_bill_object': 'House bill object line(s).',
            'house_bill_object_path': 'Its headings in the House bill table.', 'military': 'yes for military and uniformed personnel lines.',
            'nep_object_codes': 'NEP UACS object code(s).', 'nep_objects': 'NEP object name(s).',
            'grain': 'Lines to objects: 1:1, 1:n, n:1 or n:m.', 'nep_php': 'NEP, pesos.', 'house_bill_php': 'House bill, pesos.',
            'change_php': 'House bill minus the NEP.', 'status': 'same, increased, decreased, bill-only or NEP-only.',
            'match_method': 'How the House bill line was tied to NEP object codes.',
            'volume': COMMON['volume'], 'pdf_page': 'Page(s) of the PDF file; several, separated by “;”, when the row joins several lines.',
            'page': 'Page number(s) shown on the page, likewise.', 'line': 'Printed line number(s), likewise.',
        },
    },
    'house-bill-2027-deped-schools': {
        'title': 'DepEd non-implementing secondary schools',
        'about': 'The House bill’s list (Vol. I-B) splitting each schools division office’s line into the office and its schools: junior high personnel and operating expenses, and senior high operating expenses.',
        'columns': {
            'level': 'region, division or school.', 'region': COMMON['region'], 'division': 'Schools division.',
            'school': 'School, or the division office itself.', 'junior_high_personnel_php': 'Junior high, personnel services, pesos.',
            'junior_high_operating_php': 'Junior high, maintenance and other operating expenses, pesos.',
            'junior_high_total_php': 'Junior high total, pesos.', 'senior_high_operating_php': 'Senior high, maintenance and other operating expenses, pesos.',
            'pdf_page': COMMON['pdf_page'], 'page': COMMON['page'],
        },
    },
    'house-bill-2027-sbdp-barangays': {
        'title': 'Barangays listed for the Barangay Development Program',
        'about': 'The 1,948 barangays cleared by NTF-ELCAC that share ₱9,740,000,000 of the Local Government Support Fund. The bill lists no amount per barangay.',
        'columns': {
            'no': 'Number in the list.', 'region': 'Region.', 'province': 'Province.', 'city_municipality': 'City or municipality.',
            'barangay': 'Barangay.', 'pdf_page': COMMON['pdf_page'], 'page': COMMON['page'],
        },
    },
}
PARQUET = {'house-bill-2027-lines', 'house-bill-2027-lines-vs-nep', 'house-bill-2027-objects-vs-nep'}
NOTICE = ('Independent and unofficial: our reading of the published documents, not an official record. '
          'Amounts are as published, not spending. Matches between the documents are candidates, not findings.')


def read(path):
    return list(csv.DictReader(open(path, encoding='utf-8-sig')))


def i(v):
    return int(v) if v not in ('', None) else ''


def line_rows(src):
    out = []
    for r in read(src):
        out.append({
            'department_no': r['dept_no'], 'department': r['department'], 'agency_no': r['agency_no'],
            'agency': r['agency'], 'section': r['section'], 'project_kind': r['project_kind'], 'class': r['class'],
            'program': r['program'], 'subprogram': r['subprogram'], 'activity': r['activity'],
            'fund_source': r['fund_source'], 'region': r['region'], 'operating_unit': r['operating_unit'],
            'sub_unit': r['sub_unit'], 'expense_class_code': r['uacs_exp_cd'], 'expense_class': EXP[r['uacs_exp_cd']],
            'amount_php': int(r['amount']), 'volume': VOL.get(r['volume'], r['volume']), 'pdf_page': i(r['pdf_page']),
            'page': i(r['printed_page']), 'line': i(r['line']),
        })
    return out


def write_csv(path, rows, cols):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main(lines_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    data = {}
    data['house-bill-2027-lines'] = line_rows(f'{lines_dir}/hb_line_items.csv')
    data['house-bill-2027-lines-2nd-reading'] = line_rows(f'{lines_dir}/reading2/hb_line_items.csv')

    data['house-bill-2027-reading-changes'] = [{
        'status': r['status'], 'department': r['department'], 'agency': r['agency'], 'path': r['pap_path'],
        'path_2nd_reading': r['pap_path_2nd'], 'region': r['region'], 'operating_unit': r['operating_unit'],
        'sub_unit': r['sub_unit'], 'fund_source': r['fund_source'], 'expense_class_code': r['uacs_exp_cd'],
        'amount_2nd_reading_php': i(r['amount_2nd']), 'amount_3rd_reading_php': i(r['amount_3rd']), 'change_php': i(r['delta']),
        'pdf_page_2nd_reading': i(r['pdf_page_2nd']), 'pdf_page_3rd_reading': i(r['pdf_page_3rd']),
        'volume': VOL.get(r['volume_3rd'] or r['volume_2nd'], r['volume_3rd'] or r['volume_2nd']),
    } for r in read(f'{lines_dir}/reading_changes.csv') if r['status'] != 'same']

    data['house-bill-2027-lines-vs-nep'] = [{
        **{k: v for k, v in line_rows_one(r).items() if k != 'amount_php'},
        'from_annex': 'yes' if r['leaf_type'] == 'ANNEX_SCHOOL' else 'no', 'scope': SCOPE[r['scope']],
        'nep_department_code': r['nep_dept'], 'nep_agency_code': r['nep_agency'], 'nep_agency': r['nep_agency_dsc'],
        'nep_prexc_fpap_id': r['nep_prexc_fpap_id'], 'nep_php': int(r['nep_amount']), 'house_bill_php': int(r['hb_amount']),
        'change_php': int(r['delta']), 'status': STATUS[r['status']], 'activity_match': r['activity_match'],
        'location_match': r['location_match'], **nep_page_cols(r),
    } for r in read(f'{lines_dir}/hb_vs_nep_lines.csv')]

    data['nep-2027-lines-not-in-house-bill'] = [{
        'nep_department_code': r['nep_dept'], 'nep_department': r['nep_dept_dsc'], 'nep_agency_code': r['nep_agency'],
        'nep_agency': r['nep_agency_dsc'], 'nep_prexc_fpap_id': r['nep_prexc_fpap_id'], 'activity': r['activity'],
        'region_code': r['uacs_reg_id'], 'region': REGION_NAME.get(r['uacs_reg_id'], ''), 'division': r['division'],
        'operating_unit': r['operating_unit'], 'fund_kind': r['fund_kind'], 'expense_class_code': r['uacs_exp_cd'],
        'nep_php': int(r['nep_amount']), **nep_page_cols(r),
    } for r in read(f'{lines_dir}/nep_only_lines.csv')]

    th = lambda v: int(v) * 1000 if v not in ('', None) else ''
    data['house-bill-2027-objects-vs-nep'] = [{
        'department_no': r['dept_no'], 'department': r['department'], 'agency_no': r['agency_no'], 'agency': r['agency'],
        'nep_department_code': r['nep_dept'], 'nep_agency_code': r['nep_agency'], 'expense_class_code': r['uacs_exp_cd'],
        'house_bill_object': r['hb_label'], 'house_bill_object_path': r['hb_path'],
        'military': 'yes' if r['hb_military'] in ('True', 'true', '1', 'yes') else 'no',
        'nep_object_codes': r['nep_obj_cd'], 'nep_objects': r['nep_obj_dsc'], 'grain': r['grain'],
        'nep_php': th(r['nep_thousands']), 'house_bill_php': th(r['hb_thousands']), 'change_php': th(r['delta_thousands']),
        'status': r['status'], 'match_method': r['match_method'],
        'volume': ';'.join(VOL.get(v, v) for v in r['volume'].split(';')) if r['volume'] else '',
        # a row joining several House bill lines lists each one's page, separated by ";"
        'pdf_page': r['pdf_page'], 'page': r['printed_page'], 'line': r['line'],
    } for r in read(f'{lines_dir}/object_compare.csv')]

    data['house-bill-2027-deped-schools'] = [{
        'level': r['level'], 'region': r['region'], 'division': r['division'], 'school': r['school'],
        'junior_high_personnel_php': int(r['jhs_ps']), 'junior_high_operating_php': int(r['jhs_mooe']),
        'junior_high_total_php': int(r['jhs_total']), 'senior_high_operating_php': int(r['shs_mooe']),
        'pdf_page': i(r['pdf_page']), 'page': i(r['printed_page']),
    } for r in read(f'{lines_dir}/deped_niu_schools.csv')]

    data['house-bill-2027-sbdp-barangays'] = [{
        'no': int(r['no']), 'region': r['region'], 'province': r['province'], 'city_municipality': r['city_municipality'],
        'barangay': r['barangay'], 'pdf_page': i(r['pdf_page']), 'page': i(r['printed_page']),
    } for r in read(f'{lines_dir}/sbdp_barangays.csv')]

    files = []
    con = duckdb.connect()
    for key, spec in FILES.items():
        rows = data[key]
        cols = list(spec['columns'])
        missing = [c for c in cols if rows and c not in rows[0]]
        assert not missing, (key, missing)
        csv_path = f'{out_dir}/{key}.csv'
        write_csv(csv_path, rows, cols)
        entry = {'key': key, 'title': spec['title'], 'about': spec['about'], 'rows': len(rows),
                 'csv': {'file': f'{key}.csv', 'bytes': os.path.getsize(csv_path), 'sha256': sha256(csv_path)}}
        if key in PARQUET:
            pq = f'{out_dir}/{key}.parquet'
            con.execute(f"copy (select * from read_csv('{csv_path}', header=true, all_varchar=false, sample_size=-1)) "
                        f"to '{pq}' (format parquet, compression zstd)")
            entry['parquet'] = {'file': f'{key}.parquet', 'bytes': os.path.getsize(pq), 'sha256': sha256(pq)}
        entry['columns'] = spec['columns']
        files.append(entry)

    lines = data['house-bill-2027-lines']
    vs = data['house-bill-2027-lines-vs-nep']
    nep_only = data['nep-2027-lines-not-in-house-bill']
    totals = {
        'house_bill_php': sum(r['amount_php'] for r in lines),
        'house_bill_unprogrammed_php': sum(r['amount_php'] for r in lines if r['department'] == 'UNPROGRAMMED APPROPRIATIONS'),
        'nep_php': sum(r['nep_php'] for r in vs) + sum(r['nep_php'] for r in nep_only),
        'lines': len(lines), 'lines_vs_nep': len(vs),
        'status': {s: sum(1 for r in vs if r['status'] == s) for s in sorted({r['status'] for r in vs})},
    }
    try:
        commit = subprocess.run(['git', 'rev-parse', '--short=12', 'HEAD'], capture_output=True, text=True,
                                cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip()
    except OSError:
        commit = ''
    built = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    readme = [
        '# House Bill 10858 (FY2027), line by line against the NEP', '',
        f'Built {built[:10]} by budget.bettergov.ph (pipeline `scripts/hgab-lines/`, commit {commit or "unknown"}).', '',
        NOTICE, '',
        '## Sources', '',
        '- House Bill 10858, General Appropriations Bill FY2027, third reading, Vols. I-A and I-B (Senate Budget Transparency Portal). '
        f'SHA-256 begins {DOC_SHA["I-A"]} (I-A) and {DOC_SHA["I-B"]} (I-B); copies at budget-assets.bettergov.ph/hgab/2027/pdf/.',
        '- The second reading, for the reading comparison.',
        '- The FY2027 NEP data from the Department of Budget and Management: new appropriations (fund 101).',
        '- The FY2027 NEP itself, Vols. I, II-A, II-B and III (machine-read scans), for the NEP page of each line; '
        'copies at budget-assets.bettergov.ph/hgab/2027/pdf/nep2027-vol-i.pdf, -vol-iia, -vol-iib and -vol-iii.', '',
        '## Totals', '',
        f'- House bill: ₱{totals["house_bill_php"]:,} in {totals["lines"]:,} lines, the total in the bill’s own Summary of New Appropriations.',
        f'- Without unprogrammed appropriations (₱{totals["house_bill_unprogrammed_php"]:,}): '
        f'₱{totals["house_bill_php"] - totals["house_bill_unprogrammed_php"]:,}, equal to the NEP’s new appropriations, ₱{totals["nep_php"]:,}.',
        '', '## Conventions', '',
        '- Amounts are integer pesos. An empty amount means the document has no such line, not zero.',
        '- Names are as published, including the documents’ own spelling.',
        '- Lines are matched by name within each agency, at the level the House bill lists (activity, region, office, school, fund source). A line with no match may be new, renamed or moved.',
        '- DPWH’s project list (Vol. I-C), farm-to-market roads, HFEP and NIA irrigation are compared project by project on their own pages; their lines here are tagged in `scope`.',
        '- Every line carries the page that prints it: in the House bill (`volume`, `pdf_page`, `page`, `line`) and in the NEP (`nep_volume`, `nep_pdf_page`, `nep_page`, `nep_page_holds`). Add `#page=` and the PDF page to a PDF address to open it there. NEP pages were found by matching each NEP line’s activity code, office and amount to the scan; `nep_page_holds` says when the page holds a line that contains this one instead.',
        '', '## Files', '',
    ]
    for e in files:
        readme += [f'### {e["csv"]["file"]}' + (f' (also {e["parquet"]["file"]})' if 'parquet' in e else ''), '',
                   f'{e["title"]}. {e["about"]} {e["rows"]:,} rows.', '', '| Column | Meaning |', '| --- | --- |']
        readme += [f'| `{c}` | {d} |' for c, d in e['columns'].items()]
        readme.append('')
    readme_path = f'{out_dir}/README.md'
    open(readme_path, 'w', encoding='utf-8').write('\n'.join(readme))

    zip_path = f'{out_dir}/house-bill-2027-line-by-line.zip'
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.write(readme_path, 'README.md')
        for e in files:
            z.write(f'{out_dir}/{e["csv"]["file"]}', e['csv']['file'])

    manifest = {
        'schema': 1, 'built_at': built, 'pipeline_commit': commit, 'notice': NOTICE, 'totals': totals,
        'readme': {'file': 'README.md', 'bytes': os.path.getsize(readme_path), 'sha256': sha256(readme_path)},
        'zip': {'file': os.path.basename(zip_path), 'bytes': os.path.getsize(zip_path), 'sha256': sha256(zip_path)},
        'files': files,
    }
    json.dump(manifest, open(f'{out_dir}/manifest.json', 'w'), indent=1, ensure_ascii=False)
    for e in files:
        print(f"{e['csv']['file']:48} {e['rows']:7,} rows {e['csv']['bytes'] / 1e6:6.1f} MB"
              + (f"  parquet {e['parquet']['bytes'] / 1e6:5.1f} MB" if 'parquet' in e else ''))
    print(f"zip {manifest['zip']['bytes'] / 1e6:.1f} MB; house bill ₱{totals['house_bill_php']:,}; NEP ₱{totals['nep_php']:,}")


def line_rows_one(r):
    return {
        'department_no': r['dept_no'], 'department': r['department'], 'agency_no': r['agency_no'], 'agency': r['agency'],
        'section': r['section'], 'project_kind': r['project_kind'], 'class': r['class'], 'program': r['program'],
        'subprogram': r['subprogram'], 'activity': r['activity'], 'fund_source': r['fund_source'], 'region': r['region'],
        'operating_unit': r['operating_unit'], 'sub_unit': r['sub_unit'], 'expense_class_code': r['uacs_exp_cd'],
        'expense_class': EXP[r['uacs_exp_cd']], 'amount_php': int(r['amount']), 'volume': VOL.get(r['volume'], r['volume']),
        'pdf_page': i(r['pdf_page']), 'page': i(r['printed_page']), 'line': i(r['line']),
    }


if __name__ == '__main__':
    main(*sys.argv[1:3])
