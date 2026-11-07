"""Normalize the existing 2020–2026 extracts without altering their source files."""
import argparse
import json
from pathlib import Path

import duckdb

from download import save_json
from parse_objects import SCHEMA


def sql_string(value):
    return "'" + str(value).replace("'", "''") + "'"


def clean(column):
    return f"nullif(nullif(trim({column}), ''), 'nan')"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path("data/gaa-history"))
    p.add_argument("--data", type=Path, default=Path("data"))
    a = p.parse_args()
    root = a.root.resolve()
    out = root / "existing-parquet"
    out.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect()
    conn.execute("SET threads=4")
    conn.execute("SET memory_limit='2GB'")
    conn.execute(f"SET temp_directory={sql_string(root / 'duckdb-tmp')}")
    columns = dict(
        department_dsc="uacs_dpt_dsc", agency_code="agency", agency_dsc="uacs_agy_dsc",
        fpap_code="prexc_fpap_id", fpap_dsc="dsc", operunit_code="operunit",
        operunit_dsc="uacs_oper_dsc", div_code="uacs_operdiv_id", div_dsc="uacs_div_dsc",
        region_code="uacs_reg_id", fund_code="fundcd", fund_dsc="uacs_fundsubcat_dsc",
        expense_code="uacs_exp_cd", expense_dsc="uacs_exp_dsc",
        object_code="uacs_sobj_cd", object_dsc="uacs_sobj_dsc")
    projection = ",\n".join(f"{clean(src)} AS {dst}" for dst, src in columns.items())
    source = str(a.data.resolve() / "[0-9][0-9]/full_extract.csv")
    conn.execute(f"""
        CREATE TABLE raw AS SELECT
            CAST(year AS INTEGER) AS fy,
            {clean('department')} AS source_department_code,
            coalesce({clean('sorder')}, '1') AS section,
            CASE WHEN {clean('sorder')} = '2' THEN
                CASE {clean('department')} WHEN '01' THEN 'SPF' WHEN '04' THEN 'AUTO'
                    ELSE 'X' || {clean('department')} END
                ELSE {clean('department')} END AS department_id,
            {projection},
            TRY_CAST({clean('prexc_level')} AS INTEGER) AS prexc_level,
            CAST(replace({clean('amt')}, ',', '') AS DECIMAL(21,3)) AS amount_thousands,
            filename, id AS source_id
        FROM read_csv({sql_string(source)}, header=true, all_varchar=true,
                      union_by_name=true, filename=true)
        WHERE CAST(year AS INTEGER) BETWEEN 2020 AND 2026
    """)
    invalid = conn.execute("""SELECT count(*) FROM raw WHERE object_code IS NOT NULL
        AND (amount_thousands IS NULL OR amount_thousands * 1000 != trunc(amount_thousands * 1000))""").fetchone()[0]
    if invalid:
        raise ValueError(f"{invalid} monetary rows have missing or fractional-peso amounts")
    conn.execute("""CREATE TABLE headers AS
        SELECT fy, department_id, agency_code, fpap_code, max(fpap_dsc) AS fpap_dsc
        FROM raw WHERE object_code IS NULL AND fpap_code IS NOT NULL
        GROUP BY ALL""")
    joins = []
    for n in [6, 4, 2, 1]:
        joins.append(f"""LEFT JOIN headers h{n}
            ON h{n}.fy=r.fy AND h{n}.department_id=r.department_id
            AND h{n}.agency_code=r.agency_code
            AND h{n}.fpap_code=substr(r.fpap_code,1,{n}) || repeat('0',{15-n})""")
    conn.execute(f"""CREATE TABLE items AS SELECT r.*,
        coalesce(h6.fpap_code,h4.fpap_code,h2.fpap_code,h1.fpap_code) AS program_code,
        coalesce(h6.fpap_dsc,h4.fpap_dsc,h2.fpap_dsc,h1.fpap_dsc) AS program_dsc
        FROM raw r {' '.join(joins)} WHERE r.object_code IS NOT NULL""")
    if conn.execute("SELECT count(*) FROM items").fetchone()[0] != conn.execute(
            "SELECT count(*) FROM raw WHERE object_code IS NOT NULL").fetchone()[0]:
        raise ValueError("Hierarchy join changed monetary row count")
    exprs = {name: name for name in columns}
    exprs.update(fy="fy", department_id="department_id", prexc_level="prexc_level",
                 program_code="program_code", program_dsc="program_dsc",
                 major_class="""CASE substr(fpap_code,1,1)
                    WHEN '1' THEN 'General Administration and Support'
                    WHEN '2' THEN 'Support to Operations' WHEN '3' THEN 'Operations'
                    WHEN '4' THEN 'Special Purpose / Automatic' END""",
                 amount_thousands="CAST(amount_thousands AS DOUBLE)",
                 amount="CAST(amount_thousands * 1000 AS BIGINT)",
                 record_id="filename || ':' || source_id",
                 grain="'program_operunit_fund_expense_object'",
                 budget_scope="'existing_gaa_extract_scope'", source_year="fy",
                 budget_status="'enacted'", source_member="filename",
                 quality_status="'reconciled_to_existing_extract'")
    types = {"string": "VARCHAR", "int32": "INTEGER", "int64": "BIGINT", "double": "DOUBLE"}
    select = ",\n".join(f"CAST({exprs.get(f.name, 'NULL')} AS {types[str(f.type)]}) AS {f.name}" for f in SCHEMA)
    report = []
    for year in range(2020, 2027):
        target = out / f"gaa-{year}.parquet"
        tmp = target.with_suffix(".parquet.tmp")
        conn.execute(f"""COPY (SELECT {select} FROM items WHERE fy={year}
            ORDER BY department_id, agency_code, fpap_code)
            TO {sql_string(tmp)} (FORMAT PARQUET, COMPRESSION ZSTD)""")
        check = conn.execute(f"SELECT count(*),sum(amount) FROM read_parquet({sql_string(tmp)})").fetchone()
        original = conn.execute("SELECT count(*),sum(amount_thousands)*1000 FROM items WHERE fy=?", [year]).fetchone()
        if check != original:
            raise ValueError(f"{year}: exported counts or totals changed")
        tmp.replace(target)
        r = dict(year=year, rows=check[0], amount_pesos=int(check[1]), bytes=target.stat().st_size)
        report.append(r)
        print(json.dumps(r), flush=True)
    save_json(root / "quality/existing-2020-2026.json", report)


if __name__ == "__main__":
    main()
