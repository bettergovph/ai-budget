/**
 * The 27-year GAA series (`gaa-explorer/series.json`): one national row per
 * fiscal year, FY2000–2026, and one row per department group, built from the
 * GAA Explorer manifest (`gaa-explorer/manifest.json`, which lists every
 * year's scopes and the groups in each) and the national index (which gives
 * the department ids and names the `/d/:id` pages use).
 *
 * `buildGaaSeries` is pure so `scripts/build-gaa-series.ts` and its test can
 * run it on any manifest. The browser only reads the output (see
 * `gaa-series-load.ts`).
 *
 * What the numbers are:
 *   - A department's figure is its NEW appropriations for the year: the
 *     `current_new_appropriations` scope (first preference in FY2003, the
 *     published department totals in FY2007–2008), and for FY2020–2026 the
 *     existing extract's group total, which is what the department pages show.
 *   - "Automatic Appropriations" (group 04) is the automatic scope's total in
 *     FY2002–2019 and the group of that name in FY2020–2026.
 *   - The national total is new + automatic when both are recorded; before
 *     FY2009 coverage is partial and some years record no automatic
 *     appropriations, so the total is null and `new_php` stands alone.
 *   - Reenacted years (2001, 2004, 2006) are null everywhere: no new GAA.
 *   - Special purpose funds, regions and other non-department groups are
 *     listed under `unmatched` so nothing is silently dropped.
 */
import type { GaaManifest, GaaScope } from './gaa-history';

export const SERIES_PATH = 'gaa-explorer/series.json';
export const SERIES_YEARS: readonly number[] = Array.from({ length: 27 }, (_, i) => 2000 + i);
export const AUTOMATIC_DEPT_ID = '04';

export interface NationalPoint {
  year: number;
  /** The manifest's coverage status for the year. */
  status: string;
  /** For a reenacted year, the budget it reenacts. */
  reenacts: number | null;
  new_php: number | null;
  automatic_php: number | null;
  unprogrammed_php: number | null;
  /** new + automatic, when both are recorded. */
  total_php: number | null;
  note: string | null;
}

export interface DeptSeries {
  id: string;
  description: string;
  /** Year → new appropriations in pesos; null when the year records none for this group. */
  years: Record<string, number | null>;
  /** Year → the manifest group name(s) the figure came from. */
  names: Record<string, string>;
}

export interface GaaSeries {
  schema_version: 1;
  generated_at: string;
  source: { manifest_sha256: string; manifest_rows: number };
  years: number[];
  /** Year → the manifest's coverage status. */
  statuses: Record<string, string>;
  national: NationalPoint[];
  departments: Record<string, DeptSeries>;
  /** Year → the new-appropriations groups no department claims (special purpose funds, regions, …). */
  unmatched: Record<string, { name: string | null; amount: number }[]>;
}

export interface IndexDept { id: string; description: string }

