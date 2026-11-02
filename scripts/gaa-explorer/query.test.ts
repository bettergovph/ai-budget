import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { gaaRecordQuery } from '../../src/lib/gaa-history-query';

test('scope, literal search, null groups and pagination preserve source boundaries', async () => {
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  try {
    await conn.run(`CREATE TABLE facts AS SELECT
      i AS record_id, 1000-i AS amount,
      CASE WHEN i < 60 THEN 'new' ELSE 'unprogrammed' END AS budget_scope,
      CASE WHEN i % 2 = 0 THEN 'Agency group' ELSE NULL END AS department_dsc,
      'O''Brien agency' AS agency_dsc, 'program_total' AS grain,
      NULL::VARCHAR AS fpap_dsc, NULL::VARCHAR AS program_dsc,
      NULL::VARCHAR AS operunit_dsc, NULL::VARCHAR AS fund_dsc,
      NULL::VARCHAR AS expense_dsc, NULL::VARCHAR AS object_dsc,
      NULL::VARCHAR AS source_text FROM range(70) r(i)`);
    const execute = async (filter: Parameters<typeof gaaRecordQuery>[1]) => {
      const query = gaaRecordQuery('test.parquet', filter);
      const sql = query.sql.replace("read_parquet('test.parquet')", 'facts');
      return (await conn.runAndReadAll(sql, query.params)).getRowObjects();
    };
    const first = await execute({ scope: 'new', page: 1 });
    assert.equal(first.length, 50);
    assert.equal(Number(first[0].matched_rows), 60);
    const second = await execute({ scope: 'new', page: 2 });
    assert.equal(second.length, 10);
    assert.equal(Number(second[0].record_id), 50);
    assert.equal(
      (await execute({ scope: 'new', department: null, page: 1 })).length,
      30,
    );
    assert.equal(
      (
        await execute({
          scope: 'new',
          department: 'Agency group',
          search: "O'Brien",
          page: 1,
        })
      ).length,
      30,
    );
    assert.equal(
      (await execute({ scope: 'new', search: "%' OR 1=1 --", page: 1 })).length,
      0,
    );
    assert.equal(
      (await execute({ scope: 'unprogrammed', page: 1 })).length,
      10,
    );
    assert.equal(
      (await execute({ scope: 'new', grain: 'agency_total', page: 1 })).length,
      0,
    );
    assert.equal((await execute({ scope: 'new', page: -1 })).length, 50);
  } finally {
    conn.closeSync();
    db.closeSync();
  }
});

test('historical hierarchy preserves separate codes, null partitions, skipped levels and leaf amounts', async () => {
  const { historicalStatsQuery, historicalChildrenQuery, parseHistoricalBranch } = await import('../../src/lib/gaa-hierarchy-query');
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  try {
    await conn.run(`CREATE TABLE facts AS SELECT i AS record_id, amount,
      'new' AS budget_scope, 'Dept' AS department_dsc, code AS agency_code,
      CASE WHEN code IS NULL THEN NULL ELSE 'Same office name' END AS agency_dsc,
      NULL::VARCHAR AS fpap_code, NULL::VARCHAR AS program_code,
      NULL::VARCHAR AS fpap_dsc, NULL::VARCHAR AS program_dsc,
      NULL::VARCHAR AS operunit_code, NULL::VARCHAR AS operunit_dsc,
      NULL::VARCHAR AS fund_code, NULL::VARCHAR AS fund_dsc,
      '02' AS expense_code, 'MOOE' AS expense_dsc,
      NULL::VARCHAR AS object_code, NULL::VARCHAR AS object_dsc
      FROM (VALUES (1, 'A', 100), (2, 'B', 200), (3, NULL, 40), (4, 'A', 20)) t(i, code, amount)`);
    const execute = async (query: { sql: string; params: (string | number | null)[] }) =>
      (await conn.runAndReadAll(query.sql.replace("read_parquet('test.parquet')", 'facts'), query.params)).getRowObjects();
    const path = [{ level: 0, code: null, name: 'Dept' }];
    const groups = await execute(historicalChildrenQuery('test.parquet', 'new', path, 1));
    assert.equal(groups.length, 3);
    assert.equal(groups.reduce((s, r) => s + Number(r.amount), 0), 360);
    assert.equal(groups.filter(r => r.name === 'Same office name').length, 2);
    const agency = [...path, { level: 1, code: 'A', name: 'Same office name' }];
    const [stats] = await execute(historicalStatsQuery('test.parquet', 'new', agency));
    assert.equal(Number(stats.amount), 120);
    assert.equal(Number(stats.level_2), 0);
    assert.equal(Number(stats.level_3), 0);
    assert.equal(Number(stats.level_4), 0);
    assert.equal(Number(stats.level_5), 2);
    const leaf = [...agency, { level: 5, code: '02', name: 'MOOE' }];
    const records = await execute(gaaRecordQuery('test.parquet', { scope: 'new', branch: leaf, page: 1 }));
    assert.equal(records.length, 2);
    assert.equal(records.reduce((s, r) => s + Number(r.amount), 0), 120);
    const [missing] = await execute(historicalStatsQuery('test.parquet', 'new', [...path, { level: 1, code: null, name: null }]));
    assert.equal(Number(missing.amount), 40);
    assert.deepEqual(parseHistoricalBranch(JSON.stringify(leaf)), leaf);
    assert.throws(() => parseHistoricalBranch('[{"level":99,"code":null,"name":"x"}]'));
    assert.throws(() => parseHistoricalBranch(JSON.stringify([...leaf, ...path])));
    const [injection] = await execute(historicalStatsQuery('test.parquet', 'new', [{ level: 0, code: null, name: "Dept' OR 1=1 --" }]));
    assert.equal(Number(injection.records), 0);
  } finally { conn.closeSync(); db.closeSync(); }
});
