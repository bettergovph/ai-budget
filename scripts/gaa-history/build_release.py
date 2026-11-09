"""Build nonoverlapping yearly analysis baselines and the 2000–2026 union.

Detailed sources remain separate. Coverage and grain are explicit: missing
historical detail is never manufactured by expanding a published total.
"""
from collections import defaultdict
import hashlib
import json
import re
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from download import save_json
from parse_objects import SCHEMA
from reconcile_sources import normalize

ROOT = Path('data/gaa-history').resolve()
OUT = ROOT / 'parquet'
OUT.mkdir(exist_ok=True)
C = duckdb.connect()
C.execute("SET memory_limit='2GB'")
C.execute('SET threads=4')
C.execute(f"SET temp_directory='{ROOT / 'duckdb-tmp'}'")
C.create_function('normalized_name', normalize, ['VARCHAR'], 'VARCHAR')


def quote(s):
    return "'" + str(s).replace("'", "''") + "'"


def annotate(path, metadata):
    """Keep units and coverage available to consumers of a standalone file."""
    original=pq.ParquetFile(path)
    assert original.schema_arrow.names==SCHEMA.names
    assert [f.type for f in original.schema_arrow]==[f.type for f in SCHEMA]
    schema=SCHEMA.with_metadata({**(original.schema_arrow.metadata or {}),
        **{str(k).encode():str(v).encode() for k,v in metadata.items()}})
    temporary=path.with_suffix('.metadata.tmp')
    with pq.ParquetWriter(temporary,schema,compression='zstd') as writer:
        for batch in original.iter_batches(batch_size=131072):
            writer.write_batch(batch.cast(schema))
    original.close()
    temporary.replace(path)


def source(folder, year):
    return f"read_parquet({quote(ROOT / folder / f'gaa-{year}.parquet')})"


def doc(year, did):
    return next(d for d in json.loads((ROOT / f'documents-{year}.json').read_text()) if d['document_id'] == did)


def summary_fact(year, document, page, label, thousands, department=None, agency=None,
                 scope='current_new_appropriations', grain='fund_total', line=None, raw=None):
    row = {f.name: None for f in SCHEMA}
    key = f"{document['document_id']}:{page}:{label}:{scope}"
    row.update(fy=year, department_dsc=department or label, agency_dsc=agency,
        amount=thousands * 1000, amount_thousands=float(thousands),
        record_id=hashlib.sha256(key.encode()).hexdigest(), grain=grain, budget_scope=scope,
        source_year=year, budget_status='enacted', source_url=document['url'],
        source_member=document['member'], source_sha256=document['document_sha256'],
        source_document_id=document['document_id'], source_page=page, source_line=line,
        source_text=raw or f'{label}: {thousands:,} thousand pesos',
        source_section_id=key, quality_status='published_summary_visually_checked')
    return row


def supplementary(year, rows):
    path = ROOT / 'supplement-parquet' / f'gaa-{year}.parquet'
    path.parent.mkdir(exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA), path, compression='zstd')
    return f'SELECT * FROM read_parquet({quote(path)})'


def summary_annexes(year):
    report = json.loads((ROOT / f'quality/summary-{year}.json').read_text())
    assert not report['issues'], report['issues']
    d = doc(year, report['document_id'])
    rows = []
    for r in report['annexes']:
        if any(x in normalize(r['name']) for x in ('automatic appropriations', 'internal revenue allotment', 'interest payment')):
            label = r['name'].replace('N N E X E S A.', '').strip()
            rows.append(summary_fact(year, d, r['page'], label, r['pesos'] // 1000,
                scope='automatic_appropriations', line=r['line'], raw=r['raw']))
    return rows