/** Uppercase, no trailing acronym, no trailing stray digits, single spaces. */
export function normalizeGroupName(name: string | null | undefined): string {
  return (name ?? '')
    .replace(/\.\s*$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Historical names that are not the department's current name. Everything
 * else matches the national index's own description once normalised.
 */
export const GROUP_ALIASES: Record<string, string> = {
  'DEPARTMENT OF EDUCATION, CULTURE AND SPORTS': '07',
  'DEPARTMENT OF TRANSPORTATION AND COMMUNICATIONS': '38',
  'DEPARTMENT OF ECONOMY, PLANNING, AND DEVELOPMENT': '24',
  'PRESIDENTIAL COMMUNICATIONS OPERATIONS OFFICE': '25',
  'OFFICE OF THE PRESS SECRETARY': '25',
};

/** The scope that carries the year's new appropriations, in order of preference. */
const NEW_SCOPES = [
  'current_new_appropriations',
  'published_new_appropriations',
  'current_new_appropriations_first_preference',
  'existing_gaa_extract_scope',
];

function scopeById(scopes: GaaScope[], id: string): GaaScope | undefined {
  return scopes.find((s) => s.id === id);
}

function newScope(scopes: GaaScope[]): GaaScope | undefined {
  for (const id of NEW_SCOPES) {
    const s = scopeById(scopes, id);
    if (s) return s;
  }
  return undefined;
}

export function buildGaaSeries(manifest: GaaManifest, depts: IndexDept[], generatedAt = new Date()): GaaSeries {
  const idByName = new Map<string, string>();
  for (const d of depts) idByName.set(normalizeGroupName(d.description), d.id);
  for (const [name, id] of Object.entries(GROUP_ALIASES)) idByName.set(name, id);

  const departments: Record<string, DeptSeries> = {};
  for (const d of depts) departments[d.id] = { id: d.id, description: d.description, years: {}, names: {} };

  const national: NationalPoint[] = [];
  const statuses: Record<string, string> = {};
  const unmatched: GaaSeries['unmatched'] = {};

  for (const year of SERIES_YEARS) {
    const cov = manifest.years.find((y) => y.year === year);
    if (!cov) throw new Error(`Manifest has no FY${year}`);
    statuses[year] = cov.status;
    const y = String(year);

    if (cov.status === 'reenacted_no_new_gaa' || cov.scopes.length === 0) {
      for (const d of Object.values(departments)) d.years[y] = null;
      national.push({
        year, status: cov.status, reenacts: cov.source_year ?? null,
        new_php: null, automatic_php: null, unprogrammed_php: null, total_php: null,
        note: cov.source_year ? `Reenacted FY${cov.source_year} budget: no new GAA was enacted.` : 'No new GAA was enacted.',
      });
      continue;
    }

    const ns = newScope(cov.scopes);
    if (!ns) throw new Error(`FY${year}: no new-appropriations scope`);
    const isExtract = ns.id === 'existing_gaa_extract_scope';
    const autoScope = scopeById(cov.scopes, 'automatic_appropriations');
    const unprog = scopeById(cov.scopes, 'unprogrammed_appropriations');

    // Department figures: every group in the new-appropriations scope that a department claims.
    const claimed = new Set<number>();
    ns.groups.forEach((g, i) => {
      const id = idByName.get(normalizeGroupName(g.name));
      if (!id || !departments[id]) return;
      claimed.add(i);
      const d = departments[id];
      d.years[y] = (d.years[y] ?? 0) + g.amount;
      d.names[y] = d.names[y] ? `${d.names[y]} + ${g.name}` : String(g.name);
    });
    // Automatic appropriations are their own scope before FY2020.
    const auto = departments[AUTOMATIC_DEPT_ID];
    if (auto && !isExtract) {
      auto.years[y] = autoScope ? autoScope.amount : null;
      if (autoScope) auto.names[y] = 'automatic_appropriations scope';
    }
    for (const d of Object.values(departments)) if (!(y in d.years)) d.years[y] = null;
    unmatched[y] = ns.groups.filter((_, i) => !claimed.has(i)).map((g) => ({ name: g.name, amount: g.amount }));

    // National row.
    const automaticAmount = isExtract ? (auto?.years[y] ?? null) : autoScope ? autoScope.amount : null;
    const newAmount = isExtract ? ns.amount - (automaticAmount ?? 0) : ns.amount;
    const total = isExtract ? ns.amount : automaticAmount == null ? null : newAmount + automaticAmount;
    const notes: string[] = [];
    if (ns.id === 'current_new_appropriations_first_preference') notes.push('First-preference schedule; the second preference is recorded separately.');
    if (ns.id === 'published_new_appropriations') notes.push('Published department totals only.');
    if (!isExtract && automaticAmount == null) notes.push('No automatic appropriations recorded for this year, so new appropriations stand alone.');
    if (cov.status === 'partial_historical_coverage') notes.push('Partial coverage: not comparable with later years.');
    if (cov.status === 'published_editions_differ') notes.push('Published editions differ; the selected technical edition is used.');
    national.push({
      year, status: cov.status, reenacts: null,
      new_php: newAmount, automatic_php: automaticAmount,
      unprogrammed_php: unprog ? unprog.amount : null,
      total_php: total, note: notes.length ? notes.join(' ') : null,
    });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    source: { manifest_sha256: manifest.sha256, manifest_rows: manifest.rows },
    years: [...SERIES_YEARS],
    statuses,
    national,
    departments,
    unmatched,
  };
}

/** The amount a chart plots for a national row: the total, or new appropriations alone when no total can be formed. */
export function nationalPlotAmount(p: NationalPoint): number | null {
  return p.total_php ?? p.new_php;
}
