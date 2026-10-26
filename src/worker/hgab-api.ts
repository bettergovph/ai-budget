/**
 * FY2027 House General Appropriations Bill (HGAB) — public API data functions
 * (v1) and MCP tool backends.
 *
 * The `/hgab/2027` pages read static JSON and parquet from R2. A Worker cannot
 * read parquet, so this module reads the `hgab_*` D1 tables built from the
 * same files (`data/hgab/2027/d1-import.sql`; contract in docs/hgab-api.md).
 * Every amount, status and label is the one the pages show.
 *
 * Rules every function here follows:
 *   - amounts are integer pesos; null means "this version has no such line",
 *     never zero;
 *   - the NEP and the House bill are two versions of one budget: responses
 *     compare them and never add them; sums over a filtered set are per
 *     version, marked `not_additive_across_versions`;
 *   - pairings are candidates; the plain status labels are the pages' own
 *     (`TRACE_LABELS`), returned beside the raw `trace` code;
 *   - unconfirmed matches (`held`: fuzzy or ambiguous) are flagged on every
 *     row; bridge figures are the stored ones (they include them, so the six
 *     groups add up to `net_php`) with an `unconfirmed_rows` /
 *     `unconfirmed_php` breakdown per group; the "largest per group" lists
 *     leave them out;
 *   - district figures carry their tier; a shared (Tier B) office's money is
 *     never divided, and the unassigned residual comes with every district
 *     list and district page;
 *   - every response carries `meta` (with the disclaimer `notice`) and
 *     `disclaimers` (the pages' own paragraphs, from src/lib/hgab-disclaimers.ts:
 *     both on office-based views, the no-allegations one everywhere else);
 *     every row with a page on the site carries `url`, and every document
 *     page reference carries a `pdf_url` that opens the PDF at that page.
 *
 * The labels are imported from `src/lib` (the modules the pages use), so the
 * API and the pages cannot drift apart. Those modules are pure: nothing they
 * run at import time touches the DOM.
 */

import { ApiError } from "./public-api";
import {
  BRIDGE_LABELS, BRIDGE_ORDER, PLAIN_TERMS, READING_LABELS, REGION_LABELS, REGION_ORDER, STAGE_LABELS, traceInfo,
  type Bridge, type BridgeCell, type BridgeGroup, type DatasetKey, type DistrictCard, type DistrictRepresentative,
  type FiscalStage, type HgabDatasetMeta, type HgabDistrictIndex, type HgabDocument, type OfficeHistory,
  type RegionKey, type ResidualYear, type YearAmount,
} from "../lib/hgab";
import {
  apiPresenceInfo, controlHouseDoc, flagLabel, matchLabel, papLabel, splitFlags, zoneLabel,
} from "../lib/hgab-query";
import {
  ATTRIBUTION_LABELS, FISCAL_STAGE_LONG, FISCAL_STAGE_SCOPE, FISCAL_STAGE_SHORT, TIER_MEANING,
  cardFy27, cardOffices, cardRegionalGroups, coServedIds, officeKindText, officeParquetLabel, officeTierText,
  repName, residualShare, residualUnattributed, sortDistricts,
} from "../lib/hgab-districts";
import { RECON_STATUS_LABEL } from "../lib/hgab-ui";
import {
  COMPARISON_DISCLAIMERS, DEO_RESTRICTIONS_PATH, DEO_RESTRICTIONS_UPSTREAM_URL, DISCLAIMER_OFFICES,
  OFFICE_VIEW_DISCLAIMERS, type Disclaimer,
} from "../lib/hgab-disclaimers";

/** Canonical site host: every `url` points here. */
const SITE = "https://budget.bettergov.ph";
/** Public R2 host the source PDFs are served from. */
const ASSETS = "https://budget-assets.bettergov.ph";
const ROOT = `${SITE}/hgab/2027`;
const API = "/api/v1/hgab/2027";

export const HGAB_DATASET_KEYS = ["dpwh", "fmr", "hfep", "nia"] as const;
export const HGAB_BRIDGE_GROUPS: readonly BridgeGroup[] = BRIDGE_ORDER;
export const HGAB_HELD_MODES = ["all", "hide", "only"] as const;
export const HGAB_PROJECT_SORTS = ["house", "nep", "delta", "abs_delta", "title"] as const;
export const HGAB_ORDERS = ["desc", "asc"] as const;
export const HGAB_ZONES = ["local", "fap"] as const;
export const HGAB_ATTRIBUTIONS = ["A", "B", "mixed", "none"] as const;
export const HGAB_DISTRICT_SORTS = ["hgab3", "gaa2026", "change", "name"] as const;
export const HGAB_RECON_STATUSES = ["exact", "explained", "mismatch", "info"] as const;
export const HGAB_REGION_KEYS: readonly RegionKey[] = REGION_ORDER;

type ProjectSort = (typeof HGAB_PROJECT_SORTS)[number];
type DistrictSort = (typeof HGAB_DISTRICT_SORTS)[number];

/** Max words in a `q` search. */
const MAX_WORDS = 12;

// ---------------------------------------------------------------------------
// Shared wording (the docs page, OpenAPI and MCP tool descriptions say the same)
// ---------------------------------------------------------------------------

export const HGAB_BRIDGE_NOTE =
  "Bridge figures are the stored ones the pages show: they include unconfirmed matches (fuzzy or ambiguous " +
  "pairings, counted under 'In the House bill only'), so the six groups add up to net_php. Each group's " +
  "unconfirmed_rows / unconfirmed_php is the unconfirmed part of it (non-zero only on DPWH house_only). " +
  "php is the group's money basis: the House amount for house_only and unchanged, the NEP amount for " +
  "nep_only, the size of the movement for increased and decreased, and the signed net for scope_review.";

export const HGAB_TOP_NOTE =
  "The 10 largest rows in each group by that group's money basis, unconfirmed matches left out (held = 0).";

const COMPARE_RULE =
  "The NEP and the House bill are two versions of one budget: compare them, never add them.";

const RULES: string[] = [
  "Amounts are integer pesos. null means the version has no such line, never zero.",
  `${COMPARE_RULE} Sums over a filtered set are given per version and marked not_additive_across_versions.`,
  "Pairings are candidates: leads for checking, not confirmed changes. A line found in one version only is an " +
    "insertion candidate (House bill only) or a deletion candidate (NEP only), never a confirmed insertion or deletion.",
  `Unconfirmed matches (held: fuzzy or ambiguous pairings) are flagged on every row. ${HGAB_BRIDGE_NOTE} ` +
    "The largest-rows lists leave unconfirmed matches out.",
  "District figures carry their tier. A shared (Tier B) office's money is never divided between the districts it " +
    "serves, and money under the DPWH Central Office and regional offices, which is on no district card, is " +
    "returned as the residual.",
  "Rows with a page on the site carry url; document page references carry pdf_url, which opens the source PDF at that page.",
  "Every response carries disclaimers (id, title, body, url): the no-allegations paragraph everywhere, and the " +
    "office-and-district paragraph as well on office-based views (the district routes and DPWH project lists " +
    "filtered to one office). Keep them with any figure you republish.",
];

const STAGE_ORDER_INFO = [
  {
    stage: "nep",
    label: STAGE_LABELS.nep.label,
    in_this_dataset: true,
    versions: ["nep"],
    note: FISCAL_STAGE_LONG.nep,
  },
  {
    stage: "house",
    label: "House bill (House Bill 10858)",
    in_this_dataset: true,
    versions: ["hgab2", "hgab3"],
    note:
      "Published at second and third reading. DPWH is compared at third reading; the other three programs publish " +
      "one list, identical at both readings, and are compared at second.",
  },
  { stage: "senate", label: "Senate version", in_this_dataset: false, versions: [], note: "Not in this dataset." },
  {
    stage: "gaa",
    label: "General Appropriations Act (the enacted budget)",
    in_this_dataset: false,
    versions: [],
    note: "Not in this dataset. Enacted budgets for FY2020–2026 are under /api/v1/gaa.",
  },
];

const REPRESENTATIVES_NOTE =
  "Representatives are listed so a reader can find their district. Nothing here establishes that a " +
  "representative requested, sponsored or controlled any project or amount.";

const HEADLINE_SCOPE = {
  fy2026_gaa_php: `${FISCAL_STAGE_LONG.gaa} Covers ${FISCAL_STAGE_SCOPE.gaa}.`,
  fy2027_nep_php: `${FISCAL_STAGE_LONG.nep} Covers ${FISCAL_STAGE_SCOPE.nep}.`,
  fy2027_hgab3_php: `${FISCAL_STAGE_LONG.hgab3} Covers ${FISCAL_STAGE_SCOPE.hgab3}, so it is smaller than the whole-office figures; use fy2027_vs_proposal for a like-for-like change.`,
};

// ---------------------------------------------------------------------------
// Disclaimers: the pages' paragraphs, verbatim (src/lib/hgab-disclaimers.ts)
// ---------------------------------------------------------------------------

/** Our summary of the DEO-to-district mapping's restrictions, and the upstream original. */
export const HGAB_DEO_RESTRICTIONS_URL = `${SITE}${DEO_RESTRICTIONS_PATH}`;
export const HGAB_DEO_RESTRICTIONS_UPSTREAM_URL = DEO_RESTRICTIONS_UPSTREAM_URL;

function publicDisclaimer(d: Disclaimer) {
  return {
    id: d.id,
    title: d.title,
    body: d.body,
    url: `${ROOT}/methodology#${d.id}`,
    // The office paragraph ends "See the DEO mapping restrictions."
    ...(d.id === DISCLAIMER_OFFICES.id
      ? { restrictions_url: HGAB_DEO_RESTRICTIONS_URL, upstream_restrictions_url: HGAB_DEO_RESTRICTIONS_UPSTREAM_URL }
      : {}),
  };
}

