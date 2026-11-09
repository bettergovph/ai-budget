"""Independent on-disk checks of published yearly files and consolidated output."""
import json
from pathlib import Path
import duckdb
import pyarrow.parquet as pq
from download import digest, save_json
from parse_objects import SCHEMA


def main():
    root=Path('data/gaa-history').resolve()
    c=duckdb.connect();c.execute("SET memory_limit='2GB'");c.execute('SET threads=4')
    c.execute(f"SET temp_directory='{root/'duckdb-tmp'}'")
    coverage=json.loads((root/'coverage.json').read_text())
    master=root/'gaa-2000-2026.parquet'
    assert pq.read_schema(master).equals(SCHEMA,check_metadata=False)
    checks=[]
    for record in coverage:
        year=record['year'];path=root/'parquet'/f'gaa-{year}.parquet'
        schema=pq.read_schema(path)
        assert schema.equals(SCHEMA,check_metadata=False),year
        assert schema.metadata[b'amount_unit']==b'PHP'
        sql='SELECT count(*),sum(amount),sum(hash(record_id,fy,amount,grain,budget_scope)) FROM read_parquet(?)'
        annual=c.execute(sql,[str(path)]).fetchone()
        combined=c.execute(sql+' WHERE fy=?',[str(master),year]).fetchone()
        assert annual==combined,(year,annual,combined)
        assert annual[0]==record['rows']
        if year in (2001,2004,2006):assert annual[:2]==(0,None)
        else:assert int(annual[1])==record['amount_pesos']
        if year>=2020:
            original=c.execute(sql,[str(root/'existing-parquet'/f'gaa-{year}.parquet')]).fetchone()
            assert original==annual,(year,'existing-year values changed')
        checks.append(dict(year=year,rows=annual[0],bytes=path.stat().st_size,sha256=digest(path)))
    assert c.execute('SELECT count(*)=count(DISTINCT record_id) FROM read_parquet(?)',[str(master)]).fetchone()[0]
    assert c.execute('SELECT count(*) FROM read_parquet(?) WHERE amount IS NULL OR record_id IS NULL OR budget_scope IS NULL OR grain IS NULL',[str(master)]).fetchone()[0]==0
    validation=json.loads((root/'quality/release-validation.json').read_text())
    assert digest(master)==validation['master_sha256']
    originals=[]
    paths=c.execute('SELECT DISTINCT source_member FROM read_parquet(?) ORDER BY 1',
        [str(root/'existing-parquet'/'gaa-*.parquet')]).fetchall()
    for (filename,) in paths:
        p=Path(filename)
        originals.append(dict(path=str(p.resolve()),bytes=p.stat().st_size,sha256=digest(p)))
    save_json(root/'quality/on-disk-validation.json',dict(status='passed',yearly_files=checks,
        master_bytes=master.stat().st_size,master_sha256=digest(master),existing_source_files=originals,
        assertions=['schema and units','yearly/master counts, peso sums and record fingerprints',
                    'reenactments empty rather than invented zero-budget facts','globally unique IDs',
                    'existing 2020–2026 monetary facts preserved','master checksum']))
    lines=['# Yearly dataset coverage','',
        '| Year | Rows | Coverage |','| --- | ---: | --- |']
    lines += [f"| {x['year']} | {x['rows']:,} | {x['status']} |" for x in coverage]
    (root/'coverage.md').write_text('\n'.join(lines)+'\n')
    print('Passed: 27 yearly schemas, consolidated equality, unique IDs, source hashes and existing-year preservation.')

if __name__=='__main__':main()
