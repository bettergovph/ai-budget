import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveHref, buildGaaSeries, normalizeGroupName } from '../src/lib/gaa-series';
import type { GaaManifest, GaaCoverage } from '../src/lib/gaa-history';

const depts = [
  { id: '01', description: 'Congress of the Philippines (CONGRESS)' },
  { id: '04', description: 'Automatic Appropriations' },
  { id: '07', description: 'Department of Education (DepEd)' },
  { id: '25', description: 'Presidential Communications Office (PCO)' },
  { id: '38', description: 'Department of Transportation (DOTr)' },
];
const g = (name: string | null, amount: number) => ({ name, amount, rows: 1 });
const year = (y: number, partial: Partial<GaaCoverage>): GaaCoverage => ({
  year: y, status: 'published_source_baseline', rows: 1, notes: [], scopes: [], grains: {}, file: `gaa-${y}.parquet`, sha256: 'x', ...partial,
});
function manifest(): GaaManifest {
  const years: GaaCoverage[] = [];
  for (let y = 2000; y <= 2026; y++) {
    if (y === 2001 || y === 2004 || y === 2006) { years.push(year(y, { status: 'reenacted_no_new_gaa', rows: 0, source_year: y - 1 })); continue; }
    if (y === 2000) {
      years.push(year(y, { status: 'partial_historical_coverage', scopes: [
        { id: 'current_new_appropriations', amount: 130, rows: 3, groups: [g('DEPARTMENT OF EDUCATION, CULTURE AND SPORTS', 100), g('CONGRESS OF THE PHILIPPINES', 10), g('PRIORITY DEVELOPMENT ASSISTANCE FUND', 20)] },
      ] }));
      continue;
    }
    if (y === 2003) {
      years.push(year(y, { status: 'partial_historical_coverage', scopes: [
        { id: 'current_new_appropriations_first_preference', amount: 120, rows: 2, groups: [g('Department of Education', 110), g('Office of the Press Secretary', 10)] },
        { id: 'current_new_appropriations_second_preference', amount: 5, rows: 1, groups: [g('Department of Education', 5)] },
      ] }));
      continue;
    }
    if (y < 2020) {
      years.push(year(y, { scopes: [
        { id: 'current_new_appropriations', amount: 300, rows: 3, groups: [g('Department of Education (DepEd).', 200), g('Department of Transportation and Communications', 80), g('Presidential Communications Operations Office', 20)] },
        { id: 'automatic_appropriations', amount: 50, rows: 1, groups: [g('Debt service', 50)] },
        { id: 'unprogrammed_appropriations', amount: 7, rows: 1, groups: [g(null, 7)] },
      ] }));
      continue;
    }
    years.push(year(y, { scopes: [
      { id: 'existing_gaa_extract_scope', amount: 1000, rows: 4, groups: [g('Department of Education (DepEd)', 500), g('Automatic Appropriations', 300), g('New General Appropriations', 150), g('Congress of the Philippines (CONGRESS)', 50)] },
    ] }));
  }
  return { schema_version: 1, currency: 'PHP', rows: 1, download: 'all.parquet', sha256: 'abc', years };
}

test('group names normalise to the index description', () => {
  assert.equal(normalizeGroupName('Department of Agriculture (DA).'), 'DEPARTMENT OF AGRICULTURE');
  assert.equal(normalizeGroupName('ORGANIZATIONAL ADJUSTMENT FUND   1155'), 'ORGANIZATIONAL ADJUSTMENT FUND');
  assert.equal(normalizeGroupName('  The  Judiciary (JUD) '), 'THE JUDICIARY');
  assert.equal(normalizeGroupName(null), '');
});

test('departments get their new appropriations across every year, by current name or alias', () => {
  const s = buildGaaSeries(manifest(), depts, new Date('2026-11-04T00:00:00Z'));
  assert.equal(s.years.length, 27);
  const deped = s.departments['07'].years;
  assert.equal(deped['2000'], 100, 'DECS in 2000 is DepEd');
  assert.equal(deped['2001'], null, 'reenacted year is null');
  assert.equal(deped['2003'], 110, 'first preference only');
  assert.equal(deped['2010'], 200, 'trailing "(DepEd)." matches');
  assert.equal(deped['2026'], 500);
  assert.equal(s.departments['38'].years['2010'], 80, 'DOTC is DOTr');
  assert.equal(s.departments['25'].years['2003'], 10, 'OPS is PCO');
  assert.equal(s.departments['25'].years['2010'], 20, 'PCOO is PCO');
  assert.equal(s.departments['01'].years['2010'], null, 'no Congress group that year');
  assert.equal(s.departments['01'].years['2026'], 50);
});

test('automatic appropriations come from the scope before 2020 and the group from 2020', () => {
  const s = buildGaaSeries(manifest(), depts);
  assert.equal(s.departments['04'].years['2010'], 50);
  assert.equal(s.departments['04'].years['2000'], null, 'no automatic scope recorded');
  assert.equal(s.departments['04'].years['2026'], 300);
});

test('national rows: total is new + automatic, or null when no automatic is recorded', () => {
  const s = buildGaaSeries(manifest(), depts);
  const by = Object.fromEntries(s.national.map((p) => [p.year, p]));
  assert.deepEqual([by[2010].new_php, by[2010].automatic_php, by[2010].unprogrammed_php, by[2010].total_php], [300, 50, 7, 350]);
  assert.equal(by[2000].total_php, null);
  assert.equal(by[2000].new_php, 130);
  assert.match(by[2000].note ?? '', /new appropriations stand alone/);
  assert.match(by[2003].note ?? '', /First-preference/);
  assert.equal(by[2001].reenacts, 2000);
  assert.equal(by[2001].total_php, null);
  assert.deepEqual([by[2026].new_php, by[2026].automatic_php, by[2026].total_php], [700, 300, 1000]);
});

test('groups no department claims are listed, never dropped', () => {
  const s = buildGaaSeries(manifest(), depts);
  assert.deepEqual(s.unmatched['2000'], [{ name: 'PRIORITY DEVELOPMENT ASSISTANCE FUND', amount: 20 }]);
  assert.deepEqual(s.unmatched['2026'], [{ name: 'New General Appropriations', amount: 150 }]);
  assert.equal(s.unmatched['2001'], undefined);
});

test('every figure links to where it can be browsed', () => {
  const s = buildGaaSeries(manifest(), depts);
  assert.equal(archiveHref(s, '07', 2026), '/gaa/2026/07');
  assert.equal(archiveHref(s, '07', 2001), null, 'reenacted');
  assert.equal(archiveHref(s, '01', 2010), null, 'no group that year');
  assert.equal(archiveHref(s, '04', 2010), '/gaa/2010?scope=automatic_appropriations');
  const u = new URL('http://x' + archiveHref(s, '07', 2000));
  assert.equal(u.pathname, '/gaa/2000');
  assert.equal(u.searchParams.get('scope'), 'current_new_appropriations');
  assert.deepEqual(JSON.parse(u.searchParams.get('branch')!), [{ level: 0, code: null, name: 'DEPARTMENT OF EDUCATION, CULTURE AND SPORTS' }]);
  assert.equal(new URL('http://x' + archiveHref(s, '07', 2003)).searchParams.get('scope'), 'current_new_appropriations_first_preference');
  assert.deepEqual(s.departments['07'].names['2003'], ['Department of Education']);
});
