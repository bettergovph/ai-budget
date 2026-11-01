#!/usr/bin/env python3
"""Load the FY2027 NEP extract into DuckDB (amounts in pesos) for compare.py.

Usage: build_nep_db.py <NEP-FY2027.csv> <out.duckdb>
"""
import sys
import duckdb

src, out = sys.argv[1], sys.argv[2]
con = duckdb.connect(out)
con.execute(f"""create or replace table nep as
    select *, try_cast(replace(AMT, ',', '') as bigint) * 1000 as pesos
    from read_csv('{src}', all_varchar=true)""")
n, total = con.execute('select count(*), sum(pesos) from nep').fetchone()
print(f'{n:,} NEP rows, P{total:,}')
