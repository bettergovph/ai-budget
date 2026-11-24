/**
 * The schools directory API (`/schools` pages), over the D1 `schools_*` tables (docs/schools-data.md) and the field
 * reports in `school_reports` (scripts/schools/reports-schema.sql). Internal to the site, like the reviews API: not
 * part of the read-only, CORS-open /api/v1 yet.
 *
 *   GET    /api/schools/points               every school with usable 2022 coordinates, column-wise (cached)
 *   GET    /api/schools/list?q=&region=&division=&sector=&shortage=&projects=&sort=&page=
 *   GET    /api/schools/areas?level=region|division[&region=]   shortage vs SBP 2026 classrooms by area (cached)
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
  SCHOOL_ID_RE, SECTOR_OF, readSchoolReport,
  type AreaRow, type ListSort, type ReportTally, type SchoolProject, type ShortageFilter,
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

async function points(env: ReviewEnv): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT s.school_id AS id, c.longitude AS lon, c.latitude AS lat, sh.total_shortage AS shortage,
            COALESCE(r.project_classrooms_numeric_sum, 0) AS cr, s.sector AS sector
     FROM schools s
     JOIN schools_coordinates_2022 c ON c.school_id = s.school_id AND c.in_ph_bbox = 1
     LEFT JOIN schools_shortage_2023 sh ON sh.school_id = s.school_id
     LEFT JOIN schools_sbp_rollup_2026 r ON r.school_id = s.school_id`,
  ).all<{ id: string; lon: number; lat: number; shortage: number | null; cr: number; sector: string }>();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM schools").first<{ n: number }>();
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return reply({
    meta: { generated_at: new Date().toISOString(), schools: total?.n ?? 0, with_coordinates: results.length },
    rows: results.map((r) => [r.id, round(r.lon, 5), round(r.lat, 5), r.shortage == null ? null : round(r.shortage, 1), r.cr, SECTOR_OF[r.sector] ?? 0]),
  });
}

/** Per school: SBP 2026 classrooms with a budget and those for bidding, budget and project count (ID-linked only). */
const SBP_BY_SCHOOL = `SELECT school_id,
    COUNT(*) AS projects,
    SUM(CASE WHEN budget_php IS NOT NULL THEN COALESCE(classrooms, 0) ELSE 0 END) AS funded,
    SUM(CASE WHEN budget_php IS NULL THEN COALESCE(classrooms, 0) ELSE 0 END) AS bidding,
    SUM(COALESCE(budget_php, 0)) AS budget
  FROM schools_sbp_projects_2026 WHERE link_status = 'ID-linked' GROUP BY school_id`;