def separate_unprogrammed(year):
    """Conditional schedules omitted from the consolidated machine files."""
    if year==2015:
        d=doc(year,'bfc1e62b2b3a0e63c0d070d1')
        assert d['document_sha256']==json.loads(Path(__file__).with_name('summary-unit-reviews.json').read_text())['2015']['source_sha256']
        rows=[summary_fact(year,d,11,'Unprogrammed Fund',123056081,scope='unprogrammed_appropriations')]
    else:
        d=next(x for x in json.loads((ROOT/'documents-2018.json').read_text()) if x['url'].endswith('/TechGAA/UF.pdf'))
        lines=(ROOT/d['text_path']).read_text().splitlines()
        authorization=next(int(re.search(r'P\s*([\d,]+)\s*$',s)[1].replace(',',''))
            for s in lines if s.strip().startswith('For fund requirements'))
        line_no,text=next((i+1,s) for i,s in enumerate(lines) if s.strip().startswith('TOTAL NEW APPROPRIATIONS'))
        amount=int(re.search(r'([\d,]+)\s*$',text)[1].replace(',',''))
        assert amount==authorization==75340000000
        rows=[summary_fact(year,d,1,'Unprogrammed Fund',amount//1000,scope='unprogrammed_appropriations',line=line_no,raw=text)]
        rows[0]['quality_status']='published_native_control_reconciled'
    return supplementary(year,rows)


def modern_2016():
    d = doc(2016, '773e52f833dcb0da2506eb49')
    assert d['document_sha256']==json.loads(Path(__file__).with_name('summary-unit-reviews.json').read_text())['2016']['source_sha256']
    # All values below were read directly from pages 8 and 10, not residuals.
    rows = [summary_fact(2016,d,8,'Joint Legislative-Executive Councils',2883,
        agency='Legislative-Executive Development Advisory Council',grain='agency_total')]
    rows.append(summary_fact(2016,d,10,'Budgetary Support to Government Corporations - Others',28606,
        department='Budgetary Support to Government Corporations',agency='Others',grain='agency_total'))
    children = [('Metropolitan Manila Development Authority',1959245),
        ('Special Shares of Local Government Units in the Proceeds of National Taxes',35917970),
        ("Barangay Officials Death Benefits",50000),('Local Government Support Fund',19076671),
        ('Special Shares of LGUs in the Proceeds of Fire Code Fees',200000)]
    assert sum(v for _,v in children) == 57203886
    rows.extend(summary_fact(2016,d,10,n,v,department='Allocations to Local Government Units',agency=n,
        grain='agency_total') for n,v in children)
    rows.extend([summary_fact(2016,d,10,'Automatic Appropriations',930695404,scope='automatic_appropriations'),
                 summary_fact(2016,d,10,'Unprogrammed Appropriations',67500000,scope='unprogrammed_appropriations')])
    return f"SELECT * FROM {source('spreadsheet-parquet',2016)} WHERE budget_scope='current_new_appropriations' UNION ALL " + supplementary(2016,rows)


def modern_2017():
    report = json.loads((ROOT / 'quality/summary-2017.json').read_text())
    assert not report['issues']
    # The three departments disagree with the published summary. Preserve
    # spreadsheet originals separately, and use reconciled summary partitions.
    replacements = ['department of agriculture','department of education','department of national defense']
    names = ','.join(map(quote,replacements))
    machine = source('spreadsheet-parquet',2017)
    summary = source('summary-parquet',2017)
    return (f"SELECT * FROM {machine} WHERE budget_scope='current_new_appropriations' "
            f"AND normalized_name(department_dsc) NOT IN ({names}) UNION ALL "
            f"SELECT * REPLACE ('current_new_appropriations' AS budget_scope) FROM {summary} "
            f"WHERE normalized_name(department_dsc) IN ({names}) UNION ALL "
            f"SELECT * FROM {machine} WHERE budget_scope='unprogrammed_appropriations' UNION ALL "
            + supplementary(2017,summary_annexes(2017)))


def modern_2019():
    d = doc(2019,'d0d307298d08d8c92aff9543')
    assert d['document_sha256']==json.loads(Path(__file__).with_name('summary-unit-reviews.json').read_text())['2019']['source_sha256']
    comparison=json.loads((ROOT/'quality/edition-comparison-2019.json').read_text())
    assert len([x for x in comparison['departments'] if x['technical_amount'] is not None])==37
    assert all(x['difference'] in (None,0) or 'PUBLIC WORKS' in x['department'] for x in comparison['departments'])
    rows = []  # BSGC-Others is already present in the technical object tables.
    rows.extend(summary_fact(2019,d,12,n,v) for n,v in [
        ('Contingent Fund',13000000),('Miscellaneous Personnel Benefits Fund',35529267),
        ('National Disaster Risk Reduction and Management Fund',20000000),('Pension and Gratuity Fund',117001503)])
    rows.extend([summary_fact(2019,d,12,'Unprogrammed Appropriations',197135780,scope='unprogrammed_appropriations'),
        summary_fact(2019,d,13,'Automatic Appropriations',1071536796,scope='automatic_appropriations')])
    return f"SELECT * FROM {source('candidate-parquet',2019)} UNION ALL " + supplementary(2019,rows)


def early(year):
    # Replace a printed control only with a reconciled program partition from
    # that exact source section. Different editions or names are not matched.
    totals = source('totals-parquet',year)
    programs = source('program-parquet',year)
    q = f"""WITH eligible AS (
        SELECT t.source_section_id FROM {totals} t JOIN
        (SELECT source_section_id,sum(amount) amount FROM {programs} GROUP BY 1) p
        USING(source_section_id) WHERE t.amount=p.amount)
        SELECT * FROM {totals} WHERE source_section_id NOT IN (SELECT * FROM eligible)
        UNION ALL SELECT * FROM {programs} WHERE source_section_id IN (SELECT * FROM eligible)"""
    if year==2002:
        # Annex A is outside the new-appropriation tables. Both the opening
        # authorization and the separately printed total must agree.
        d=doc(2002,'65fc6da33d9f1dc5692ba168')
        lines=(ROOT/d['text_path']).read_text().splitlines()
        authorization=next(int(re.search(r'P\s*([\d,]+)\s*$',s)[1].replace(',',''))
            for s in lines if s.strip().startswith('For payment of interest'))
        line_no,text=next((i+1,s) for i,s in enumerate(lines) if s.strip().startswith('TOTAL'))
        amount=int(re.search(r'([\d,]+)\s*$',text)[1].replace(',',''))
        assert authorization==amount==204267000000
        extra=supplementary(year,[summary_fact(year,d,1,'Debt Service - Interest Payment',amount//1000,
            scope='automatic_appropriations',line=line_no,raw=text)])
        q=f'SELECT * FROM ({q}) UNION ALL '+extra
    return q


def main():
    coverage=[]
    expected = {2015:2606000000000,2016:3001800000000,2017:3350000000000,
                2018:3767000000000,
                # Summary new - UF + automatic, replacing its DPWH amount
                # with the separately published technical-edition control.
                2019:(2882621534-197135780+1071536796-549390514+454016273)*1000}
    for year in range(2000,2027):
        notes=[]
        status='published_source_baseline'
        if year in (2001,2004,2006):
            table=pa.Table.from_pylist([],schema=SCHEMA.with_metadata({
                b'coverage':b'no new GAA; reenacted prior law, not zero appropriations',
                b'amount_unit':b'PHP',b'fy':str(year).encode(),
                b'coverage_status':b'reenacted_no_new_gaa',b'schema_version':b'gaa-history-baseline-v1'}))
            pq.write_table(table,OUT/f'gaa-{year}.parquet',compression='zstd')
            coverage.append(dict(year=year,status='reenacted_no_new_gaa',source_year={2001:2000,2004:2003,2006:2005}[year],rows=0,amount_pesos=None,notes=['Empty facts do not mean zero budget or spending.']))
            continue
        if year in (2000,2002,2003,2005):
            q=early(year)
            status='partial_historical_coverage'
            notes.append('Printed agency controls and reconciled program partitions; complete national coverage is not established. Automatic appropriations are incomplete.')
            notes.append('Historical published categories are retained: some new-appropriation tables include IRA or debt interest, unlike later years. These scopes are not a legal-authority crosswalk.')
            if year==2003: notes.append('First-preference and second-preference appropriations remain separate scopes. Do not sum them as interchangeable editions.')
        elif year in (2007,2008,2014):
            report=json.loads((ROOT/f'quality/summary-{year}.json').read_text())
            assert not report['issues']
            q=f"SELECT * FROM {source('summary-parquet',year)} UNION ALL " + supplementary(year,summary_annexes(year))
            notes.append('Published new-appropriation summary plus explicitly printed automatic annex totals. Agency totals have no invented program or object dimensions.')
            if year in (2007,2008):
                status='partial_historical_coverage'
                notes.append('Annexes list IRA and, for 2007, interest; full automatic coverage is not established.')
            else: notes.append('Scanned summary transcription reconciles all department and agency partitions; retained review status is visible on each row.')
        elif year in range(2009,2014) or year==2015:
            q=f"SELECT * FROM {source('csv-parquet',year)}"
            if year<2014: notes.append('Legacy CSV source categories retained; published new appropriations in 2009–2010 include debt interest. Organizational codes have no modern crosswalk.')
            else:
                q+=' UNION ALL '+separate_unprogrammed(year)
                notes.append('Consolidated CSV plus the separately published conditional Unprogrammed Fund total.')
        elif year==2016:
            q=modern_2016()
            notes.append('Detailed new appropriations supplemented by printed ALGU, JLEC and BSGC-Others. Full automatic summary replaces incomplete automatic spreadsheet detail.')
        elif year==2017:
            q=modern_2017()
            notes.append('DA, DepEd and DND use published agency summary partitions because spreadsheet totals differ. Full automatic summary replaces incomplete spreadsheet detail. Other departments retain object detail.')
        elif year==2018:
            q=f"SELECT * FROM {source('spreadsheet-parquet',year)} UNION ALL "+separate_unprogrammed(year)
            notes.append('Consolidated spreadsheet plus the separately published conditional Unprogrammed Fund total.')
        elif year==2019:
            q=modern_2019()
            status='published_editions_differ'
            notes.append('Agency-object tables plus four missing special-fund controls and automatic summary. DPWH technical-edition total is PHP454,016,273,000 versus PHP549,390,514,000 in the Volume I summary. The release retains the technical amount and records this edition difference; it does not silently balance to the older summary.')
        else:
            q=f"SELECT * FROM {source('existing-parquet',year)}"
            notes.append('Exact existing-extract monetary row count and total preserved; scope is the existing published extract, not reinterpreted.')
        C.execute('CREATE OR REPLACE TEMP TABLE annual AS '+q)
        # UF is conditional, never silently added to the programmed total.
        if year < 2020:
            C.execute("""UPDATE annual SET budget_scope='unprogrammed_appropriations'
              WHERE lower(coalesce(department_dsc,'')||' '||coalesce(agency_dsc,'')) LIKE '%unprogrammed%'""")
        stats=C.execute('SELECT count(*),sum(amount),count(distinct record_id) FROM annual').fetchone()
        assert stats[0]==stats[2],(year,'duplicate IDs',stats)
        assert C.execute('SELECT count(*) FROM annual WHERE amount IS NULL OR grain IS NULL OR budget_scope IS NULL OR fy!='+str(year)).fetchone()[0]==0
        scopes=dict(C.execute('SELECT budget_scope,cast(sum(amount) AS BIGINT) FROM annual GROUP BY 1').fetchall())
        programmed=sum(v for k,v in scopes.items() if k!='unprogrammed_appropriations')
        if year in expected: assert programmed==expected[year],(year,programmed,expected[year])
        if year>=2020:
            original=C.execute(f'SELECT count(*),sum(amount) FROM {source("existing-parquet",year)}').fetchone()
            assert stats[:2]==original
        path=OUT/f'gaa-{year}.parquet';tmp=path.with_suffix('.parquet.tmp')
        C.execute(f'COPY annual TO {quote(tmp)} (FORMAT PARQUET,COMPRESSION ZSTD)');tmp.replace(path)
        annotate(path,dict(amount_unit='PHP',fy=year,coverage_status=status,
            coverage_notes=' '.join(notes),schema_version='gaa-history-baseline-v1',
            source_archive='https://www.dbm.gov.ph/index.php/budget-documents-archives#gaa'))
        coverage.append(dict(year=year,status=status,rows=stats[0],amount_pesos=int(stats[1]),
            scopes=scopes,grains=dict(C.execute('SELECT grain,count(*) FROM annual GROUP BY 1').fetchall()),
            notes=notes,path=str(path.relative_to(ROOT))))
        print(year,stats[0],programmed,flush=True)
    target=ROOT/'gaa-2000-2026.parquet';tmp=target.with_suffix('.parquet.tmp')
    C.execute(f"COPY (SELECT * FROM read_parquet({quote(OUT/'gaa-*.parquet')})) TO {quote(tmp)} (FORMAT PARQUET,COMPRESSION ZSTD)")
    actual=C.execute(f'SELECT count(*),sum(amount),count(distinct record_id) FROM read_parquet({quote(tmp)})').fetchone()
    assert actual[0]==sum(x['rows'] for x in coverage)==actual[2]
    assert int(actual[1])==sum(x.get('amount_pesos') or 0 for x in coverage)
    tmp.replace(target)
    annotate(target,dict(amount_unit='PHP',year_span='2000-2026',
        schema_version='gaa-history-baseline-v1',coverage_file='coverage.json',
        coverage_notes='Mixed historical grain and coverage. Reenacted years have no new GAA facts. Read coverage.json before comparing years.'))
    save_json(ROOT/'coverage.json',coverage)
    pq.write_table(pa.Table.from_pylist([dict(year=x['year'],status=x['status'],rows=x['rows'],amount_pesos=x['amount_pesos'],notes=' '.join(x['notes'])) for x in coverage]),ROOT/'coverage.parquet',compression='zstd')
    save_json(ROOT/'quality/release-validation.json',dict(year_span=[2000,2026],yearly_files=27,rows=actual[0],
        amount_pesos=int(actual[1]),unique_record_ids=actual[2],schema=str(SCHEMA),
        warning='Amounts across scopes and years are not a single comparable national budget. Read coverage.json.',
        master_sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    print('Consolidated:',target,actual,flush=True)


if __name__=='__main__': main()
