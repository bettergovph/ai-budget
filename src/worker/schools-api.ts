/**
 * The schools directory API (`/schools` pages), over the D1 `schools_*` tables (docs/schools-data.md) and the field
 * reports in `school_reports` (scripts/schools/reports-schema.sql). Internal to the site, like the reviews API: not
 * part of the read-only, CORS-open /api/v1 yet.
 *
 *   GET    /api/schools/points               every school with usable 2022 coordinates, column-wise (cached)
 *   GET    /api/schools/list?q=&region=&division=&sector=&shortage=&projects=&sort=&page=
 *   GET    /api/schools/areas?level=region|division[&region=]   shortage vs SBP 2026 classrooms by area (cached)
 *   GET    /api/schools/analysis            by province: need, 2026 list, DPWH 2016-2026; DPWH by year and kind; BEFF (cached)
 *   GET    /api/schools/school/:id           one school: every source attached to it, its projects, the report tally
 *   GET    /api/schools/reports/mine?school= the signed-in member's report on a school
 *   POST   /api/schools/reports              send a report (one per member per school, kept editable)
 *   DELETE /api/schools/reports/:report_id   withdraw it (kept, and comes back if sent again)
 *
 * Sign-in is the project reviewer's (Clerk, `login` and `memberFor` in hgab-reviews.ts): the same members, so a
 * volunteer has one account for both. Reports are public only as a tally per school; no names, no emails. The
 * registry's school-head names are never sent.
 */
import { fail, login, memberFor, message, missingTable, reply, type ReviewEnv } from "./hgab-reviews";
import {
  BEFF_FPAP_ID, LEVEL_INDEX, SCHOOL_ID_RE, SECTOR_OF, readSchoolReport,
  type AnalysisFile, type AnalysisProvince, type ShortageLevel,
  type AreaRow, type DpwhProject, type Line2027, type ListSort, type ReportTally, type SchoolProject, type ShortageFilter,
} from "../lib/schools";

export const SCHOOLS_API = "/api/schools";
const MAX_BODY = 64 * 1024;
const PER = 50;
const CACHE_SECONDS = 3600;

async function cached(request: Request, ctx: ExecutionContext | undefined, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache || request.method !== "GET") return make();
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await make();
  if (res.ok) {
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    ctx?.waitUntil(cache.put(request, out.clone()));
    return out;
  }
  return res;
}

const LIVE_REPORTS = "FROM school_reports WHERE withdrawn_at IS NULL";

/** Per school: FY 2026 classrooms with a budget and those for bidding, budget, projects, modalities (ID-linked only). */
const SBP_BY_SCHOOL = `SELECT school_id,
    COUNT(*) AS projects,
    SUM(CASE WHEN budget_php IS NOT NULL THEN COALESCE(classrooms, 0) ELSE 0 END) AS funded,
    SUM(CASE WHEN budget_php IS NULL THEN COALESCE(classrooms, 0) ELSE 0 END) AS bidding,
    SUM(COALESCE(budget_php, 0)) AS budget,
    GROUP_CONCAT(DISTINCT modality) AS modalities
  FROM schools_sbp_projects_2026 WHERE link_status = 'ID-linked' GROUP BY school_id`;

/**
 * Per school: the FY 2027 DPWH lines that confidently name it (build_dpwh_links.py), in the NEP, in the House bill and
 * added by the House, with their amounts (a line naming n schools counts 1/n toward each).
 */
const Y27_BY_SCHOOL = `SELECT l.school_id,
    MAX(COALESCE(y.nep_php, 0) > 0) AS nep, MAX(COALESCE(y.house_php, 0) > 0) AS house, MAX(y.change = 'added') AS added,
    SUM(COALESCE(y.nep_php, 0) * 1.0 / MAX(y.schools_confident, 1)) AS nep_php,
    SUM(COALESCE(y.house_php, 0) * 1.0 / MAX(y.schools_confident, 1)) AS house_php
  FROM schools_2027_links l JOIN schools_2027_lines y ON y.line_id = l.line_id
  WHERE l.confident = 1 GROUP BY l.school_id`;

// EDCOM 2's terms, per school (lib/schools.ts statusOf / levelOf / shortageRate, which the pages use, say the same).
// Shortage is DepEd's SY 2023-2024 figure rounded to whole classrooms; `sh` is NULL for a school without one.
const SCHOOL_FROM = `FROM schools s
  LEFT JOIN schools_shortage_2023 sh ON sh.school_id = s.school_id
  LEFT JOIN (${SBP_BY_SCHOOL}) p ON p.school_id = s.school_id`;