/** `disclaimers` on office-based views: the district routes and DPWH project lists filtered to one office. */
const OFFICE_VIEW = OFFICE_VIEW_DISCLAIMERS.map(publicDisclaimer);
/** `disclaimers` on every other House bill response. */
const COMPARISON = COMPARISON_DISCLAIMERS.map(publicDisclaimer);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

/** Validate an enum parameter; empty means the default. */
function oneOf<T extends string>(name: string, raw: string | undefined | null, allowed: readonly T[], fallback: T): T {
  if (raw == null || raw === "") return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new ApiError(400, "bad_request", `${name} must be one of ${allowed.join(", ")} (got "${clip(raw)}")`);
}

function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
  const n = v == null || !Number.isFinite(v) ? fallback : Math.trunc(v);
  return Math.max(min, Math.min(max, n));
}

/** Run a query; a missing hgab_* table means the dataset was never loaded here. */
async function rows<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> {
  try {
    const { results } = await env.DB.prepare(sql).bind(...binds).all<T>();
    return results ?? [];
  } catch (e) {
    if (/no such table:\s*hgab_/i.test(String((e as Error)?.message ?? e))) {
      throw new ApiError(503, "not_loaded", "FY2027 House bill data is not loaded on this deployment");
    }
    throw e;
  }
}

async function firstRow<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T | null> {
  const r = await rows<T>(env, sql, ...binds);
  return r[0] ?? null;
}

function assertKey(raw: string): DatasetKey {
  if ((HGAB_DATASET_KEYS as readonly string[]).includes(raw)) return raw as DatasetKey;
  throw new ApiError(404, "not_found", `No House bill dataset "${clip(raw)}"; use one of ${HGAB_DATASET_KEYS.join(", ")}`);
}

/** A region key (any case) or the published label(s), "|"-separated. */
function regionFilter(raw: string): { column: "region_key" | "region"; values: string[] } {
  const v = raw.trim();
  const key = REGION_ORDER.find((k) => k.toLowerCase() === v.toLowerCase());
  if (key) return { column: "region_key", values: [key] };
  const labels = v.split("|").map((s) => s.trim()).filter(Boolean);
  if (!labels.length) throw new ApiError(400, "bad_request", "region is empty");
  return { column: "region", values: labels };
}

function pdfUrl(doc: string | null | undefined, page: number | null | undefined): string | null {
  if (!doc) return null;
  const base = `${ASSETS}/hgab/2027/pdf/${encodeURIComponent(doc)}.pdf`;
  return page ? `${base}#page=${page}` : base;
}

function recordUrl(key: DatasetKey, id: string): string {
  return `${ROOT}/${key}/p/${encodeURIComponent(id)}`;
}

function districtUrl(id: string): string {
  return `${ROOT}/districts/${encodeURIComponent(id)}`;
}