async function areas(env: ReviewEnv, url: URL): Promise<Response> {
  const level = url.searchParams.get("level") === "division" ? "division" : "region";
  const region = url.searchParams.get("region");
  const group = level === "division" ? "s.region_key, s.division" : "s.region_key";
  const where = region ? "WHERE s.region_key = ?1" : "";
  const { results } = await env.DB.prepare(
    `SELECT s.region_key, ${level === "division" ? "s.division" : "NULL"} AS division,
            COUNT(*) AS schools, COALESCE(SUM(s.sector = 'Public'), 0) AS public_schools,
            COUNT(sh.school_id) AS with_shortage_data, COALESCE(SUM(sh.total_shortage > 0), 0) AS schools_short,
            COALESCE(SUM(sh.total_shortage), 0) AS shortage,
            COALESCE(SUM(p.projects), 0) AS sbp_projects, COALESCE(SUM(p.funded), 0) AS sbp_classrooms_funded,
            COALESCE(SUM(p.bidding), 0) AS sbp_classrooms_bidding, COALESCE(SUM(p.budget), 0) AS sbp_budget_php,
            -- per school: what the list covers of its own shortage, what is left, and what goes to schools not short
            COALESCE(SUM(MIN(sh.total_shortage, COALESCE(p.funded, 0) + COALESCE(p.bidding, 0))), 0) AS covered,
            COALESCE(SUM(MAX(0, sh.total_shortage - COALESCE(p.funded, 0) - COALESCE(p.bidding, 0))), 0) AS gap,
            COALESCE(SUM(CASE WHEN sh.total_shortage = 0 THEN COALESCE(p.funded, 0) + COALESCE(p.bidding, 0) ELSE 0 END), 0) AS listed_not_short,
            COALESCE(SUM(CASE WHEN sh.school_id IS NULL THEN COALESCE(p.funded, 0) + COALESCE(p.bidding, 0) ELSE 0 END), 0) AS listed_no_data,
            AVG(c.latitude) AS lat, AVG(c.longitude) AS lon
     FROM schools s
     LEFT JOIN schools_shortage_2023 sh ON sh.school_id = s.school_id
     LEFT JOIN (${SBP_BY_SCHOOL}) p ON p.school_id = s.school_id
     LEFT JOIN schools_coordinates_2022 c ON c.school_id = s.school_id AND c.in_ph_bbox = 1
     ${where}
     GROUP BY ${group}
     ORDER BY shortage DESC`,
  ).bind(...(region ? [region] : [])).all<Omit<AreaRow, "reports" | "reports_confirming">>();
  // Reports by area: few rows, so tallied here rather than joined.
  const tally = new Map<string, { n: number; confirmed: number }>();
  try {
    const { results: rep } = await env.DB.prepare(
      `SELECT s.region_key, ${level === "division" ? "s.division" : "NULL"} AS division, COUNT(*) AS n, SUM(r.shortage = 'confirmed') AS confirmed
       FROM school_reports r JOIN schools s ON s.school_id = r.school_id WHERE r.withdrawn_at IS NULL GROUP BY ${group}`,
    ).all<{ region_key: string | null; division: string | null; n: number; confirmed: number }>();
    for (const r of rep ?? []) tally.set(`${r.region_key}|${r.division}`, { n: r.n, confirmed: r.confirmed ?? 0 });
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  const unplaced = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(classrooms), 0) AS cr FROM schools_sbp_projects_2026 WHERE school_in_registry = 0`,
  ).first<{ n: number; cr: number }>();
  return reply({
    meta: { generated_at: new Date().toISOString(), level, unplaced_projects: unplaced?.n ?? 0, unplaced_classrooms: unplaced?.cr ?? 0 },
    rows: results.map((r) => {
      const t = tally.get(`${r.region_key}|${r.division}`);
      return { ...r, reports: t?.n ?? 0, reports_confirming: t?.confirmed ?? 0 };
    }),
  });
}

const SORTS: Record<ListSort, string> = {
  shortage: "sh.total_shortage IS NULL, sh.total_shortage DESC, s.school_name",
  gap: "sh.total_shortage IS NULL, (COALESCE(sh.total_shortage, 0) - COALESCE(r.project_classrooms_numeric_sum, 0)) DESC, s.school_name",
  name: "s.school_name",
  enrolment: "e.enrolment_total IS NULL, e.enrolment_total DESC, s.school_name",
  reports: "reports DESC, sh.total_shortage DESC, s.school_name",
};

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
  const sector = p.get("sector");
  if (sector) where.push(`s.sector = ${bind(sector)}`);
  const shortage = (p.get("shortage") ?? "any") as ShortageFilter;
  if (shortage === "short") where.push("sh.total_shortage > 0");
  else if (shortage === "none") where.push("sh.total_shortage = 0");
  else if (shortage === "nodata") where.push("sh.school_id IS NULL");
  if (p.get("projects") === "yes") where.push("r.school_id IS NOT NULL");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM schools s
    LEFT JOIN schools_shortage_2023 sh ON sh.school_id = s.school_id
    LEFT JOIN schools_enrollment_2023 e ON e.school_id = s.school_id
    LEFT JOIN schools_sbp_rollup_2026 r ON r.school_id = s.school_id`;
  let hasReports = true;
  const reportsCol = "(SELECT COUNT(*) FROM school_reports x WHERE x.school_id = s.school_id AND x.withdrawn_at IS NULL)";
  const run = (withReports: boolean) => Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n ${from} ${whereSql}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT s.school_id, s.school_name, s.region_key, s.division, s.province, s.municipality, s.sector, s.curricular_offering,
              e.enrolment_total, s.instructional_classrooms, sh.total_shortage AS shortage,
              r.project_classrooms_numeric_sum AS sbp_classrooms, r.known_budget_sum_php AS sbp_budget_php,
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
    join_review: review.results, reports,
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
  const { report, problems } = readSchoolReport(raw);
  if (!report) return fail(422, "invalid", "Some answers need fixing.", { problems });
  const known = await env.DB.prepare("SELECT school_id FROM schools WHERE school_id = ?1").bind(report.school_id).first();
  if (!known) return fail(404, "not_found", "No school has this ID in the registry.");
  const ids = Object.keys(report.projects);
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT project_id FROM schools_sbp_projects_2026 WHERE project_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})
         AND (school_id = ?1 OR project_id IN (SELECT project_id FROM schools_sbp_candidates WHERE school_id = ?1))`,
    ).bind(report.school_id, ...ids).all<{ project_id: string }>();
    if (results.length !== ids.length) return fail(422, "invalid", "Some answers need fixing.", { problems: ["projects: not this school's"] });
  }
  const t = now();
  const member = await memberFor(env, who, t);
  if (member instanceof Response) return member;
  const prev = await env.DB.prepare("SELECT report_id, revision FROM school_reports WHERE school_id = ?1 AND member_id = ?2")
    .bind(report.school_id, member).first<{ report_id: string; revision: number }>();
  const id = prev?.report_id ?? reportId();
  const revision = (prev?.revision ?? 0) + 1;
  const payload = JSON.stringify({ ...report, report_id: id });
  try {
    await env.DB.batch([
      prev
        ? env.DB.prepare(
          `UPDATE school_reports SET revision = ?2, shortage = ?3, classrooms_needed = ?4, listing = ?5, payload = ?6, updated_at = ?7, withdrawn_at = NULL
           WHERE report_id = ?1 AND revision = ?8`,
        ).bind(id, revision, report.shortage, report.classrooms_needed, report.listing, payload, t, prev.revision)
        : env.DB.prepare(
          `INSERT INTO school_reports (report_id, school_id, member_id, revision, shortage, classrooms_needed, listing, payload, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
        ).bind(id, report.school_id, member, revision, report.shortage, report.classrooms_needed, report.listing, payload, t),
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