const SHR = "ROUND(sh.total_shortage)";
const ALLOC = "(COALESCE(p.funded, 0) + COALESCE(p.bidding, 0))";
const STATUS = `(CASE WHEN sh.school_id IS NULL THEN 'no_data' WHEN ${ALLOC} = 0 AND ${SHR} = 0 THEN 'none'
  WHEN ${ALLOC} < ${SHR} THEN 'under' WHEN ${ALLOC} = ${SHR} THEN 'fully' ELSE 'over' END)`;
const RATE = `(CASE WHEN sh.school_id IS NULL OR s.instructional_classrooms IS NULL OR s.instructional_classrooms + ${SHR} = 0 THEN NULL
  ELSE ${SHR} * 1.0 / (s.instructional_classrooms + ${SHR}) END)`;
// Level by the Classroom Shortage Rate (lib/schools.ts levelOf): Moderate ≤ 20%, Severe ≤ 50%, Extreme above;
// a school short of classrooms without a classroom count is 'unrated'.
const LEVEL = `(CASE WHEN sh.school_id IS NULL THEN NULL WHEN ${SHR} = 0 THEN 'none' WHEN ${RATE} IS NULL THEN 'unrated'
  WHEN ${RATE} <= 0.2 THEN 'moderate' WHEN ${RATE} <= 0.5 THEN 'severe' ELSE 'extreme' END)`;
const z = (expr: string, as: string) => `COALESCE(${expr}, 0) AS ${as}`;
/** AreaTotals (lib/schools.ts) over the grouped schools. */
const TOTALS = [
  "COUNT(*) AS schools", z("SUM(s.sector = 'Public')", "public_schools"), "COUNT(sh.school_id) AS with_shortage_data",
  z(`SUM(${SHR} > 0)`, "schools_short"), z(`SUM(${SHR})`, "shortage"), z("SUM(p.projects)", "sbp_projects"),
  z(`SUM(${ALLOC})`, "allocated"), z("SUM(p.funded)", "sbp_classrooms_funded"), z("SUM(p.bidding)", "sbp_classrooms_bidding"),
  z("SUM(p.budget)", "sbp_budget_php"),
  z(`SUM(MIN(${SHR}, ${ALLOC}))`, "covered"), z(`SUM(MAX(0, ${SHR} - ${ALLOC}))`, "gap"),
  z(`SUM(CASE WHEN sh.school_id IS NOT NULL THEN MAX(0, ${ALLOC} - ${SHR}) END)`, "excess"),
  z(`SUM(CASE WHEN ${SHR} = 0 THEN ${ALLOC} END)`, "excess_no_shortage"),
  z(`SUM(CASE WHEN sh.school_id IS NOT NULL AND ${ALLOC} > ${SHR} THEN p.budget * 1.0 * (${ALLOC} - ${SHR}) / ${ALLOC} END)`, "excess_budget_php"),
  z(`SUM(CASE WHEN sh.school_id IS NULL THEN ${ALLOC} END)`, "allocated_no_data"),
  ...["under", "fully", "over"].map((k) => z(`SUM(${STATUS} = '${k}')`, `schools_${k}`)),
  ...["moderate", "severe", "extreme", "unrated"].map((k) => z(`SUM(${LEVEL} = '${k}')`, `schools_${k}`)),
  z("SUM(s.instructional_classrooms)", "instructional_classrooms"),
  z("SUM(CASE WHEN sh.school_id IS NOT NULL THEN s.instructional_classrooms END)", "instructional_with_data"),
].join(",\n  ");