function humanise(code: string): string {
  return code.replace(/[_:]/g, " ");
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

interface MetaRow {
  fiscal_year: number;
  built_at: string;
  source_repo: string;
  source_commit: string;
  notice: string;
  terms_json: string;
}

async function metaRow(env: Env): Promise<MetaRow> {
  const m = await firstRow<MetaRow>(
    env,
    `SELECT fiscal_year, built_at, source_repo, source_commit, notice, terms_json FROM hgab_meta WHERE id = 1`,
  );
  if (!m) throw new ApiError(503, "not_loaded", "FY2027 House bill data is not loaded on this deployment");
  return m;
}

function baseMeta(m: MetaRow) {
  return {
    dataset: "hgab" as const,
    fiscal_year: m.fiscal_year,
    currency: "PHP" as const,
    scale: "pesos" as const,
    source_repo: m.source_repo,
    source_commit: m.source_commit,
    built_at: m.built_at,
    notice: m.notice,
  };
}

// ---------------------------------------------------------------------------
// datasets
// ---------------------------------------------------------------------------

interface DatasetRow {
  key: string;
  sort: number;
  label: string;
  short: string;
  agency: string;
  dept_id: string;
  summary: string;
  one_row: string;
  caveats_json: string;
  grain: string;
  scope: string;
  controls_label: string;
  has_readings: number;
  has_map: number;
  house_stage: string;
  nep_php: number;
  hgab2_php: number | null;
  hgab3_php: number | null;
  api_php: number | null;
  nep_count: number;
  hgab2_count: number | null;
  hgab3_count: number | null;
  api_count: number | null;
  printed_json: string | null;
  bridge_json: string;
  documents_json: string;
  readings_json: string | null;
  not_on_map_json: string | null;
  map_note: string | null;
  points_note: string | null;
  placeable: number;
}

/** Per-group sums of the unconfirmed (held) rows. */
interface HeldStat {
  dataset: string;
  bridge_group: string | null;
  n: number;
  nep: number | null;
  house: number | null;
  delta: number | null;
  abs_delta: number | null;
}

async function heldStats(env: Env, key?: DatasetKey): Promise<HeldStat[]> {
  return rows<HeldStat>(
    env,
    `SELECT dataset, bridge_group, COUNT(*) AS n, SUM(nep_php) AS nep, SUM(house_php) AS house,
            SUM(delta_php) AS delta, SUM(ABS(delta_php)) AS abs_delta
       FROM hgab_projects WHERE held = 1 ${key ? "AND dataset = ?" : ""}
      GROUP BY dataset, bridge_group`,
    ...(key ? [key] : []),
  );
}

/** A group's money basis, the same one its bridge `php` uses. */
function basis(group: BridgeGroup, s: Pick<HeldStat, "nep" | "house" | "delta" | "abs_delta">): number {
  switch (group) {
    case "house_only":
    case "unchanged":
      return Number(s.house ?? 0);
    case "nep_only":
      return Number(s.nep ?? 0);
    case "increased":
    case "decreased":
      return Number(s.abs_delta ?? 0);
    default:
      return Number(s.delta ?? 0);
  }
}

/** SQL for the same basis, per row. */
const BASIS_SQL = `CASE bridge_group
  WHEN 'nep_only' THEN nep_php
  WHEN 'increased' THEN ABS(delta_php)
  WHEN 'decreased' THEN ABS(delta_php)
  WHEN 'scope_review' THEN ABS(delta_php)
  ELSE house_php END`;

function plainBridge(b: Bridge, held: HeldStat[], withHelp: boolean) {
  const groups: Record<string, unknown> = {};
  for (const g of BRIDGE_ORDER) {
    const c: BridgeCell = b[g] ?? { rows: 0, php: 0 };
    const h = held.find((s) => s.bridge_group === g);
    const meta = BRIDGE_LABELS[g];
    groups[g] = {
      group: g,
      label: meta.label,
      sub: meta.sub,
      ...(withHelp ? { help: meta.help } : {}),
      rows: c.rows,
      php: c.php,
      nep_php: c.nep_php ?? null,
      house_php: c.house_php ?? null,
      unconfirmed_rows: h ? Number(h.n) : 0,
      unconfirmed_php: h ? basis(g, h) : 0,
    };
  }
  return {
    house_stage: b.house_stage,
    house_stage_label: STAGE_LABELS[b.house_stage]?.label ?? b.house_stage,
    net_php: b.net_php,
    identity: "house_only − nep_only + increased − decreased + scope_review = net_php (unchanged adds nothing)",
    groups,
    ...(withHelp ? { note: HGAB_BRIDGE_NOTE } : {}),
  };
}

function docRef(key: string) {
  return { key, pdf_url: pdfUrl(key, null) };
}

function datasetEntry(d: DatasetRow, held: HeldStat[], full: boolean) {
  const key = d.key as DatasetKey;
  const bridge = parseJson<Bridge | null>(d.bridge_json, null);
  const mine = held.filter((h) => h.dataset === key);
  const houseStage = d.house_stage as "hgab2" | "hgab3";
  const base = {
    key,
    label: d.label,
    short: d.short,
    agency: d.agency,
    dept_id: d.dept_id,
    summary: d.summary,
    one_row: d.one_row,
    house_stage: houseStage,
    house_stage_label: STAGE_LABELS[houseStage]?.label ?? houseStage,
    totals: {
      nep_php: d.nep_php,
      hgab2_php: d.hgab2_php,
      hgab3_php: d.hgab3_php,
      api_php: d.api_php,
      not_additive_across_versions: true as const,
    },
    counts: { nep: d.nep_count, hgab2: d.hgab2_count, hgab3: d.hgab3_count, api: d.api_count },
    unconfirmed_rows: mine.reduce((a, h) => a + Number(h.n), 0),
    bridge: bridge ? plainBridge(bridge, mine, full) : null,
    url: `${ROOT}/${key}`,
    links: {
      self: `${API}/datasets/${key}`,
      projects: `${API}/datasets/${key}/projects`,
      regions: `${API}/datasets/${key}/regions`,
      nep_department: `/api/v1/nep/2027/departments/${d.dept_id}`,
      projects_page: `${ROOT}/${key}?view=projects`,
    },
  };
  if (!full) return base;
  const documents = parseJson<{ nep: string[]; house: string[] }>(d.documents_json, { nep: [], house: [] });
  return {
    ...base,
    caveats: parseJson<string[]>(d.caveats_json, []),
    grain: d.grain,
    scope: d.scope,
    controls_label: d.controls_label,
    has_readings: !!d.has_readings,
    has_map: !!d.has_map,
    placeable: !!d.placeable,
    printed: parseJson<HgabDatasetMeta["printed"]>(d.printed_json, null),
    documents: { nep: (documents.nep ?? []).map(docRef), house: (documents.house ?? []).map(docRef) },
  };
}

async function datasetRow(env: Env, key: DatasetKey): Promise<DatasetRow> {
  const d = await firstRow<DatasetRow>(env, `SELECT * FROM hgab_datasets WHERE key = ?`, key);
  if (!d) throw new ApiError(404, "not_found", `No House bill dataset "${key}" in the loaded data`);
  return d;
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

interface DocumentRow {
  key: string;
  sort: number;
  title: string;
  stage: string;
  reading: number | null;
  volume: string | null;
  pages_json: string | null;
  sha256: string;
  bytes: number;
  source_url: string | null;
  notes: string | null;
  pdf_url: string;
}

async function documentRows(env: Env): Promise<DocumentRow[]> {
  return rows<DocumentRow>(env, `SELECT * FROM hgab_documents ORDER BY sort`);
}

function publicDocument(r: DocumentRow, usedBy: string[]) {
  return {
    key: r.key,
    title: r.title,
    stage: r.stage,
    stage_label: r.stage === "nep" ? STAGE_LABELS.nep.label : "House bill (House Bill 10858)",
    reading: r.reading,
    volume: r.volume,
    pages: parseJson<{ from: number; to: number } | null>(r.pages_json, null),
    sha256: r.sha256,
    bytes: r.bytes,
    source_url: r.source_url,
    notes: r.notes,
    pdf_url: r.pdf_url || pdfUrl(r.key, null),
    used_by: usedBy,
  };
}

function asHgabDocuments(docs: DocumentRow[]): HgabDocument[] {
  return docs.map((r) => ({
    key: r.key,
    title: r.title,
    stage: r.stage === "nep" ? "nep" : "house",
    reading: r.reading === 2 || r.reading === 3 ? r.reading : null,
    volume: r.volume,
    pages: parseJson<{ from: number; to: number } | null>(r.pages_json, null),
    sha256: r.sha256,
    bytes: r.bytes,
    source_url: r.source_url,
    notes: r.notes,
  }));
}

export async function hgabDocuments(env: Env) {
  const [m, docs, datasets] = await Promise.all([
    metaRow(env),
    documentRows(env),
    rows<{ key: string; documents_json: string }>(env, `SELECT key, documents_json FROM hgab_datasets ORDER BY sort`),
  ]);
  const usedBy = (docKey: string) =>
    datasets
      .filter((d) => {
        const j = parseJson<{ nep?: string[]; house?: string[] }>(d.documents_json, {});
        return (j.nep ?? []).includes(docKey) || (j.house ?? []).includes(docKey);
      })
      .map((d) => d.key);
  return {
    meta: {
      ...baseMeta(m),
      total: docs.length,
      note:
        "The source PDFs every page reference opens. Page numbers are positions in the file (what #page=N uses), " +
        "not the page numbers shown on the pages. sha256 and bytes identify the exact file.",
    },
    disclaimers: COMPARISON,
    data: docs.map((d) => publicDocument(d, usedBy(d.key))),
  };
}

// ---------------------------------------------------------------------------
// overview and dataset lists
// ---------------------------------------------------------------------------

export async function hgabOverview(env: Env) {
  const [m, datasets, held, docs, recon] = await Promise.all([
    metaRow(env),
    rows<DatasetRow>(env, `SELECT * FROM hgab_datasets ORDER BY sort`),
    heldStats(env),
    documentRows(env),
    rows<{ dataset: string; status: string; n: number }>(
      env,
      `SELECT dataset, status, COUNT(*) AS n FROM hgab_reconciliation GROUP BY dataset, status`,
    ),
  ]);
  const byStatus: Record<string, number> = {};
  const byDataset: Record<string, Record<string, number>> = {};
  for (const r of recon) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + Number(r.n);
    (byDataset[r.dataset] ??= {})[r.status] = Number(r.n);
  }
  const usedBy = (docKey: string) =>
    datasets
      .filter((d) => {
        const j = parseJson<{ nep?: string[]; house?: string[] }>(d.documents_json, {});
        return (j.nep ?? []).includes(docKey) || (j.house ?? []).includes(docKey);
      })
      .map((d) => d.key);
  return {
    meta: baseMeta(m),
    disclaimers: COMPARISON,
    data: {
      title: "FY2027 House bill (House Bill 10858) against the NEP",
      summary:
        "For the four programs where the House bill lists projects one by one (DPWH infrastructure, " +
        "farm-to-market roads, health facilities and irrigation), every project line in the House bill set " +
        "against the NEP (the budget the President submits to Congress each August): what was added, dropped, " +
        "raised, reduced or left unchanged.",
      stage_order: STAGE_ORDER_INFO,
      record_versions: (["nep", "hgab2", "hgab3", "api"] as const).map((k) => ({ key: k, ...STAGE_LABELS[k] })),
      rules: RULES,
      terms: parseJson<Record<string, { term: string; meaning: string }>>(m.terms_json, PLAIN_TERMS),
      datasets: datasets.map((d) => datasetEntry(d, held, true)),
      documents: docs.map((d) => publicDocument(d, usedBy(d.key))),
      reconciliation: {
        checks: recon.reduce((a, r) => a + Number(r.n), 0),
        by_status: byStatus,
        by_dataset: byDataset,
        status_labels: RECON_STATUS_LABEL,
        note: "Checks of the source's figures against this portal's own FY2027 NEP data (DBM CSV).",
        link: `${API}/reconciliation`,
      },
      districts: {
        note: "DPWH money by district engineering office, with the congressional districts each office serves.",
        link: `${API}/districts`,
        url: `${ROOT}/districts`,
      },
      url: `${ROOT}/overview`,
      links: {
        datasets: `${API}/datasets`,
        documents: `${API}/documents`,
        reconciliation: `${API}/reconciliation`,
        districts: `${API}/districts`,
        methodology: `${ROOT}/methodology`,
        sources: `${ROOT}/sources`,
      },
    },
  };
}

export async function hgabDatasets(env: Env) {
  const [m, datasets, held] = await Promise.all([
    metaRow(env),
    rows<DatasetRow>(env, `SELECT * FROM hgab_datasets ORDER BY sort`),
    heldStats(env),
  ]);
  return {
    meta: { ...baseMeta(m), total: datasets.length, note: `${COMPARE_RULE} ${HGAB_BRIDGE_NOTE}` },
    disclaimers: COMPARISON,
    data: datasets.map((d) => datasetEntry(d, held, false)),
  };
}

// ---------------------------------------------------------------------------
// one dataset
// ---------------------------------------------------------------------------

interface ControlDbRow {
  id: string;
  sort: number;
  label: string;
  grp: string | null;
  nep_php: number | null;
  hgab2_php: number | null;
  hgab3_php: number | null;
  api_php: number | null;
  delta_php: number | null;
  reading_delta_php: number | null;
  nep_page: number | null;
  house_pages_json: string;
}

interface DimDbRow {
  dim: string;
  sort: number;
  label: string;
  nep_php: number;
  house_php: number;
  nep_records: number;
  house_records: number;
}

interface RegionDbRow {
  region_key: string;
  sort: number;
  label: string;
  name: string;
  nep_php: number | null;
  house_php: number | null;
  delta_php: number | null;
  nep_rows: number;
  house_rows: number;
  source_labels_json: string;
}

/** hgab_projects minus search_text. */
interface ProjectDbRow {
  dataset: string;
  id: string;
  title: string;
  program: string | null;
  pap: string | null;
  region: string | null;
  region_key: string | null;
  office: string | null;
  office_kind: string | null;
  zone: string | null;
  trace: string;
  bridge_group: string | null;
  held: number;
  house_match: string | null;
  reading_status: string | null;
  api_presence: string | null;
  confidence: number | null;
  nep_php: number | null;
  hgab2_php: number | null;
  hgab3_php: number | null;
  house_php: number | null;
  api_php: number | null;
  delta_php: number | null;
  nep_page: number | null;
  hgab2_page: number | null;
  hgab3_page: number | null;
  nep_doc: string | null;
  hgab2_doc: string | null;
  hgab3_doc: string | null;
  length_m: number | null;
  flags: string;
  suggestions: number;
  lon: number | null;
  lat: number | null;
}

const PROJECT_COLS = `dataset, id, title, program, pap, region, region_key, office, office_kind, zone,
  trace, bridge_group, held, house_match, reading_status, api_presence, confidence,
  nep_php, hgab2_php, hgab3_php, house_php, api_php, delta_php,
  nep_page, hgab2_page, hgab3_page, nep_doc, hgab2_doc, hgab3_doc,
  length_m, flags, suggestions, lon, lat`;

function publicProject(r: ProjectDbRow) {
  const key = r.dataset as DatasetKey;
  const t = traceInfo(r.trace);
  const group = (r.bridge_group ?? t.group) as BridgeGroup | null;
  return {
    id: r.id,
    dataset: key,
    title: r.title,
    program: r.program,
    pap: r.pap,
    region: r.region,
    region_key: r.region_key,
    office: r.office,
    office_kind: r.office_kind,
    zone: r.zone,
    trace: r.trace,
    status_label: t.label,
    bridge_group: group,
    group_label: group ? BRIDGE_LABELS[group]?.label ?? null : null,
    held: !!r.held,
    house_match: r.house_match,
    reading_status: r.reading_status,
    api_presence: r.api_presence,
    confidence: r.confidence,
    nep_php: r.nep_php,
    hgab2_php: r.hgab2_php,
    hgab3_php: r.hgab3_php,
    house_php: r.house_php,
    api_php: r.api_php,
    delta_php: r.delta_php,
    nep_page: r.nep_page,
    hgab2_page: r.hgab2_page,
    hgab3_page: r.hgab3_page,
    nep_doc: r.nep_doc,
    hgab2_doc: r.hgab2_doc,
    hgab3_doc: r.hgab3_doc,
    pdf_url: {
      nep: pdfUrl(r.nep_doc, r.nep_page),
      hgab2: pdfUrl(r.hgab2_doc, r.hgab2_page),
      hgab3: pdfUrl(r.hgab3_doc, r.hgab3_page),
    },
    length_m: r.length_m,
    flags: splitFlags(r.flags),
    suggestions: r.suggestions,
    lon: r.lon,
    lat: r.lat,
    url: recordUrl(key, r.id),
    api_url: `${API}/datasets/${key}/projects/${encodeURIComponent(r.id)}`,
  };
}

function regionEntries(key: DatasetKey, regions: RegionDbRow[]) {
  return regions.map((r) => ({
    key: r.region_key,
    label: r.label,
    name: r.name || REGION_LABELS[r.region_key as RegionKey]?.name || r.label,
    nep_php: r.nep_php,
    house_php: r.house_php,
    delta_php: r.delta_php,
    nep_rows: r.nep_rows,
    house_rows: r.house_rows,
    source_labels: parseJson<string[]>(r.source_labels_json, []),
    links: {
      projects: r.nep_rows || r.house_rows
        ? `${API}/datasets/${key}/projects?region=${encodeURIComponent(r.region_key)}`
        : null,
    },
  }));
}

function regionsBlock(d: DatasetRow, regions: RegionDbRow[]) {
  const key = d.key as DatasetKey;
  return {
    house_stage: d.house_stage,
    placeable: !!d.placeable,
    note: d.map_note,
    points_note: d.points_note,
    regions: regionEntries(key, regions),
    not_on_map: parseJson<Record<string, unknown> | null>(d.not_on_map_json, null),
    not_additive_across_versions: true as const,
    url: `${ROOT}/${key}?view=map`,
  };
}

export async function hgabDataset(env: Env, rawKey: string) {
  const key = assertKey(rawKey);
  const [m, d, held, controls, dims, regions, top, docs] = await Promise.all([
    metaRow(env),
    datasetRow(env, key),
    heldStats(env, key),
    rows<ControlDbRow>(env, `SELECT * FROM hgab_controls WHERE dataset = ? ORDER BY sort`, key),
    rows<DimDbRow>(env, `SELECT * FROM hgab_dims WHERE dataset = ? ORDER BY dim, sort`, key),
    rows<RegionDbRow>(env, `SELECT * FROM hgab_regions WHERE dataset = ? ORDER BY sort`, key),
    rows<ProjectDbRow & { rn: number }>(
      env,
      `SELECT * FROM (
         SELECT ${PROJECT_COLS},
                ROW_NUMBER() OVER (PARTITION BY bridge_group ORDER BY ${BASIS_SQL} DESC NULLS LAST, id ASC) AS rn
           FROM hgab_projects WHERE dataset = ? AND held = 0
       ) WHERE rn <= 10`,
      key,
    ),
    documentRows(env),
  ]);
  const entry = datasetEntry(d, held, true);
  const docsMeta = asHgabDocuments(docs);
  const documents = parseJson<{ nep: string[]; house: string[] }>(d.documents_json, { nep: [], house: [] });
  const nepDoc = documents.nep?.[0] ?? null;
  const houseDoc = controlHouseDoc(docsMeta, { documents });

  const dimsOut: Record<string, unknown[]> = {};
  for (const r of dims) {
    (dimsOut[r.dim] ??= []).push({
      label: r.label,
      nep_php: r.nep_php,
      house_php: r.house_php,
      nep_records: r.nep_records,
      house_records: r.house_records,
    });
  }

  const topOut: Record<string, unknown[]> = {};
  for (const g of BRIDGE_ORDER) topOut[g] = [];
  for (const r of top.sort((a, b) => a.rn - b.rn)) {
    if (r.bridge_group && topOut[r.bridge_group]) topOut[r.bridge_group].push(publicProject(r));
  }

  let readings: unknown = null;
  if (d.readings_json) {
    const rd = parseJson<Record<string, unknown> | null>(d.readings_json, null);
    if (rd) {
      const counts = (rd.status_counts ?? {}) as Record<string, number>;
      // The D1 build stores `third_only` as the ids of the rows added at third reading.
      const third = Array.isArray(rd.third_only) ? rd.third_only : [];
      const thirdIds = third.filter((x): x is string => typeof x === "string");
      readings = {
        ...rd,
        second_label: STAGE_LABELS.hgab2.label,
        third_label: STAGE_LABELS.hgab3.label,
        status_counts_labelled: Object.entries(counts).map(([code, n]) => ({
          code,
          label: READING_LABELS[code] ?? humanise(code),
          rows: n,
        })),
        third_only_rows: thirdIds.map((id) => ({
          id,
          url: recordUrl(key, id),
          api_url: `${API}/datasets/${key}/projects/${encodeURIComponent(id)}`,
        })),
        links: { third_only: `${API}/datasets/${key}/projects?reading_status=third_only` },
      };
    }
  }

  return {
    meta: { ...baseMeta(m), dataset_key: key, note: `${COMPARE_RULE} ${HGAB_BRIDGE_NOTE}` },
    disclaimers: COMPARISON,
    data: {
      ...entry,
      controls: controls.map((c) => {
        const housePages = parseJson<number[]>(c.house_pages_json, []);
        return {
          id: c.id,
          label: c.label,
          group: c.grp,
          nep_php: c.nep_php,
          hgab2_php: c.hgab2_php,
          hgab3_php: c.hgab3_php,
          api_php: c.api_php,
          delta_php: c.delta_php,
          reading_delta_php: c.reading_delta_php,
          nep_page: c.nep_page,
          house_pages: housePages,
          nep_pdf_url: c.nep_page ? pdfUrl(nepDoc, c.nep_page) : null,
          house_pdf_urls: houseDoc ? housePages.map((p) => pdfUrl(houseDoc.key, p)) : [],
        };
      }),
      controls_note:
        "The subtotals published in each document for these projects, side by side; delta_php is the latest House " +
        "reading minus the NEP. Columns are versions: compare them, never add them.",
      dims: dimsOut,
      dims_note: "House bill against the NEP by each source's own recorded label (house_php is the latest House reading).",
      regions: regionsBlock(d, regions),
      readings,
      top: topOut,
      top_note: HGAB_TOP_NOTE,
    },
  };
}

export async function hgabRegions(env: Env, rawKey: string) {
  const key = assertKey(rawKey);
  const [m, d, regions] = await Promise.all([
    metaRow(env),
    datasetRow(env, key),
    rows<RegionDbRow>(env, `SELECT * FROM hgab_regions WHERE dataset = ? ORDER BY sort`, key),
  ]);
  return {
    meta: {
      ...baseMeta(m),
      dataset_key: key,
      note:
        "All 18 regions, north to south, under the region each document lists (normalised to one key per region; " +
        "null where a document lists nothing there). Amounts listed as nationwide or with no region are in " +
        "not_on_map. Nothing is geocoded from place names.",
    },
    disclaimers: COMPARISON,
    data: regionsBlock(d, regions),
  };
}

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export interface HgabProjectsOpts {
  q?: string;
  /** Comma-separated bridge groups. */
  group?: string;
  held?: string;
  region?: string;
  program?: string;
  pap?: string;
  office?: string;
  office_kind?: string;
  zone?: string;
  trace?: string;
  reading_status?: string;
  flag?: string;
  has_coordinates?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

function projectWhere(key: DatasetKey, o: HgabProjectsOpts) {
  const where: string[] = ["dataset = ?"];
  const binds: unknown[] = [key];
  const filters: Record<string, unknown> = {};

  const words = (o.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > MAX_WORDS) throw new ApiError(400, "bad_request", `q has at most ${MAX_WORDS} words`);
  for (const w of words) {
    where.push(`search_text LIKE ? ESCAPE '\\'`);
    binds.push(`%${escapeLike(w)}%`);
  }
  if (words.length) filters.q = words.join(" ");

  if (o.group) {
    const groups = o.group.split(",").map((s) => s.trim()).filter(Boolean);
    for (const g of groups) oneOf("group", g, BRIDGE_ORDER, "house_only");
    if (groups.length) {
      where.push(`bridge_group IN (${groups.map(() => "?").join(", ")})`);
      binds.push(...groups);
      filters.group = groups;
    }
  }

  const held = oneOf("held", o.held, HGAB_HELD_MODES, "all");
  if (held === "hide") where.push("held = 0");
  if (held === "only") where.push("held = 1");
  filters.held = held;

  if (o.region) {
    const r = regionFilter(o.region);
    where.push(r.values.length > 1 ? `${r.column} IN (${r.values.map(() => "?").join(", ")})` : `${r.column} = ?`);
    binds.push(...r.values);
    filters.region = { value: o.region, matched_on: r.column, values: r.values };
  }

  const exact: Array<[keyof HgabProjectsOpts, string]> = [
    ["program", "program"],
    ["pap", "pap"],
    ["office", "office"],
    ["office_kind", "office_kind"],
    ["trace", "trace"],
    ["reading_status", "reading_status"],
  ];
  for (const [param, col] of exact) {
    const v = o[param];
    if (typeof v === "string" && v !== "") {
      where.push(`${col} = ?`);
      binds.push(v);
      filters[param] = v;
    }
  }

  if (o.zone) {
    const zone = oneOf("zone", o.zone, HGAB_ZONES, "local");
    where.push("zone = ?");
    binds.push(zone);
    filters.zone = zone;
  }

  if (o.flag) {
    const flag = o.flag.trim();
    where.push(`(',' || flags || ',') LIKE ? ESCAPE '\\'`);
    binds.push(`%,${escapeLike(flag)},%`);
    filters.flag = flag;
  }

  if (o.has_coordinates) {
    const v = o.has_coordinates.toLowerCase();
    if (v === "1" || v === "true") where.push("lon IS NOT NULL AND lat IS NOT NULL");
    else if (v === "0" || v === "false") where.push("(lon IS NULL OR lat IS NULL)");
    else throw new ApiError(400, "bad_request", `has_coordinates must be one of 1, 0 (got "${clip(o.has_coordinates)}")`);
    filters.has_coordinates = v === "1" || v === "true";
  }

  return { where: where.join(" AND "), binds, filters };
}

const SORT_SQL: Record<ProjectSort, string> = {
  house: "house_php",
  nep: "nep_php",
  delta: "delta_php",
  abs_delta: "ABS(delta_php)",
  title: "title",
};

export async function hgabProjects(env: Env, rawKey: string, o: HgabProjectsOpts = {}) {
  const key = assertKey(rawKey);
  const { where, binds, filters } = projectWhere(key, o);
  const sort = oneOf("sort", o.sort, HGAB_PROJECT_SORTS, "house");
  const order = oneOf("order", o.order, HGAB_ORDERS, sort === "title" ? "asc" : "desc");
  const limit = clampInt(o.limit, 50, 1, 200);
  const offset = clampInt(o.offset, 0, 0, 1_000_000);

  const [m, d, page, sums, lens] = await Promise.all([
    metaRow(env),
    datasetRow(env, key),
    rows<ProjectDbRow>(
      env,
      `SELECT ${PROJECT_COLS} FROM hgab_projects WHERE ${where}
        ORDER BY ${SORT_SQL[sort]} ${order.toUpperCase()} NULLS LAST, id ASC
        LIMIT ? OFFSET ?`,
      ...binds,
      limit,
      offset,
    ),
    firstRow<{
      n: number;
      nep_rows: number; nep_php: number | null;
      hgab2_rows: number; hgab2_php: number | null;
      hgab3_rows: number; hgab3_php: number | null;
      api_rows: number; api_php: number | null;
      held_rows: number | null;
    }>(
      env,
      `SELECT COUNT(*) AS n,
              COUNT(nep_php) AS nep_rows, SUM(nep_php) AS nep_php,
              COUNT(hgab2_php) AS hgab2_rows, SUM(hgab2_php) AS hgab2_php,
              COUNT(hgab3_php) AS hgab3_rows, SUM(hgab3_php) AS hgab3_php,
              COUNT(api_php) AS api_rows, SUM(api_php) AS api_php,
              SUM(held) AS held_rows
         FROM hgab_projects WHERE ${where}`,
      ...binds,
    ),
    // One printed office's rows: an office-based view, so it names the office's tier and districts.
    key === "dpwh" && typeof filters.office === "string" ? officeLens(env, filters.office) : Promise.resolve(null),
  ]);
  const total = Number(sums?.n ?? 0);
  const out = page.map(publicProject);
  return {
    meta: {
      ...baseMeta(m),
      dataset_key: key,
      house_stage: d.house_stage,
      filters,
      sort,
      order,
      limit,
      offset,
      returned: out.length,
      total,
      note:
        "One row per comparison record. status_label is the plain status; trace is the raw code. Pairings are " +
        "candidates, not confirmed changes; held = true marks an unconfirmed match. sums are per version over " +
        `every matched row (not just this page). ${COMPARE_RULE}`,
    },
    disclaimers: lens ? OFFICE_VIEW : COMPARISON,
    data: {
      total,
      sums: {
        nep_php: sums?.nep_php ?? null,
        hgab2_php: sums?.hgab2_php ?? null,
        hgab3_php: sums?.hgab3_php ?? null,
        api_php: sums?.api_php ?? null,
        rows_with_amount: {
          nep: Number(sums?.nep_rows ?? 0),
          hgab2: Number(sums?.hgab2_rows ?? 0),
          hgab3: Number(sums?.hgab3_rows ?? 0),
          api: Number(sums?.api_rows ?? 0),
        },
        unconfirmed_rows: Number(sums?.held_rows ?? 0),
        not_additive_across_versions: true as const,
      },
      ...(lens ? { office_lens: lens } : {}),
      rows: out,
      next_offset: offset + out.length < total ? offset + out.length : null,
    },
  };
}

interface OfficeLensRow extends OfficeDbRow {
  years_json: string;
}

/**
 * What a DPWH list filtered to one printed office is: that office's ledger.
 * The DEO mapping associates the office with districts; it assigns no row to
 * any of them, so the view carries the tier, every associated district and a
 * pointer to the residual, as the mapping's restrictions require.
 */
async function officeLens(env: Env, printed: string) {
  const all = await rows<OfficeLensRow>(
    env,
    `SELECT id, name, kind, region, region_key, tier, district_ids_json, years_json, NULL AS fy2027_json FROM hgab_offices`,
  );
  const offices = all.map(asOffice);
  const exact = offices.filter((o) => officeParquetLabel(o) === printed);
  const matched = exact.length ? exact : offices.filter((o) => o.name === printed);
  const ids = [...new Set(matched.flatMap((o) => o.district_ids))];
  const [labels, fy27, marked, bucket] = await Promise.all([
    ids.length
      ? rows<{ id: string; label: string }>(
          env,
          `SELECT id, label FROM hgab_districts WHERE id IN (${ids.map(() => "?").join(", ")})`,
          ...ids,
        )
      : Promise.resolve([]),
    matched.length
      ? rows<{ id: string; fy2027_json: string | null }>(
          env,
          `SELECT id, fy2027_json FROM hgab_offices WHERE id IN (${matched.map(() => "?").join(", ")})`,
          ...matched.map((o) => o.id),
        )
      : Promise.resolve([]),
    // No-office lines have a grouped side, so they are among the repeated (marked) lines.
    rows<{ id: string; grouped_record: string | null }>(
      env,
      `SELECT p.id, ${GROUPED_RECORD_SQL} AS grouped_record
         FROM hgab_projects p JOIN hgab_records r ON r.dataset = p.dataset AND r.id = p.id
        WHERE p.dataset = 'dpwh' AND p.office = ?
          AND p.reading_status IS NOT NULL AND p.reading_status NOT IN ('same_amount', 'no_house_record')`,
      printed,
    ),
    hasNoOfficeBucket(env),
  ]);
  const noOfficeIds = bucket ? marked.filter((r) => namesNoOffice(r.grouped_record)).map((r) => r.id) : [];
  const labelOf = new Map(labels.map((r) => [r.id, r.label] as const));
  // Lines held out of an office's figures because their office changed (present once the data carries them).
  const changeOf = new Map(
    fy27.map((r) => [r.id, parseJson<OfficeHistory["fy2027"]>(r.fy2027_json, null)?.office_change ?? null] as const),
  );
  return {
    printed_office: printed,
    offices: matched.map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      kind_label: officeKindText(o),
      tier: o.tier,
      tier_text:
        o.tier === "A"
          ? "Tier A · serves one district"
          : `Tier B · shared by ${o.district_ids.length} districts, not split`,
      districts: o.district_ids.map((id) => ({
        id,
        label: labelOf.get(id) ?? id,
        url: districtUrl(id),
        api_url: `${API}/districts/${encodeURIComponent(id)}`,
      })),
      ...(changeOf.get(o.id)
        ? {
            office_change: {
              rows: changeOf.get(o.id)?.rows ?? 0,
              row_ids: changeOf.get(o.id)?.row_ids ?? [],
              note:
                "Paired lines naming this office on one side and a different office group (or no district office) " +
                "on the other. They are held out of the office's district-card figures and counted in the FY2027 " +
                "House bill residual (office_change_php); those printed under this office are still among this list's rows and sums.",
            },
          }
        : {}),
    })),
    ...(noOfficeIds.length
      ? {
          no_office: {
            rows: noOfficeIds.length,
            row_ids: noOfficeIds,
            note:
              "Lines printed under this office whose grouped records name no office: the source's lens reads them as " +
              "naming none, so they are in no office's district-card figures and are counted in the FY2027 House bill " +
              "residual (no_office_php). They are still among this list's rows and sums.",
          },
        }
      : {}),
    shared_office_total: matched.some((o) => o.tier === "B"),
    tier_meaning: TIER_MEANING,
    note: matched.length
      ? "These are the rows the documents print under this office. The office is associated with the districts " +
        "listed; no row is assigned to any one of them, and a Tier B office's sums are never split between its " +
        "districts. Lines in office_change (their NEP and House bill sides name different offices) and in " +
        "no_office are held out of the office's district-card figures. Money on no district card is the residual " +
        "in the districts list."
      : "This printed office is on no district card (the Central Office, a regional office, or a name that " +
        "matched no district office). Its money is part of the residual in the districts list.",
    residual_api: `${API}/districts`,
  };
}

