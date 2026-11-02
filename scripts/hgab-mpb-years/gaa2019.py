#!/usr/bin/env python3
"""The FY2019 DPWH project lines, read from DBM's technical GAA (TechGAA2019/DPWH/A.pdf, 1,527 pages).

The GAA history release (data/gaa-history) holds FY2019 DPWH at agency level only; its pipeline also keeps the PDF's
text (pdf_layout extraction, text/2019/32c79a9eba5fd2a5144e522c.txt), which lists every project. This reads that list.

Layout: a line opens with its 15-digit UACS code, the title runs over one or more lines, and the amounts end the last
line, three or more spaces after the text (the last figure is the line's total). A code ending in 000000000 heads a
PAP and prints its total; codes with 00000 in digits 8–12 head groups inside it ("Locally-Funded Project(s)"). Lines
without a code that end in amounts are region and office headings ("National Capital Region (NCR)", "Central Office");
in this edition every project group sits under the Central Office.

parse() returns the project lines, the printed PAP totals and a reconciliation: for every Operations PAP, the lines
under it against the total its heading prints.

Usage: gaa2019.py <text file>   (prints the reconciliation)
"""
from __future__ import annotations

import re
import sys

CODE = re.compile(r'^\s{0,8}(\d{15})(?:\s+(.*?))?\s*$')  # web-viewer pages indent the code
# Amounts end a line, set off from any text by three or more spaces (a title's own "1,500 meters" is not).
AMOUNTS = re.compile(r'(?:^|\s{3,})(P?\s*\d{1,3}(?:,\d{3})+(?:\s{2,}P?\s*\d{1,3}(?:,\d{3})+)*)\s*$')
NUMBER = re.compile(r'\d{1,3}(?:,\d{3})+')
NOISE = re.compile(r'^\s*(?:\d+\s+GENERAL APPROPRIATIONS ACT, FY 2019|DEPARTMENT OF PUBLIC WORKS AND HIGHWAYS\s+\d+|[¯\s]+)\s*$'
                   r'|eappro\.dbm\.gov\.ph|fileVersion=')
HEADING = re.compile(r'^\s{10,}([A-Z][^\d]*?)\s{3,}(P?\s*\d{1,3}(?:,\d{3})+)(?:\s{2,}P?\s*\d{1,3}(?:,\d{3})+)*\s*$')
OFFICE = re.compile(r'Office')
REGION = re.compile(r'Region|Cordillera|Muslim Mindanao|MIMAROPA|CALABARZON|CARAGA', re.IGNORECASE)
# One heading disagrees with the document's own summary table: 300200 (CONVERGENCE AND SPECIAL SUPPORT PROGRAM) prints
# ₱32,211,352,000 over its lines, the "New Appropriations, by Program" table ₱30,311,352,000. The lines equal the
# table: the heading counts its own ₱1,900,000,000 group twice. Checked against the table (text line 38).
SUMMARY_TABLE_TOTALS = {'300200': 30_311_352_000}
MAX_BLOCK = 60  # lines a title may run over before its amounts (road sections list many stations)


def is_heading_code(code: str) -> bool:
    return code[7:12] == '00000'


def parse(path: str):
    text = open(path, encoding='utf-8').read().splitlines()
    projects = []
    pap_totals = {}  # 6-digit PAP -> printed total
    pap_titles = {}
    region = office = None
    i, n = 0, len(text)
    while i < n:
        line = text[i]
        m = CODE.match(line)
        if not m:
            h = HEADING.match(line)
            if h:
                name = re.sub(r'\s+', ' ', h.group(1)).strip()
                if OFFICE.search(name):
                    office = name
                elif REGION.search(name):
                    region, office = name, None
            i += 1
            continue
        code = m.group(1)
        parts, amounts, j = [], None, i
        first = m.group(2) or ''
        while True:
            body = first if j == i else text[j]
            if j > i and NOISE.search(body):
                j += 1
                if j >= n or j - i > MAX_BLOCK or CODE.match(text[j]):
                    break
                continue
            a = AMOUNTS.search(body)
            head = body[:a.start()] if a else body
            if head.strip():
                parts.append(head.strip())
            if a:
                amounts = [int(x.replace(',', '')) for x in NUMBER.findall(a.group(1))]
                break
            j += 1
            if j >= n or j - i > MAX_BLOCK or CODE.match(text[j]):
                break
        title = re.sub(r'\s+', ' ', ' '.join(parts)).strip()
        if amounts is None:
            i = j if j < n and CODE.match(text[j]) else j + 1
            continue
        total = amounts[-1]
        if code[6:] == '000000000':
            pap_totals.setdefault(code[:6], total)
            pap_titles.setdefault(code[:6], title)
        elif not is_heading_code(code):
            projects.append({'code': code, 'title': title, 'php': total, 'region': region, 'office': office,
                             'line': i + 1})
        i = j + 1
    # One entry per code: the project list prints each once; keep the first and count repeats.
    seen, unique, repeats = set(), [], 0
    for p in projects:
        if p['code'] in seen:
            repeats += 1
            continue
        seen.add(p['code'])
        unique.append(p)
    # A heading's lines: those under its own code (a PAP such as 300104 or 300110), or under its code less trailing
    # zeros (a program such as 300100, LOCAL PROGRAM, over its PAPs). Either must equal what the heading prints.
    recon = {}
    for pap, tot in sorted(pap_totals.items()):
        tot = SUMMARY_TABLE_TOTALS.get(pap, tot)
        if not pap.startswith('3'):
            continue
        own = sum(p['php'] for p in unique if p['code'][:6] == pap)
        tree = sum(p['php'] for p in unique if p['code'].startswith(pap.rstrip('0')))
        recon[pap] = {'printed': tot, 'lines': own if own == tot else tree, 'ok': tot in (own, tree)}
    m = re.search(r'as indicated hereunder\.*\s*P\s*(\d{1,3}(?:,\d{3})+)', '\n'.join(text[:40]))
    department = int(m.group(1).replace(',', '')) if m else None
    return {'lines': unique, 'pap_totals': pap_totals, 'pap_titles': pap_titles, 'recon': recon, 'repeats': repeats,
            'department_total': department}


if __name__ == '__main__':
    r = parse(sys.argv[1])
    lines, recon = r['lines'], r['recon']
    total = sum(p['php'] for p in lines)
    bad = {k: v for k, v in recon.items() if not v['ok']}
    print(f"{len(lines):,} project lines, ₱{total:,}; the document's DPWH total ₱{r['department_total']:,}"
          f" ({'equal' if total == r['department_total'] else 'DIFFERENT'})")
    print(f"{r['repeats']} repeated codes")
    print(f'Operations headings: {len(recon)}; match {len(recon) - len(bad)}; differ {len(bad)}')
    for k, v in bad.items():
        print(f"  {k}: printed ₱{v['printed']:,}, lines ₱{v['lines']:,}")