async function points(env: ReviewEnv): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT s.school_id AS id, c.longitude AS lon, c.latitude AS lat, ${SHR} AS shortage, ${ALLOC} AS alloc, s.sector AS sector, ${LEVEL} AS level,
            COALESCE(y.nep, 0) + 2 * COALESCE(y.house, 0) + 4 * COALESCE(y.added, 0) AS y27
     ${SCHOOL_FROM}
     JOIN schools_coordinates_2022 c ON c.school_id = s.school_id AND c.in_ph_bbox = 1
     LEFT JOIN (${Y27_BY_SCHOOL}) y ON y.school_id = s.school_id`,
  ).all<{ id: string; lon: number; lat: number; shortage: number | null; alloc: number; sector: string; level: ShortageLevel | null; y27: number }>();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM schools").first<{ n: number }>();
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return reply({
    meta: { generated_at: new Date().toISOString(), schools: total?.n ?? 0, with_coordinates: results.length },
    rows: results.map((r) => [r.id, round(r.lon, 5), round(r.lat, 5), r.shortage, r.alloc, SECTOR_OF[r.sector] ?? 0, r.level ? LEVEL_INDEX[r.level] : -1, r.y27]),
  });
}

async function areas(env: ReviewEnv, url: URL): Promise<Response> {
  const lv = url.searchParams.get("level");
  const level = lv === "division" || lv === "lgu" ? lv : "region";
  const region = url.searchParams.get("region");
  const group = level === "division" ? "s.region_key, s.division" : level === "lgu" ? "s.region_key, s.province, s.municipality" : "s.region_key";
  const cols = level === "division" ? "s.division AS division"
    // Income class as the shortage file gives it per school; where a city's schools disagree ("1st Class City" vs
    // "1st Class Municipality"), MIN picks "City".
    : level === "lgu" ? "NULL AS division, s.province, s.municipality, MIN(sh.lgu_classification) AS income_class" : "NULL AS division";
  const where = region ? "WHERE s.region_key = ?1" : "";
  const { results } = await env.DB.prepare(
    `SELECT s.region_key, ${cols}, ${TOTALS}, AVG(c.latitude) AS lat, AVG(c.longitude) AS lon
     ${SCHOOL_FROM}
     LEFT JOIN schools_coordinates_2022 c ON c.school_id = s.school_id AND c.in_ph_bbox = 1
     ${where}
     GROUP BY ${group}
     ORDER BY gap DESC`,
  ).bind(...(region ? [region] : [])).all<Omit<AreaRow, "reports" | "reports_confirming">>();
  // Reports by area: few rows, so tallied here rather than joined.
  const keyOf = (r: { region_key: string | null; division?: string | null; province?: string | null; municipality?: string | null }) =>
    `${r.region_key}|${r.division ?? ""}|${r.province ?? ""}|${r.municipality ?? ""}`;
  const tally = new Map<string, { n: number; confirmed: number }>();
  try {
    const repCols = level === "division" ? "s.division" : level === "lgu" ? "NULL AS division, s.province, s.municipality" : "NULL AS division";
    const { results: rep } = await env.DB.prepare(
      `SELECT s.region_key, ${repCols}, COUNT(*) AS n, SUM(r.shortage = 'confirmed') AS confirmed
       FROM school_reports r JOIN schools s ON s.school_id = r.school_id WHERE r.withdrawn_at IS NULL GROUP BY ${group}`,
    ).all<{ region_key: string | null; division: string | null; province?: string; municipality?: string; n: number; confirmed: number }>();
    for (const r of rep ?? []) tally.set(keyOf(r), { n: r.n, confirmed: r.confirmed ?? 0 });
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  const unplaced = await env.DB.prepare(
    // ID-linked projects whose school is in no table here (0 since the shortage-list-only schools were added)
    `SELECT COUNT(*) AS n, COALESCE(SUM(classrooms), 0) AS cr FROM schools_sbp_projects_2026 WHERE school_id IS NOT NULL AND school_id NOT IN (SELECT school_id FROM schools)`,
  ).first<{ n: number; cr: number }>();
  return reply({
    meta: { generated_at: new Date().toISOString(), level, unplaced_projects: unplaced?.n ?? 0, unplaced_classrooms: unplaced?.cr ?? 0 },
    rows: results.map((r) => {
      const t = tally.get(keyOf(r));
      return { ...r, reports: t?.n ?? 0, reports_confirming: t?.confirmed ?? 0 };
    }),
  });
}

/** A DPWH school contract's kind, from its description (DPWH_KINDS in lib/schools.ts: repair, then mpb, then buildings). */
const has = (...words: string[]) => words.map((w) => `c.description LIKE '%${w}%'`).join(" OR ");
const DPWH_KIND = `CASE
  WHEN ${has("REPAIR", "REHAB", "RENOVAT", "RETROFIT", "IMPROVEMENT")} THEN 'repair'
  WHEN ${has("MULTI%PURPOSE", "MPB", "COVERED COURT", "GYM", "CANOPY", "GRANDSTAND", "SPORT")} THEN 'mpb'
  WHEN ${has("CLASSROOM", "SCHOOL BUILDING", "SCHOOL BLDG", "STOREY", "STY", "WORKSHOP", "WS)", "LABORATOR", "BUILDING")} THEN 'buildings'
  ELSE 'other' END`;
const CONFIDENT = "EXISTS (SELECT 1 FROM schools_dpwh_links x WHERE x.contract_id = c.contract_id AND x.confident = 1)";

async function analysis(env: ReviewEnv): Promise<Response> {
  const [provinces, years, funds, modality, beff, statusLevels, sizes, rates] = await Promise.all([
    env.DB.prepare(
      `SELECT s.province, s.region_key, ${TOTALS},
              ${z("SUM(CASE WHEN sh.school_id IS NOT NULL THEN e.enrolment_total END)", "learners_with_shortage")},
              ${z("SUM(e.enrolment_total)", "learners")}, ${z("SUM(e.instr_cr_total)", "classrooms")},
              ${z("SUM(COALESCE(e.makeshift_es, 0) + COALESCE(e.makeshift_hs, 0) + COALESCE(e.tls_es, 0) + COALESCE(e.tls_hs, 0))", "makeshift_tls")},
              ${z("SUM(d.contracts)", "dpwh_contracts")}, ${z("SUM(d.budget)", "dpwh_budget_php")},
              ${z("SUM(d.buildings)", "dpwh_buildings_php")}, ${z("SUM(d.mpb)", "dpwh_mpb_php")}
       ${SCHOOL_FROM}
       LEFT JOIN schools_enrollment_2023 e ON e.school_id = s.school_id
       LEFT JOIN (
         SELECT l.school_id, SUM(1.0 / MAX(c.schools_confident, 1)) AS contracts,
                SUM(COALESCE(c.budget_php, 0) / MAX(c.schools_confident, 1)) AS budget,
                SUM(CASE WHEN k.kind = 'buildings' THEN COALESCE(c.budget_php, 0) / MAX(c.schools_confident, 1) ELSE 0 END) AS buildings,
                SUM(CASE WHEN k.kind = 'mpb' THEN COALESCE(c.budget_php, 0) / MAX(c.schools_confident, 1) ELSE 0 END) AS mpb
         FROM schools_dpwh_links l
         JOIN schools_dpwh_contracts c ON c.contract_id = l.contract_id
         JOIN (SELECT c.contract_id, ${DPWH_KIND} AS kind FROM schools_dpwh_contracts c) k ON k.contract_id = c.contract_id
         WHERE l.confident = 1 GROUP BY l.school_id
       ) d ON d.school_id = s.school_id
       GROUP BY s.province, s.region_key`,
    ).all<AnalysisProvince>(),
    env.DB.prepare(
      `SELECT c.infra_year, ${DPWH_KIND} AS kind, COUNT(*) AS contracts, COALESCE(SUM(c.budget_php), 0) AS budget_php
       FROM schools_dpwh_contracts c WHERE c.infra_year IS NOT NULL AND ${CONFIDENT} GROUP BY 1, 2 ORDER BY 1`,
    ).all<AnalysisFile["dpwh_years"][number]>(),
    env.DB.prepare(
      `SELECT CASE WHEN c.source_of_funds LIKE '%BEFF%' THEN 'beff' ELSE 'dpwh' END AS fund, ${DPWH_KIND} AS kind,
              COUNT(*) AS contracts, COALESCE(SUM(c.budget_php), 0) AS budget_php
       FROM schools_dpwh_contracts c WHERE ${CONFIDENT} GROUP BY 1, 2`,
    ).all<AnalysisFile["dpwh_funds"][number]>(),
    env.DB.prepare(
      `SELECT COALESCE(modality, 'Not stated') AS modality, COUNT(*) AS projects, COALESCE(SUM(classrooms), 0) AS classrooms,
              COALESCE(SUM(budget_php), 0) AS budget_php,
              COALESCE(SUM(CASE WHEN budget_php IS NOT NULL THEN classrooms END), 0) AS classrooms_with_budget
       FROM schools_sbp_projects_2026 GROUP BY 1 ORDER BY classrooms DESC`,
    ).all<AnalysisFile["sbp_modality"][number]>(),
    env.DB.prepare(
      `SELECT amount_2020, amount_2021, amount_2022, amount_2023, amount_2024, amount_2025, amount_2026 FROM fpaps WHERE id = ?1`,
    ).bind(BEFF_FPAP_ID).first<Record<string, number | null>>(),
    // EDCOM 2's "Classroom Allocation Status by Shortage Level", in schools (and classrooms)
    env.DB.prepare(
      `SELECT ${LEVEL} AS level, ${STATUS} AS status, COUNT(*) AS schools, ${z(`SUM(${SHR})`, "shortage")}, ${z(`SUM(${ALLOC})`, "allocated")}
       ${SCHOOL_FROM} GROUP BY 1, 2`,
    ).all<AnalysisFile["status_levels"][number]>(),
    // How shortages are spread: schools by classrooms short, in steps of 10 (1–10, 11–20, … 91–100, over 100)
    env.DB.prepare(
      `SELECT CASE WHEN ${SHR} > 100 THEN 101 ELSE CAST((${SHR} - 1) / 10 AS INTEGER) * 10 + 1 END AS lo, COUNT(*) AS schools, SUM(${SHR}) AS shortage
       ${SCHOOL_FROM} WHERE ${SHR} >= 1 GROUP BY 1 ORDER BY 1`,
    ).all<AnalysisFile["shortage_sizes"][number]>(),
    // Schools short of classrooms by Classroom Shortage Rate, in tenths
    env.DB.prepare(
      // tenths closed at the top, (0, 10%], (10%, 20%] …, so they meet the levels' "up to 20%" and "up to 50%"
      `SELECT MAX(0, MIN(9, CAST(${RATE} * 10 AS INTEGER) - (${RATE} * 10 = CAST(${RATE} * 10 AS INTEGER)))) AS tenth, COUNT(*) AS schools ${SCHOOL_FROM}
       WHERE ${SHR} >= 1 AND ${RATE} IS NOT NULL GROUP BY 1 ORDER BY 1`,
    ).all<AnalysisFile["shortage_rates"][number]>(),
  ]);
  // GAA amounts are in thousands of pesos.
  const beff_gaa = beff
    ? [2020, 2021, 2022, 2023, 2024, 2025, 2026].flatMap((y) => (beff[`amount_${y}`] == null ? [] : [{ year: y, amount_php: (beff[`amount_${y}`] as number) * 1000 }]))
    : [];
  const out: AnalysisFile = {
    meta: { generated_at: new Date().toISOString() },
    provinces: provinces.results, dpwh_years: years.results, dpwh_funds: funds.results, sbp_modality: modality.results, beff_gaa,
    status_levels: statusLevels.results, shortage_sizes: sizes.results, shortage_rates: rates.results,
  };
  return reply(out);
}

const SORTS: Record<ListSort, string> = {
  shortage: `sh.school_id IS NULL, ${SHR} DESC, s.school_name`,
  gap: `sh.school_id IS NULL, MAX(0, ${SHR} - ${ALLOC}) DESC, ${SHR} DESC, s.school_name`,
  rate: `${RATE} IS NULL, ${RATE} DESC, ${SHR} DESC, s.school_name`,
  excess: `sh.school_id IS NULL, MAX(0, ${ALLOC} - ${SHR}) DESC, s.school_name`,
  name: "s.school_name",
  enrolment: "e.enrolment_total IS NULL, e.enrolment_total DESC, s.school_name",
  reports: `reports DESC, ${SHR} DESC, s.school_name`,
};
const STATUS_KEYS = new Set(["under", "fully", "over", "none", "no_data"]);
const LEVEL_KEYS = new Set(["none", "moderate", "severe", "extreme", "unrated"]);

async function list(env: ReviewEnv, url: URL): Promise<Response> {
  const p = url.searchParams;
  const sort = (p.get("sort") ?? "shortage") as ListSort;
  if (!(sort in SORTS)) return fail(400, "bad_sort", "Unknown sort.");
  const page = Math.max(1, Math.min(2000, Number.parseInt(p.get("page") ?? "1", 10) || 1));
  const where: string[] = [];
  const binds: (string | number)[] = [];
  const bind = (v: string | number) => { binds.push(v); return `?${binds.length}`; };
  const q = p.get("q")?.trim();
  if (q) {
    if (q.length > 80) return fail(400, "bad_query", "Search for at most 80 characters.");
    const like = bind(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(s.school_id = ${bind(q)} OR s.school_name LIKE ${like} ESCAPE '\\' OR s.municipality LIKE ${like} ESCAPE '\\')`);
  }
  const region = p.get("region");
  if (region) where.push(`s.region_key = ${bind(region)}`);
  const division = p.get("division");
  if (division) where.push(`s.division = ${bind(division)}`);
  const province = p.get("province");
  if (province) where.push(`s.province = ${bind(province)}`);
  const municipality = p.get("municipality");
  if (municipality) where.push(`s.municipality = ${bind(municipality)}`);
  const sector = p.get("sector");
  if (sector) where.push(`s.sector = ${bind(sector)}`);
  const shortage = (p.get("shortage") ?? "any") as ShortageFilter;
  if (shortage === "short") where.push(`${SHR} > 0`);
  else if (shortage === "none") where.push(`${SHR} = 0`);
  else if (shortage === "nodata") where.push("sh.school_id IS NULL");
  const status = p.get("status");
  if (status) {
    if (!STATUS_KEYS.has(status)) return fail(400, "bad_status", "Unknown allocation status.");
    where.push(`${STATUS} = ${bind(status)}`);
  }
  const level = p.get("level");
  if (level) {
    if (!LEVEL_KEYS.has(level)) return fail(400, "bad_level", "Unknown shortage level.");
    where.push(`${LEVEL} = ${bind(level)}`);
  }
  // Projects: the FY 2026 SBP allocation ("yes", as before), or FY 2027 DPWH lines in the NEP, the House bill, or added by the House.
  const projects = p.get("projects");
  if (projects === "yes" || projects === "sbp2026") where.push("p.school_id IS NOT NULL");
  else if (projects === "nep2027") where.push("y.nep = 1");
  else if (projects === "house2027") where.push("y.house = 1");
  else if (projects === "added2027") where.push("y.added = 1");
  else if (projects) return fail(400, "bad_projects", "Unknown project filter.");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `${SCHOOL_FROM}
    LEFT JOIN schools_enrollment_2023 e ON e.school_id = s.school_id
    LEFT JOIN (${Y27_BY_SCHOOL}) y ON y.school_id = s.school_id`;
  let hasReports = true;
  const reportsCol = "(SELECT COUNT(*) FROM school_reports x WHERE x.school_id = s.school_id AND x.withdrawn_at IS NULL)";
  const run = (withReports: boolean) => Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n ${from} ${whereSql}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT s.school_id, s.school_name, s.region_key, s.division, s.province, s.municipality, s.sector, s.curricular_offering, s.in_registry,
              e.enrolment_total, s.instructional_classrooms, ${SHR} AS shortage, ${ALLOC} AS allocated, ${STATUS} AS status,
              ${LEVEL} AS level, ${RATE} AS shortage_rate, p.modalities, p.budget AS sbp_budget_php,
              y.nep_php AS y27_nep_php, y.house_php AS y27_house_php, COALESCE(y.added, 0) AS y27_added,
              ${withReports ? reportsCol : "0"} AS reports
       ${from} ${whereSql} ORDER BY ${withReports || sort !== "reports" ? SORTS[sort] : SORTS.shortage} LIMIT ${PER} OFFSET ${(page - 1) * PER}`,
    ).bind(...binds).all(),
  ]);
  let total, rows;
  try {
    [total, rows] = await run(true);
  } catch (e) {
    if (!missingTable(e)) throw e;
    hasReports = false;
    [total, rows] = await run(false);
  }
  return reply({ meta: { total: total?.n ?? 0, page, per: PER, sort, reports: hasReports }, rows: rows.results });
}

async function tallyFor(env: ReviewEnv, schoolId: string): Promise<ReportTally> {
  const empty: ReportTally = { reports: 0, confirmed: 0, none: 0, unsure: 0, classrooms_needed_median: null, listing_issues: 0, last_report_at: null };
  try {
    const { results } = await env.DB.prepare(
      `SELECT shortage, classrooms_needed, listing, updated_at ${LIVE_REPORTS} AND school_id = ?1`,
    ).bind(schoolId).all<{ shortage: string | null; classrooms_needed: number | null; listing: string | null; updated_at: string }>();
    if (!results?.length) return empty;
    const needed = results.map((r) => r.classrooms_needed).filter((v): v is number => v != null).sort((a, b) => a - b);
    const mid = needed.length >> 1;
    return {
      reports: results.length,
      confirmed: results.filter((r) => r.shortage === "confirmed").length,
      none: results.filter((r) => r.shortage === "none").length,
      unsure: results.filter((r) => r.shortage === "unsure").length,
      classrooms_needed_median: needed.length ? (needed.length % 2 ? needed[mid] : (needed[mid - 1] + needed[mid]) / 2) : null,
      listing_issues: results.filter((r) => r.listing && r.listing !== "open").length,
      last_report_at: results.map((r) => r.updated_at).sort().at(-1) ?? null,
    };
  } catch (e) {
    if (!missingTable(e)) throw e;
    return empty;
  }
}

async function school(env: ReviewEnv, id: string): Promise<Response> {
  if (!SCHOOL_ID_RE.test(id)) return fail(400, "bad_id", "Not a School ID.");
  const one = (table: string) => env.DB.prepare(`SELECT * FROM ${table} WHERE school_id = ?1`).bind(id).first<Record<string, string | number | null>>();
  const [s, shortage, coordinates, facilities, enrollment, linked, candidate, review, reports] = await Promise.all([
    one("schools"), one("schools_shortage_2023"), one("schools_coordinates_2022"), one("schools_facilities_2023"), one("schools_enrollment_2023"),
    env.DB.prepare(`SELECT * FROM schools_sbp_projects_2026 WHERE school_id = ?1 ORDER BY project_id`).bind(id).all<SchoolProject>(),
    env.DB.prepare(
      `SELECT p.* FROM schools_sbp_candidates c JOIN schools_sbp_projects_2026 p ON p.project_id = c.project_id WHERE c.school_id = ?1 ORDER BY p.project_id`,
    ).bind(id).all<SchoolProject>(),
    env.DB.prepare(`SELECT source_sheet, join_outcome, fallback_method FROM schools_join_review WHERE primary_id = ?1 ORDER BY review_id`).bind(id).all(),
    tallyFor(env, id),
  ]);
  let y2027: Line2027[] = [];
  try {
    y2027 = (await env.DB.prepare(
      `SELECT y.line_id, y.title, y.office, y.nep_php, y.house_php, y.change, y.kind, y.nep_page, y.nep_doc, y.house_page, y.house_doc,
              y.schools_confident, l.match, l.confident, l.distance_m
       FROM schools_2027_links l JOIN schools_2027_lines y ON y.line_id = l.line_id
       WHERE l.school_id = ?1 ORDER BY l.confident DESC, COALESCE(y.house_php, y.nep_php) DESC`,
    ).bind(id).all<Line2027>()).results;
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  let dpwh: DpwhProject[] = [];
  try {
    dpwh = (await env.DB.prepare(
      `SELECT c.contract_id, c.description, c.category, c.status, c.progress, c.budget_php, c.amount_paid_php, c.contractor,
              c.start_date, c.completion_date, c.infra_year, c.program_name, c.source_of_funds, c.deo, c.schools_confident,
              l.match, l.confident, l.distance_m
       FROM schools_dpwh_links l JOIN schools_dpwh_contracts c ON c.contract_id = l.contract_id
       WHERE l.school_id = ?1 ORDER BY l.confident DESC, c.infra_year DESC, c.start_date DESC`,
    ).bind(id).all<DpwhProject>()).results;
  } catch (e) {
    if (!missingTable(e)) throw e; // the DPWH links not loaded into this D1 yet
  }
  if (!s) return fail(404, "not_found", "No school has this ID in the registry.");
  delete s.school_head_name;
  const pickProject = (p: SchoolProject, candidateOnly: boolean): SchoolProject => ({
    project_id: p.project_id, link_status: p.link_status, modality: p.modality, scope_of_work: p.scope_of_work,
    classrooms: p.classrooms, budget_php: p.budget_php, budget_status: p.budget_status, budget_allocation_raw: p.budget_allocation_raw,
    funding_source_raw: p.funding_source_raw, expected_start_raw: p.expected_start_raw, expected_end_raw: p.expected_end_raw,
    src_school_name: p.src_school_name, ...(candidateOnly ? { candidate: true } : {}),
  });
  return reply({
    school: s, shortage, coordinates, facilities, enrollment,
    projects: [...linked.results.map((p) => pickProject(p, false)), ...candidate.results.map((p) => pickProject(p, true))],
    dpwh, y2027, join_review: review.results, reports,
  });
}

const now = () => new Date().toISOString();
const reportId = () => `SR-${crypto.randomUUID()}`;

async function mine(request: Request, env: ReviewEnv, url: URL): Promise<Response> {
  const who = await login(request, env, url);
  if (who instanceof Response) return who;
  const member = await memberFor(env, who, now());
  if (member instanceof Response) return member;
  const id = url.searchParams.get("school") ?? "";
  if (!SCHOOL_ID_RE.test(id)) return fail(400, "bad_id", "Not a School ID.");
  const row = await env.DB.prepare(
    `SELECT report_id, payload, updated_at, withdrawn_at FROM school_reports WHERE school_id = ?1 AND member_id = ?2`,
  ).bind(id, member).first<{ report_id: string; payload: string; updated_at: string; withdrawn_at: string | null }>();
  return reply({ data: row && !row.withdrawn_at ? { ...JSON.parse(row.payload), report_id: row.report_id, updated_at: row.updated_at } : null });
}

async function send(request: Request, env: ReviewEnv, url: URL): Promise<Response> {
  const who = await login(request, env, url);
  if (who instanceof Response) return who;
  const body = await request.text();
  if (body.length > MAX_BODY) return fail(413, "too_large", "That report is too long.");
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return fail(400, "bad_json", "That isn't a report."); }
  // The school's recorded shortage decides whether the report disputes the data (then its details are required).
  const rawId = typeof (raw as { school_id?: unknown })?.school_id === "string" ? (raw as { school_id: string }).school_id : "";
  if (!SCHOOL_ID_RE.test(rawId)) return fail(422, "invalid", "Some answers need fixing.", { problems: ["school_id: missing"] });
  const known = await env.DB.prepare(
    "SELECT s.school_id, ROUND(sh.total_shortage) AS shortage FROM schools s LEFT JOIN schools_shortage_2023 sh ON sh.school_id = s.school_id WHERE s.school_id = ?1",
  ).bind(rawId).first<{ school_id: string; shortage: number | null }>();
  if (!known) return fail(404, "not_found", "No school has this ID in the registry.");
  const { report, problems } = readSchoolReport(raw, known.shortage);
  if (!report) return fail(422, "invalid", "Some answers need fixing.", { problems });
  // Every project answered must be this school's: a 2026 SBP project (linked or a candidate) or a linked DPWH contract.
  const keys = Object.keys(report.projects);
  const sbp = keys.filter((k) => !k.startsWith("dpwh:"));
  const contracts = keys.filter((k) => k.startsWith("dpwh:")).map((k) => k.slice(5));
  const theirs = async (sql: string, list: string[]) => list.length === 0 || (await env.DB.prepare(
    sql.replace("$IN", list.map((_, i) => `?${i + 2}`).join(",")),
  ).bind(report.school_id, ...list).all()).results.length === list.length;
  const ok = await theirs(
    `SELECT project_id FROM schools_sbp_projects_2026 WHERE project_id IN ($IN)
       AND (school_id = ?1 OR project_id IN (SELECT project_id FROM schools_sbp_candidates WHERE school_id = ?1))`, sbp,
  ) && await theirs(`SELECT contract_id FROM schools_dpwh_links WHERE school_id = ?1 AND contract_id IN ($IN)`, contracts);
  if (!ok) return fail(422, "invalid", "Some answers need fixing.", { problems: ["projects: not this school's"] });
  const t = now();
  const member = await memberFor(env, who, t);
  if (member instanceof Response) return member;
  const prev = await env.DB.prepare("SELECT report_id, revision FROM school_reports WHERE school_id = ?1 AND member_id = ?2")
    .bind(report.school_id, member).first<{ report_id: string; revision: number }>();
  const id = prev?.report_id ?? reportId();
  const revision = (prev?.revision ?? 0) + 1;
  const payload = JSON.stringify({ ...report, report_id: id });
  // The public tally reads the `shortage` column: needs more classrooms = 'confirmed', does not = 'none'.
  const shortageAnswer = report.needs === "yes" ? "confirmed" : report.needs === "no" ? "none" : report.needs === "unsure" ? "unsure" : null;
  try {
    await env.DB.batch([
      prev
        ? env.DB.prepare(
          `UPDATE school_reports SET revision = ?2, shortage = ?3, classrooms_needed = ?4, listing = ?5, payload = ?6, updated_at = ?7, withdrawn_at = NULL
           WHERE report_id = ?1 AND revision = ?8`,
        ).bind(id, revision, shortageAnswer, report.classrooms_needed, report.listing, payload, t, prev.revision)
        : env.DB.prepare(
          `INSERT INTO school_reports (report_id, school_id, member_id, revision, shortage, classrooms_needed, listing, payload, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
        ).bind(id, report.school_id, member, revision, shortageAnswer, report.classrooms_needed, report.listing, payload, t),
      env.DB.prepare("INSERT INTO school_report_revisions (report_id, revision, action, payload, created_at) VALUES (?1, ?2, 'save', ?3, ?4)")
        .bind(id, revision, payload, t),
    ]);
  } catch (e) {
    if (missingTable(e)) return fail(503, "reports_closed", "Field reports are not open yet.");
    if (/UNIQUE|PRIMARY KEY/i.test(message(e))) return fail(409, "conflict", "This report changed in another tab. Reload and try again.");
    throw e;
  }
  return reply({ data: { ...report, report_id: id, updated_at: t }, reports: await tallyFor(env, report.school_id) });
}