export async function hgabProject(env: Env, rawKey: string, id: string) {
  const key = assertKey(rawKey);
  if (!id || id.length > 200) throw new ApiError(400, "bad_request", "id must be a project id from the projects list");
  const [m, d, row, rec] = await Promise.all([
    metaRow(env),
    datasetRow(env, key),
    firstRow<ProjectDbRow>(env, `SELECT ${PROJECT_COLS} FROM hgab_projects WHERE dataset = ? AND id = ?`, key, id),
    firstRow<{ record_json: string }>(env, `SELECT record_json FROM hgab_records WHERE dataset = ? AND id = ?`, key, id),
  ]);
  if (!row) throw new ApiError(404, "not_found", `No ${key} project "${clip(id)}"`);
  const p = publicProject(row);
  const t = traceInfo(row.trace);
  const api = apiPresenceInfo(row.api_presence);
  return {
    meta: {
      ...baseMeta(m),
      dataset_key: key,
      house_stage: d.house_stage,
      note:
        "One comparison record: the row, plain labels for every code, a pdf_url per version that opens the source " +
        "page, and the source workbench's full record (`record`, shape as the workbench writes it). " +
        "The status is a candidate, not a confirmed change.",
    },
    disclaimers: COMPARISON,
    data: {
      ...p,
      labels: {
        status: {
          code: row.trace,
          label: t.label,
          help: t.help,
          group: p.bridge_group,
          group_label: p.group_label,
          held: !!row.held,
          ...(row.held
            ? { note: "An unconfirmed match. It is counted in the bridge's 'In the House bill only' group and left out of the largest-rows lists." }
            : {}),
        },
        match: row.house_match ? { code: row.house_match, label: matchLabel(row.house_match) } : null,
        reading: row.reading_status
          ? { code: row.reading_status, label: READING_LABELS[row.reading_status] ?? humanise(row.reading_status) }
          : null,
        dpwh_site: api && row.api_presence ? { code: row.api_presence, label: api.label, help: api.help } : null,
        zone: row.zone ? { code: row.zone, label: zoneLabel(row.zone) } : null,
        flags: p.flags.map((f) => ({ code: f, label: flagLabel(f) })),
        pap: papLabel(key),
        versions: {
          nep: STAGE_LABELS.nep.label,
          hgab2: STAGE_LABELS.hgab2.label,
          hgab3: STAGE_LABELS.hgab3.label,
          api: STAGE_LABELS.api.label,
        },
      },
      record: rec ? parseJson<unknown>(rec.record_json, null) : null,
      links: {
        dataset: `${API}/datasets/${key}`,
        projects: `${API}/datasets/${key}/projects`,
        dataset_page: `${ROOT}/${key}`,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// reconciliation
// ---------------------------------------------------------------------------

export interface HgabReconOpts {
  dataset?: string;
  status?: string;
}

export async function hgabReconciliation(env: Env, o: HgabReconOpts = {}) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (o.dataset) {
    where.push("dataset = ?");
    binds.push(oneOf("dataset", o.dataset, HGAB_DATASET_KEYS, "dpwh"));
  }
  if (o.status) {
    where.push("status = ?");
    binds.push(oneOf("status", o.status, HGAB_RECON_STATUSES, "exact"));
  }
  const [m, list] = await Promise.all([
    metaRow(env),
    rows<{
      sort: number; dataset: string; check_name: string; ours_php: number | null; theirs_php: number | null;
      diff_php: number | null; status: string; note: string;
    }>(env, `SELECT * FROM hgab_reconciliation ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY sort`, ...binds),
  ]);
  const byStatus: Record<string, number> = {};
  for (const r of list) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    meta: {
      ...baseMeta(m),
      filters: { dataset: o.dataset ?? null, status: o.status ?? null },
      total: list.length,
      by_status: byStatus,
      note:
        "Checks of the source workbench's figures against this portal's own FY2027 NEP data. ours_php is from this " +
        "portal's NEP import (the DBM CSV); theirs_php is the workbench's extraction from the PDFs; diff_php = " +
        "ours − theirs. exact = equal; explained = differs for the reason in note; info = context, not a check.",
    },
    disclaimers: COMPARISON,
    data: list.map((r) => ({
      dataset: r.dataset,
      check: r.check_name,
      ours_php: r.ours_php,
      theirs_php: r.theirs_php,
      diff_php: r.diff_php,
      status: r.status,
      status_label: RECON_STATUS_LABEL[r.status as keyof typeof RECON_STATUS_LABEL] ?? r.status,
      note: r.note,
    })),
  };
}

// ---------------------------------------------------------------------------
// districts
// ---------------------------------------------------------------------------

interface DistrictDbRow {
  id: string;
  sort: number;
  label: string;
  jurisdiction: string;
  district_label: string;
  region: string | null;
  region_key: string | null;
  attribution: string;
  rep_name: string | null;
  rep_status: string | null;
  rep_json: string | null;
  office_ids_json: string;
  co_served_json: string;
  fy2026_gaa_php: number | null;
  fy2027_nep_php: number | null;
  fy2027_hgab3_php: number | null;
}

interface OfficeDbRow {
  id: string;
  name: string;
  kind: string;
  region: string | null;
  region_key: string | null;
  tier: string;
  district_ids_json: string;
  years_json?: string;
  by_congress_json?: string;
  fy2027_json: string | null;
  notes_json?: string;
  aliases_json?: string;
}

interface ResidualDbRow {
  fy: number;
  stage: string;
  sort: number;
  total_php: number;
  deo_php: number;
  central_office_php: number;
  regional_offices_php: number;
  unmatched_php: number;
  unmatched_labels_json: string;
  /** Present once the D1 build carries the FY2027 office-change bucket. */
  office_change_php?: number | null;
  office_change_rows?: number | null;
  /** Present once the D1 build carries the FY2027 no-office bucket. */
  no_office_php?: number | null;
  no_office_rows?: number | null;
}

const DISTRICT_COLS = `id, sort, label, jurisdiction, district_label, region, region_key, attribution,
  rep_name, rep_status, rep_json, office_ids_json, co_served_json,
  fy2026_gaa_php, fy2027_nep_php, fy2027_hgab3_php`;

function asCard(r: DistrictDbRow): DistrictCard {
  const att = (HGAB_ATTRIBUTIONS as readonly string[]).includes(r.attribution)
    ? (r.attribution as DistrictCard["attribution"])
    : "none";
  return {
    id: r.id,
    label: r.label,
    jurisdiction: r.jurisdiction,
    district_label: r.district_label,
    region: r.region,
    representative: parseJson<DistrictRepresentative | null>(r.rep_json, null),
    office_ids: parseJson<string[]>(r.office_ids_json, []),
    attribution: att,
    headline: {
      fy2026_gaa_php: r.fy2026_gaa_php,
      fy2027_nep_php: r.fy2027_nep_php,
      fy2027_hgab3_php: r.fy2027_hgab3_php,
    },
    co_served_district_ids: parseJson<string[]>(r.co_served_json, []),
  };
}

function asOffice(r: OfficeDbRow): OfficeHistory {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as OfficeHistory["kind"],
    region: r.region,
    district_ids: parseJson<string[]>(r.district_ids_json, []),
    tier: r.tier === "A" ? "A" : "B",
    years: parseJson<YearAmount[]>(r.years_json, []),
    by_congress: parseJson<OfficeHistory["by_congress"]>(r.by_congress_json, []),
    fy2027: parseJson<OfficeHistory["fy2027"]>(r.fy2027_json, null),
    aliases_used: parseJson<string[]>(r.aliases_json, []),
    notes: parseJson<string[]>(r.notes_json, []),
  };
}

function publicRep(rep: DistrictRepresentative | null): Record<string, unknown> | null {
  if (!rep) return null;
  return {
    name: repName(rep),
    seat: rep.seat,
    status: rep.status,
    status_note:
      rep.status === "ambiguous"
        ? "congress.gov.ph lists more than one member for this seat (succession or an election protest); every candidate is listed and none is chosen."
        : null,
    member_code: rep.member_code,
    profile_url: rep.profile_url,
    bills_url: rep.juris_url,
    bill_count: rep.bill_count,
    leadership_roles: rep.leadership_roles ?? [],
    portrait: rep.portrait_url
      ? {
          url: rep.portrait_url,
          attribution: rep.portrait_attribution,
          license: rep.portrait_license,
          source_url: rep.portrait_source_url,
        }
      : null,
    ...(rep.candidates?.length ? { candidates: rep.candidates.map((c) => publicRep(c)) } : {}),
  };
}

function publicCard(card: DistrictCard, index: HgabDistrictIndex, regionKey: string | null, marks: OfficeMarks) {
  const offices = cardOffices(card, index);
  const groups = cardRegionalGroups(card, index);
  const shared = card.attribution === "B" || card.attribution === "mixed";
  const coServed = coServedIds(card, index);
  const att = ATTRIBUTION_LABELS[card.attribution];
  const fy27 = cardFy27(card, index);
  const unconfirmed = offices.reduce(
    (a, o) => {
      const u = officeUnconfirmed(marks, o);
      return { rows: a.rows + u.rows, php: a.php + u.php };
    },
    { rows: 0, php: 0 },
  );
  return {
    id: card.id,
    label: card.label,
    jurisdiction: card.jurisdiction,
    district_label: card.district_label,
    region: card.region,
    region_key: regionKey,
    attribution: { code: card.attribution, label: att.label, meaning: att.help },
    representative: publicRep(card.representative),
    offices: offices.map((o) => {
      const others = o.district_ids.filter((x) => x !== card.id);
      return {
        id: o.id,
        name: o.name,
        kind: o.kind,
        kind_label: officeKindText(o),
        tier: o.tier,
        tier_text: officeTierText(o.tier, others.length),
        co_served_district_ids: others,
      };
    }),
    regional_groupings: groups.map((g) => ({
      id: g.id,
      name: g.name,
      note: "A regional grouping, not a district office. Its money is in the residual, not on this card.",
    })),
    headline: {
      fy2026_gaa_php: card.headline.fy2026_gaa_php,
      fy2027_nep_php: card.headline.fy2027_nep_php,
      fy2027_hgab3_php: card.headline.fy2027_hgab3_php,
      shared_office_total: shared,
      co_served_district_ids: shared ? coServed : [],
      note:
        card.attribution === "none"
          ? att.help
          : shared
            ? "Shared office totals: the whole figure of every office serving this district, including money shared with the co-served districts. It is not split, so read it as a range, never as this district's own."
            : "Every serving office serves only this district, so these figures can be read as the district's.",
      scope: HEADLINE_SCOPE,
    },
    fy2027_vs_proposal: {
      ...fy27,
      unconfirmed_rows: unconfirmed.rows,
      unconfirmed_php: unconfirmed.php,
      not_additive_across_versions: true as const,
      note:
        "The 2027 House bill against the NEP on the same project rows of the serving offices (named projects " +
        "only). This, not the headline pair, is the like-for-like change; it is what sort=change ranks on." +
        (shared ? " Shared office totals, not split." : ""),
    },
    url: districtUrl(card.id),
    api_url: `${API}/districts/${encodeURIComponent(card.id)}`,
  };
}

function publicResidual(r: ResidualDbRow) {
  // A D1 loaded before the office-change bucket existed has no such columns: say nothing rather than 0.
  const hasOfficeChange = r.office_change_php !== undefined;
  const hasNoOffice = r.no_office_php !== undefined;
  const y: ResidualYear = {
    fy: r.fy,
    stage: r.stage as FiscalStage,
    total_php: r.total_php,
    deo_php: r.deo_php,
    central_office_php: r.central_office_php,
    regional_offices_php: r.regional_offices_php,
    unmatched_php: r.unmatched_php,
    unmatched_labels: parseJson<string[]>(r.unmatched_labels_json, []),
    office_change_php: Number(r.office_change_php ?? 0),
    office_change_rows: Number(r.office_change_rows ?? 0),
    no_office_php: Number(r.no_office_php ?? 0),
    no_office_rows: Number(r.no_office_rows ?? 0),
  };
  const { office_change_php, office_change_rows, no_office_php, no_office_rows, ...rest } = y;
  return {
    ...rest,
    ...(hasNoOffice ? { no_office_php, no_office_rows } : {}),
    ...(hasOfficeChange ? { office_change_php, office_change_rows } : {}),
    stage_label: FISCAL_STAGE_SHORT[y.stage] ?? y.stage,
    scope: FISCAL_STAGE_SCOPE[y.stage] ?? null,
    not_on_any_district_php: residualUnattributed(y),
    share_not_on_any_district: residualShare(y),
  };
}

/**
 * The source's own uncertainty markers on the DPWH rows, per printed office:
 * unconfirmed (held) matches and second-to-third-reading markers. Office-based
 * views carry them so a roll-up never folds them back in.
 */
interface MarkRow {
  id: string;
  office: string;
  bridge_group: string | null;
  held: number;
  nep_php: number | null;
  house_php: number | null;
  delta_php: number | null;
  reading_status: string | null;
  /** The source record, only for rows with a grouped (`records`) side. */
  grouped_record?: string | null;
  /** True when the source's lens reads the line as naming no office (see `namesNoOffice`). */
  no_office?: boolean;
}

/** Marked rows by the office the House bill prints. */
interface OfficeMarks {
  byOffice: Map<string, MarkRow[]>;
  /** The loaded data has the FY2027 `no_office` residual bucket (those lines are in no office's figures). */
  noOfficeBucket: boolean;
}

/** SQL: the row's source record when a side is grouped (`records`), else NULL. */
const GROUPED_RECORD_SQL = `CASE WHEN json_type(r.record_json, '$.third.records') = 'array'
       OR json_type(r.record_json, '$.nep.records') = 'array' THEN r.record_json END`;

interface LensSide {
  office?: string | null;
  office_canonical?: string | null;
  records?: LensSide[];
}

/**
 * The source lens's `no_office` verdict (buildCongressIndex.mjs `sideOffices` /
 * `classifyRow`): a grouped side is read from its records only, and a line none
 * of whose sides names an office is in no office's figures (residual).
 */
function namesNoOffice(recordJson: string | null | undefined): boolean {
  if (!recordJson) return false;
  const rec = parseJson<{ third?: LensSide | null; nep?: LensSide | null } | null>(recordJson, null);
  if (!rec) return false;
  const sides = [rec.third, rec.nep].filter((s): s is LensSide => Boolean(s));
  const names = sides.flatMap((s) => (s.records ?? [s]).map((x) => x.office_canonical ?? x.office ?? "").filter(Boolean));
  return sides.length > 0 && names.length === 0;
}

/** Whether the loaded data has the FY2027 `no_office` residual bucket. */
async function hasNoOfficeBucket(env: Env): Promise<boolean> {
  const r = await firstRow<Record<string, unknown>>(env, `SELECT * FROM hgab_residual WHERE stage = 'hgab3' LIMIT 1`);
  return r != null && "no_office_php" in r;
}

async function officeMarks(env: Env, printed?: string[]): Promise<OfficeMarks> {
  const out: OfficeMarks = { byOffice: new Map(), noOfficeBucket: false };
  if (printed && !printed.length) return out;
  // No-office lines have a grouped side, so they are repeated (marked) lines: the candidates below cover them.
  const [list, bucket] = await Promise.all([
    rows<MarkRow>(
      env,
      `SELECT p.id, p.office, p.bridge_group, p.held, p.nep_php, p.house_php, p.delta_php, p.reading_status,
              ${GROUPED_RECORD_SQL} AS grouped_record
         FROM hgab_projects p LEFT JOIN hgab_records r ON r.dataset = p.dataset AND r.id = p.id
        WHERE p.dataset = 'dpwh' AND p.office IS NOT NULL
          AND (p.held = 1 OR (p.reading_status IS NOT NULL AND p.reading_status NOT IN ('same_amount', 'no_house_record')))
          ${printed ? `AND p.office IN (${printed.map(() => "?").join(", ")})` : ""}`,
      ...(printed ?? []),
    ),
    hasNoOfficeBucket(env),
  ]);
  out.noOfficeBucket = bucket;
  for (const r of list) {
    const row: MarkRow = { ...r, no_office: namesNoOffice(r.grouped_record) };
    delete row.grouped_record;
    out.byOffice.set(r.office, [...(out.byOffice.get(r.office) ?? []), row]);
  }
  return out;
}

/** An office's 2027 office-change lines (held out of its figures), when the loaded data has them. */
function officeChangeOf(o: OfficeHistory) {
  return o.fy2027?.office_change ?? null;
}

/** Lines printed under the office that the data holds out of every office as naming no office. */
function officeNoOfficeRows(marks: OfficeMarks, o: OfficeHistory): MarkRow[] {
  if (!marks.noOfficeBucket) return [];
  return (marks.byOffice.get(officeParquetLabel(o)) ?? []).filter((r) => r.no_office);
}

/**
 * One office's marked rows: those printed under it, minus the lines held out
 * of its figures (office changes, and no-office lines when the data has them).
 */
function officeMarkRows(marks: OfficeMarks, o: OfficeHistory): MarkRow[] {
  const heldOut = new Set(officeChangeOf(o)?.row_ids ?? []);
  return (marks.byOffice.get(officeParquetLabel(o)) ?? []).filter(
    (r) => !heldOut.has(r.id) && !(marks.noOfficeBucket && r.no_office),
  );
}

function isGroup(g: string | null): g is BridgeGroup {
  return g != null && (BRIDGE_ORDER as readonly string[]).includes(g);
}

/** Unconfirmed matches among the rows, per bridge group, on each group's money basis. */
function unconfirmedByGroup(list: MarkRow[]): Map<BridgeGroup, { rows: number; php: number }> {
  const out = new Map<BridgeGroup, { rows: number; php: number }>();
  for (const r of list) {
    if (!r.held || !isGroup(r.bridge_group)) continue;
    const g = r.bridge_group;
    const cur = out.get(g) ?? { rows: 0, php: 0 };
    const php = basis(g, { nep: r.nep_php, house: r.house_php, delta: r.delta_php, abs_delta: r.delta_php == null ? null : Math.abs(r.delta_php) });
    out.set(g, { rows: cur.rows + 1, php: cur.php + php });
  }
  return out;
}

function officeUnconfirmed(marks: OfficeMarks, o: OfficeHistory): { rows: number; php: number } {
  let rowsN = 0;
  let php = 0;
  for (const c of unconfirmedByGroup(officeMarkRows(marks, o)).values()) {
    rowsN += c.rows;
    php += c.php;
  }
  return { rows: rowsN, php };
}

const ANNOTATIONS_NOTE =
  "The source's own uncertainty markers on this office's 2027 rows, kept apart rather than folded into the " +
  "totals' reading. unconfirmed_rows / unconfirmed_php: unconfirmed (fuzzy or ambiguous) matches, counted under " +
  "'In the House bill only' and included in hgab3_php. scope_review_rows: a different stretch of the same road, " +
  "not counted as a change. reading_markers: rows by their second-to-third-reading status. List them via projects_api. " +
  "office_change and no_office, when present, list the lines held out of this office's figures altogether.";

const NO_OFFICE_NOTE =
  "Lines the House bill prints under this office whose grouped records name no office, so the source's lens reads " +
  "them as naming none. They are in no figure above or on any district card; they are in the FY2027 House bill " +
  "residual (no_office_php).";

const OFFICE_CHANGE_NOTE =
  "Paired lines held out of this office's figures because the NEP and House bill sides name different office " +
  "groups, or one side names no district office. None of these amounts is in any figure above or on any district " +
  "card; they are in the FY2027 House bill residual (office_change_php). A line naming two offices is listed under both.";

async function residualRows(env: Env) {
  return (await rows<ResidualDbRow>(env, `SELECT * FROM hgab_residual ORDER BY sort`)).map(publicResidual);
}

/** RESIDUAL_NOTE, plus the FY2027 House bill buckets the loaded data has, and the identity they add up to. */
function residualNote(residual: ReturnType<typeof publicResidual>[]): string {
  const noOffice = residual.some((y) => "no_office_php" in y);
  const officeChange = residual.some((y) => "office_change_php" in y);
  if (!noOffice && !officeChange) return RESIDUAL_NOTE;
  const parts = [
    ...(noOffice ? ["no_office"] : []),
    ...(officeChange ? ["office_change"] : []),
  ];
  return [
    RESIDUAL_NOTE,
    "For the FY2027 House bill only (0 for the enacted years and the NEP):",
    ...(noOffice ? [RESIDUAL_NO_OFFICE_NOTE] : []),
    ...(officeChange ? [RESIDUAL_OFFICE_CHANGE_NOTE] : []),
    `${parts.length > 1 ? "Both are" : "It is"} held out of every office and every district card and counted in ` +
      `not_on_any_district_php. ` +
      `deo + central_office + regional_offices + unmatched + ${parts.join(" + ")} = total.`,
  ].join(" ");
}

const RESIDUAL_NOTE =
  "Every year's DPWH total split into money under offices that appear on a district card (deo_php) and money on no " +
  "district card: the Central Office, regional offices, and office names that matched nothing " +
  "(not_on_any_district_php). Nine slots: FY2020–2026 enacted, FY2027 NEP, FY2027 House bill.";

const RESIDUAL_OFFICE_CHANGE_NOTE =
  "office_change_php / office_change_rows are paired lines whose NEP and House bill sides name different office " +
  "groups (or one side names no district office).";

const RESIDUAL_NO_OFFICE_NOTE =
  "no_office_php / no_office_rows are lines whose grouped records name no office (the source's no_office bucket).";

export interface HgabDistrictsOpts {
  region?: string;
  q?: string;
  attribution?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export async function hgabDistricts(env: Env, o: HgabDistrictsOpts = {}) {
  const where: string[] = [];
  const binds: unknown[] = [];
  const filters: Record<string, unknown> = {};
  if (o.region) {
    const r = regionFilter(o.region);
    where.push(r.values.length > 1 ? `${r.column} IN (${r.values.map(() => "?").join(", ")})` : `${r.column} = ?`);
    binds.push(...r.values);
    filters.region = { value: o.region, matched_on: r.column, values: r.values };
  }
  if (o.attribution) {
    const a = oneOf("attribution", o.attribution, HGAB_ATTRIBUTIONS, "A");
    where.push("attribution = ?");
    binds.push(a);
    filters.attribution = a;
  }
  const words = (o.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > MAX_WORDS) throw new ApiError(400, "bad_request", `q has at most ${MAX_WORDS} words`);
  for (const w of words) {
    where.push(`search_text LIKE ? ESCAPE '\\'`);
    binds.push(`%${escapeLike(w)}%`);
  }
  if (words.length) filters.q = words.join(" ");
  const sort = oneOf<DistrictSort>("sort", o.sort, HGAB_DISTRICT_SORTS, "hgab3");
  const limit = clampInt(o.limit, 50, 1, 254);
  const offset = clampInt(o.offset, 0, 0, 100_000);

  const [m, districtRows, officeRows, residual, marks] = await Promise.all([
    metaRow(env),
    rows<DistrictDbRow>(
      env,
      `SELECT ${DISTRICT_COLS} FROM hgab_districts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY sort`,
      ...binds,
    ),
    rows<OfficeDbRow>(env, `SELECT id, name, kind, region, region_key, tier, district_ids_json, years_json, fy2027_json FROM hgab_offices`),
    residualRows(env),
    officeMarks(env),
  ]);

  const cards = districtRows.map(asCard);
  const regionKeyOfCard = new Map(districtRows.map((r) => [r.id, r.region_key] as const));
  const offices: Record<string, OfficeHistory> = {};
  for (const r of officeRows) offices[r.id] = asOffice(r);
  const index = { districts: cards, offices } as Pick<HgabDistrictIndex, "districts" | "offices"> as HgabDistrictIndex;
  const sorted = sortDistricts(cards, index, sort);
  const pageCards = sorted.slice(offset, offset + limit);

  return {
    meta: {
      ...baseMeta(m),
      filters,
      sort,
      limit,
      offset,
      returned: pageCards.length,
      total: sorted.length,
      tier_meaning: TIER_MEANING,
      representatives_note: REPRESENTATIVES_NOTE,
      note:
        "DPWH money by the district engineering office the documents list, with the congressional districts each " +
        "office serves. No project is assigned to a district; a shared office's money is never divided. Headline " +
        "amounts are the undivided totals of the serving offices. Money on no district card is in residual.",
    },
    disclaimers: OFFICE_VIEW,
    data: {
      total: sorted.length,
      districts: pageCards.map((c) => publicCard(c, index, regionKeyOfCard.get(c.id) ?? null, marks)),
      next_offset: offset + pageCards.length < sorted.length ? offset + pageCards.length : null,
      residual,
      residual_note: residualNote(residual),
    },
  };
}

function publicOfficeFy2027(f: OfficeHistory["fy2027"], marked: MarkRow[], noOffice: MarkRow[]) {
  if (!f) return null;
  const b = f.bridge;
  const held = unconfirmedByGroup(marked);
  const heldIn = (g: BridgeGroup) => held.get(g);
  let unconfirmedRows = 0;
  let unconfirmedPhp = 0;
  for (const c of held.values()) {
    unconfirmedRows += c.rows;
    unconfirmedPhp += c.php;
  }
  const readings = new Map<string, number>();
  for (const r of marked) {
    if (r.reading_status && r.reading_status !== "same_amount" && r.reading_status !== "no_house_record") {
      readings.set(r.reading_status, (readings.get(r.reading_status) ?? 0) + 1);
    }
  }
  const oc = f.office_change ?? null;
  return {
    nep_php: f.nep_php,
    hgab2_php: f.hgab2_php,
    hgab3_php: f.hgab3_php,
    nep_records: f.nep_records,
    hgab3_records: f.hgab3_records,
    not_additive_across_versions: true as const,
    bridge: b
      ? {
          house_stage: b.house_stage,
          net_php: b.net_php,
          groups: Object.fromEntries(
            BRIDGE_ORDER.map((g) => {
              const c = b[g] ?? { rows: 0, php: 0 };
              const h = heldIn(g);
              return [g, {
                group: g,
                label: BRIDGE_LABELS[g].label,
                sub: BRIDGE_LABELS[g].sub,
                rows: c.rows,
                php: c.php,
                nep_php: c.nep_php ?? null,
                house_php: c.house_php ?? null,
                unconfirmed_rows: h?.rows ?? 0,
                unconfirmed_php: h?.php ?? 0,
              }];
            }),
          ),
          note: "This office's 2027 project rows in the six groups, as the office ledger stores them; the groups add up to net_php.",
        }
      : null,
    annotations: {
      unconfirmed_rows: unconfirmedRows,
      unconfirmed_php: unconfirmedPhp,
      scope_review_rows: b?.scope_review?.rows ?? 0,
      reading_markers: [...readings].sort(([x], [y]) => x.localeCompare(y)).map(([code, n]) => ({
        code,
        label: READING_LABELS[code] ?? humanise(code),
        rows: n,
      })),
      note: ANNOTATIONS_NOTE,
    },
    ...(oc
      ? {
          office_change: {
            rows: oc.rows,
            nep_php: oc.nep_php,
            hgab3_php: oc.hgab3_php,
            not_additive_across_versions: true as const,
            lines: (oc.row_ids ?? []).map((rid) => ({
              id: rid,
              url: recordUrl("dpwh", rid),
              api_url: `${API}/datasets/dpwh/projects/${encodeURIComponent(rid)}`,
            })),
            note: OFFICE_CHANGE_NOTE,
          },
        }
      : {}),
    ...(noOffice.length
      ? {
          no_office: {
            rows: noOffice.length,
            hgab3_php: noOffice.reduce((a, r) => a + Number(r.house_php ?? 0), 0),
            lines: noOffice.map((r) => ({
              id: r.id,
              url: recordUrl("dpwh", r.id),
              api_url: `${API}/datasets/dpwh/projects/${encodeURIComponent(r.id)}`,
            })),
            note: NO_OFFICE_NOTE,
          },
        }
      : {}),
  };
}

export async function hgabDistrict(env: Env, id: string) {
  if (!id || id.length > 120) throw new ApiError(400, "bad_request", "id must be a district id from the districts list, e.g. leg:abra:lone");
  const [m, row, residual] = await Promise.all([
    metaRow(env),
    firstRow<DistrictDbRow>(env, `SELECT ${DISTRICT_COLS} FROM hgab_districts WHERE id = ?`, id),
    residualRows(env),
  ]);
  if (!row) throw new ApiError(404, "not_found", `No district "${clip(id)}"; list them via ${API}/districts`);
  const card = asCard(row);
  const officeRows = card.office_ids.length
    ? await rows<OfficeDbRow>(
        env,
        `SELECT * FROM hgab_offices WHERE id IN (${card.office_ids.map(() => "?").join(", ")})`,
        ...card.office_ids,
      )
    : [];
  const offices: Record<string, OfficeHistory> = {};
  for (const r of officeRows) offices[r.id] = asOffice(r);
  const index = { districts: [card], offices } as Pick<HgabDistrictIndex, "districts" | "offices"> as HgabDistrictIndex;

  const related = new Set<string>(coServedIds(card, index));
  const relatedRows = related.size
    ? await rows<{ id: string; label: string }>(
        env,
        `SELECT id, label FROM hgab_districts WHERE id IN (${[...related].map(() => "?").join(", ")})`,
        ...related,
      )
    : [];
  const labelOf = new Map(relatedRows.map((r) => [r.id, r.label] as const));
  const ref = (did: string) => ({ id: did, label: labelOf.get(did) ?? did, url: districtUrl(did) });

  const marks = await officeMarks(env, cardOffices(card, index).map(officeParquetLabel));
  const pub = publicCard(card, index, row.region_key, marks);
  const fullOffices = cardOffices(card, index).map((o) => {
    const others = o.district_ids.filter((x) => x !== card.id);
    const printed = officeParquetLabel(o);
    return {
      id: o.id,
      name: o.name,
      kind: o.kind,
      kind_label: officeKindText(o),
      region: o.region,
      tier: o.tier,
      tier_text: officeTierText(o.tier, others.length),
      district_ids: o.district_ids,
      co_served_districts: others.map(ref),
      years: o.years.map((y) => ({
        fy: y.fy,
        stage: y.stage,
        stage_label: FISCAL_STAGE_SHORT[y.stage] ?? y.stage,
        scope: FISCAL_STAGE_SCOPE[y.stage] ?? null,
        php: y.php,
        matched_label: y.matched_label,
      })),
      years_note:
        "FY2020–2026 enacted budgets and the FY2027 NEP cover the whole office; the FY2027 House bill covers " +
        "named projects only. null = the office was not found in that year's data, never zero. Versions are " +
        "compared, never added.",
      by_congress: o.by_congress,
      by_congress_note: "Enacted (GAA) totals per Congress term; the FY2027 NEP and House bill are never part of a subtotal.",
      fy2027: publicOfficeFy2027(o.fy2027, officeMarkRows(marks, o), officeNoOfficeRows(marks, o)),
      notes: o.notes,
      aliases_used: o.aliases_used,
      projects_url: `${ROOT}/dpwh?view=projects&deo=${encodeURIComponent(printed)}`,
      projects_api: `${API}/datasets/dpwh/projects?office=${encodeURIComponent(printed)}`,
    };
  });

  return {
    meta: {
      ...baseMeta(m),
      tier_meaning: TIER_MEANING,
      representatives_note: REPRESENTATIVES_NOTE,
      note:
        "One district: its card, its representative, and the full history of every office that serves it. A shared " +
        "(Tier B) office's figures are the whole office's and are not split between the districts it serves.",
    },
    disclaimers: OFFICE_VIEW,
    data: {
      ...pub,
      co_served_districts: [...related].map(ref),
      offices: fullOffices,
      regional_groupings: pub.regional_groupings,
      residual,
      residual_note: residualNote(residual),
    },
  };
}