async function withdraw(request: Request, env: ReviewEnv, url: URL, id: string): Promise<Response> {
  const who = await login(request, env, url);
  if (who instanceof Response) return who;
  const t = now();
  const member = await memberFor(env, who, t);
  if (member instanceof Response) return member;
  const row = await env.DB.prepare("SELECT school_id, revision, withdrawn_at FROM school_reports WHERE report_id = ?1 AND member_id = ?2")
    .bind(id, member).first<{ school_id: string; revision: number; withdrawn_at: string | null }>();
  if (!row) return fail(404, "not_found", "You have no report with this id.");
  if (!row.withdrawn_at) {
    await env.DB.batch([
      env.DB.prepare("UPDATE school_reports SET withdrawn_at = ?2, revision = ?3, updated_at = ?2 WHERE report_id = ?1").bind(id, t, row.revision + 1),
      env.DB.prepare("INSERT INTO school_report_revisions (report_id, revision, action, payload, created_at) VALUES (?1, ?2, 'withdraw', NULL, ?3)")
        .bind(id, row.revision + 1, t),
    ]);
  }
  return reply({ data: { report_id: id, school_id: row.school_id }, reports: await tallyFor(env, row.school_id) });
}

export async function handleSchools(request: Request, env: ReviewEnv, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const path = url.pathname.slice(SCHOOLS_API.length).replace(/\/+$/, "");
  try {
    if (request.method === "GET") {
      if (path === "/points") return await cached(request, ctx, () => points(env));
      if (path === "/areas") return await cached(request, ctx, () => areas(env, url));
      if (path === "/analysis") return await cached(request, ctx, () => analysis(env));
      if (path === "/list") return await list(env, url);
      if (path === "/reports/mine") return await mine(request, env, url);
      const m = /^\/school\/([^/]+)$/.exec(path);
      if (m) return await school(env, decodeURIComponent(m[1]));
    }
    if (request.method === "POST" && path === "/reports") return await send(request, env, url);
    const w = /^\/reports\/(SR-[0-9a-f-]{36})$/.exec(path);
    if (request.method === "DELETE" && w) return await withdraw(request, env, url, w[1]);
    return fail(404, "not_found", "No such schools route.");
  } catch (e) {
    return fail(500, "query_failed", message(e));
  }
}
