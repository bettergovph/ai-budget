/**
 * Per-route page metadata, shared by two consumers:
 *
 *   - the Worker (src/worker/seo.ts), which rewrites <title>, description,
 *     canonical, and og:* tags into the SPA's HTML at the edge — that's what
 *     crawlers and social scrapers see, since they don't run JavaScript;
 *   - the client (RouteMeta in App.tsx), which keeps document.title in sync
 *     during SPA navigation.
 *
 * Keep this module pure (no DOM, no fetch): it runs in both runtimes.
 * Data-dependent refinements (department names) happen in each consumer —
 * the Worker looks them up in D1, data-rich pages set document.title once
 * their data loads.
 */

import { LEADERBOARD_ROOT, boardById, shareImageKey } from "./hgab-leaderboard";
import { CHANGES_LIST_ROOT, CHANGES_LIST_TITLE } from "./hgab-changes-list";

export interface PageMeta {
  title: string;
  description: string;
  /** Social preview image; falls back to the site card in index.html. */
  image?: string;
  imageAlt?: string;
  imageWidth?: string;
  imageHeight?: string;
}

/** Fields the hearings SEO needs, mirroring the D1 `hearings` row. */
export interface HearingSeoRow {
  video_id: string;
  title: string | null;
  agency: string | null;
  fiscal_year: string | null;
  published_at: string | null;
  length_text: string | null;
  has_sections: number | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-09-02" → "2 September 2026"; anything unparseable returns "". */
export function longDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : "";
}

/**
 * Metadata for one hearing page.
 *
 * The YouTube titles are shouted and repetitive ("COMMITTEE ON APPROPRIATIONS -
 * BUDGET BRIEFING/HEARINGS OF THE FY 2027 PROPOSED BUDGET (DOH)"), which reads
 * badly in a search result and buries the part people actually search for. Build
 * the title from the fields instead, and use the video's own thumbnail as the
 * social card so a shared link looks like the hearing it points to.
 */
export function hearingMeta(row: HearingSeoRow): PageMeta {
  const date = longDate(row.published_at);
  const fy = row.fiscal_year ? `FY ${row.fiscal_year}` : "";
  const who = row.agency
    ? `${row.agency} budget hearing`
    : "Committee on Appropriations hearing";
  const title = [
    [who, date].filter(Boolean).join(", "),
    [fy, "House Committee on Appropriations"].filter(Boolean).join(" · "),
  ]
    .filter(Boolean)
    .join(" — ") + ` · ${SITE}`;

  const subject = row.agency
    ? `the ${row.agency}'s ${fy || "proposed"} budget`
    : `the ${fy || "proposed"} national budget`;
  const record = row.has_sections
    ? "Read what was said topic by topic, with every question, answer and peso figure timestamped to the video"
    : "Watch alongside the full transcript, timestamped to the video";
  const description =
    `${record}. House Committee on Appropriations deliberations on ${subject}` +
    (date ? `, streamed ${date}` : "") +
    (row.length_text ? ` (${row.length_text})` : "") + ".";

  return {
    title,
    description,
    image: `https://i.ytimg.com/vi/${row.video_id}/maxresdefault.jpg`,
    imageAlt: `${who}${date ? `, ${date}` : ""} — House Committee on Appropriations`,
    imageWidth: "1280",
    imageHeight: "720",
  };
}

const SITE = "BetterGov Budget";

const DEFAULT_META: PageMeta = {
  title: `Philippine National Budget — GAA FY 2020–2026 & NEP FY 2027 · ${SITE}`,
  description:
    "The Philippine national budget, visualized and browsable: the enacted GAA for FY 2020–2026 and " +
    "the FY 2027 NEP proposal, drillable from national totals down to individual line items.",
};

/**
 * The four HGAB datasets, keyed by their URL segment. Kept here (not imported
 * from lib/hgab.ts) so this module stays free of `import.meta.env` and runs
 * unchanged inside the Worker.
 */
const HGAB_DATASETS: Record<string, { short: string; long: string }> = {
  dpwh: { short: "DPWH", long: "Department of Public Works and Highways national infrastructure" },
  fmr: { short: "Farm-to-Market Roads", long: "Department of Agriculture farm-to-market roads" },
  hfep: { short: "Health Facilities", long: "DOH Health Facilities Enhancement Program" },
  nia: { short: "Irrigation", long: "National Irrigation Administration irrigation projects" },
};

/** Portal sub-view names, keyed by the path segment after /d/:id/. */
const PORTAL_VIEWS: Record<string, string> = {
  overview: "Overview",
  "by-year": "By Year",
  programs: "Programs",
  "budget-cycle": "Budget Cycle",
  objects: "Line Items",
  data: "Data Browser",
  report: "AI Report",
  methodology: "Methodology",
};

export function pageMeta(pathname: string): PageMeta {
  const p = pathname.replace(/\/+$/, "") || "/";

  if (p === "/" || p === "/2027" || p === "/2027/overview") {
    return {
      title: `FY 2027 Philippine Budget Proposal — the ₱7.20T NEP · ${SITE}`,
      description:
        "The Executive's FY 2027 National Expenditure Program, measured line by line against the " +
        "FY 2026 GAA: every department, program, region, and expense class, with the biggest movers.",
    };
  }
  if (p === "/learn") {
    return {
      title: `How to Read the Philippine National Budget — A Citizen's Guide · ${SITE}`,
      description:
        "A citizen's guide to the Philippine budget: the four-phase budget cycle, how appropriations " +
        "become spending, where the fine print lives in the NEP and GAA volumes, and how citizens " +
        "can scrutinize the budget at every phase.",
    };
  }
  if (p === "/hearings") {
    return {
      title: `Budget Hearings — House Committee on Appropriations FY 2027 · ${SITE}`,
      description:
        "Every FY 2027 budget briefing and hearing of the Philippine House Committee on " +
        "Appropriations: searchable transcripts, a topic-by-topic record of what each " +
        "agency was asked and answered, and every peso figure timestamped to the video.",
    };
  }
  if (p.startsWith("/hearings/")) {
    return {
      title: `Budget Hearing Transcript · ${SITE}`,
      description:
        "Full transcript, summary, and highlights of a House Committee on Appropriations " +
        "budget hearing, with an interactive transcript cued to the video.",
    };
  }
  if (p === "/glossary") {
    return {
      title: `Philippine Budget Glossary — Every Term in Plain Language · ${SITE}`,
      description:
        "The complete DBM BESF Glossary of Terms rewritten in plain language: MOOE, automatic " +
        "appropriations, SARO, NCA, and 200+ other terms across documents, appropriations, taxes, " +
        "debt, and performance — searchable and filterable.",
    };
  }
  if (p === "/2027/browse") {
    return {
      title: `Browse the FY 2027 NEP — Departments, Programs, Regions · ${SITE}`,
      description:
        "Drill through the FY 2027 National Expenditure Program: departments, agencies, programs, " +
        "regions, funds, and expense classes, each against its FY 2026 GAA baseline.",
    };
  }
  if (p === "/2027/search" || p === "/2027/explore") {
    return {
      title: `Search the FY 2027 NEP · ${SITE}`,
      description:
        "Search the FY 2027 National Expenditure Program by program, agency, or keyword and see " +
        "each match against its FY 2026 GAA baseline.",
    };
  }
  if (p === "/2027/methodology") {
    return {
      title: `FY 2027 NEP Methodology · ${SITE}`,
      description:
        "How the FY 2027 NEP dataset was parsed, aggregated, and reconciled against the FY 2026 GAA — " +
        "including caveats and known data-quality issues.",
    };
  }
  if (/^\/2027\/d\/[^/]+$/.test(p)) {
    return {
      title: `FY 2027 NEP Department Detail · ${SITE}`,
      description:
        "One department's FY 2027 proposal vs its FY 2026 GAA baseline: agencies, programs, " +
        "expense classes, regions, and the biggest movers.",
    };
  }

  // --- FY2027 House General Appropriations Bill (HB 10858) ---------------
  // `/hgab` and `/hgab/2027` redirect to the overview, the section's landing
  // page, so they share its metadata; the Worker folds their canonical onto
  // `/hgab/2027/overview` too.
  if (p === "/hgab" || p === "/hgab/2027" || p === "/hgab/2027/overview") {
    return {
      title: `House Budget Analysis — House Bill 10858 against the 2027 NEP, Four Programs · ${SITE}`,
      description:
        "House Bill 10858, the FY 2027 General Appropriations Bill, compared project by project " +
        "with the NEP for DPWH infrastructure, farm-to-market roads, health facilities and " +
        "irrigation: insertion and deletion candidates, increases and decreases per program, " +
        "stage totals, checks against this portal's NEP data, and the published source documents.",
    };
  }
  if (p === "/hgab/2027/intro") {
    return {
      title: `House Budget Analysis Explainer — the 2027 House Bill against the NEP in Short Chapters · ${SITE}`,
      description:
        "An illustrated explainer of House Bill 10858 against the FY 2027 NEP for DPWH " +
        "infrastructure, farm-to-market roads, health facilities and irrigation: program and " +
        "region totals, what the House added and dropped, foreign-assisted projects and the " +
        "reading-to-reading difference, in short chapters.",
    };
  }
  if (p === "/hgab/2027/sources") {
    return {
      title: `House Budget Analysis 2027 Sources & Downloads — Documents, Checksums, Parquet · ${SITE}`,
      description:
        "The source documents behind the FY 2027 House bill comparison — HB 10858 volumes at both " +
        "readings and the DBM NEP volumes — with SHA-256 checksums, page ranges, downloadable " +
        "JSON and parquet files, and how to cite a figure.",
    };
  }
  if (p === "/hgab/2027/methodology") {
    return {
      title: `House Budget Analysis 2027 Methodology — How the House Bill Was Matched to the NEP · ${SITE}`,
      description:
        "How FY 2027 House bill rows were extracted and paired with NEP rows, the five-group bridge " +
        "that reconciles House to NEP, the status vocabulary, the checks against this portal's NEP " +
        "data, the limits, and the full disclaimer.",
    };
  }
  if (p === "/hgab/2027/districts") {
    return {
      title: `Districts — DPWH District Engineering Offices and the Districts They Serve, FY 2027 · ${SITE}`,
      description:
        "One card per Philippine legislative district: the representative in the 20th Congress, the " +
        "DPWH district engineering office(s) serving it, that office's budget by Congress and fiscal " +
        "year (FY 2020–2026 GAA), and the FY 2027 House bill against the NEP for its rows — with " +
        "shared offices shown undivided and the Central Office residual published every year.",
    };
  }
  if (/^\/hgab\/2027\/districts\/[^/]+$/.test(p)) {
    return {
      title: `District — DPWH Office Budget by Congress and the FY 2027 House Bill vs NEP · ${SITE}`,
      description:
        "One legislative district's DPWH district engineering office(s): attribution tier, budget by " +
        "fiscal year and Congress (FY 2020–2026 GAA, FY 2027 NEP and House bill), the FY 2027 bridge, " +
        "the largest projects, and the representative who holds the seat in the 20th Congress.",
    };
  }
  // The whole list of inserted and adjusted projects: before the dataset pattern.
  if (p === CHANGES_LIST_ROOT) {
    return {
      title: `${CHANGES_LIST_TITLE} — FY2027 House bill · ${SITE}`,
      description:
        "Every project House Bill 10858, the FY 2027 House bill, lists that is not in the NEP or carries a " +
        "different amount: DPWH infrastructure, farm-to-market roads, health facilities and irrigation, with " +
        "the amounts as published, the DPWH office that carries each out, the districts it serves and their " +
        "representatives. One page, downloadable as CSV. Matches are candidates, not findings.",
      // The campaign poster's link-preview size (npm run build:hgab-poster, published with upload:hgab).
      image: "https://budget-assets.bettergov.ph/hgab/2027/campaign/we-are-not-ignorant-1200x630.png",
      imageWidth: "1200",
      imageHeight: "630",
      imageAlt: "WE ARE NOT IGNORANT: 7,465 inserted and adjusted projects in the 2027 House budget bill, over the list of the projects themselves.",
    };
  }
  // Leaderboards: before the dataset pattern, which would read "leaderboard"
  // as a program key. A board's link preview is its pre-rendered national
  // image on R2; an unknown board id falls back to the gallery.
  if (p === LEADERBOARD_ROOT || p.startsWith(`${LEADERBOARD_ROOT}/`)) {
    const gallery: PageMeta = {
      title: `House Budget Analysis 2027 Leaderboards — DPWH District Offices and House Members Ranked · ${SITE}`,
      description:
        "DPWH district offices ranked by their budgets in the FY 2027 House bill and the NEP, and by " +
        "enacted budgets from 2020 to 2026; district representatives ranked by bills authored. " +
        "Each board is an image to download and share. Amounts belong to offices, not people.",
    };
    const m = /^\/hgab\/2027\/leaderboard\/([^/]+)$/.exec(p);
    if (!m) return gallery;
    let id = m[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep the raw segment */
    }
    const board = boardById(id);
    if (!board) return gallery;
    return {
      title: `${board.title} — House Budget Analysis 2027 Leaderboards · ${SITE}`,
      description: `${board.subtitle} ${board.notes[0] ?? ""}`.trim(),
      image: `https://budget-assets.bettergov.ph/${shareImageKey(board.id)}`,
      imageAlt: board.title,
      imageWidth: "1200",
      imageHeight: "630",
    };
  }
  const hgabRecord = /^\/hgab\/2027\/([a-z]+)\/p\/[^/]+$/.exec(p);
  if (hgabRecord) {
    const ds = HGAB_DATASETS[hgabRecord[1]];
    return {
      title: `${ds ? `${ds.short} project` : "Project"} — House Bill vs NEP, FY 2027 · ${SITE}`,
      description:
        `One ${ds ? ds.long : "FY 2027"} record across budget stages — NEP, House second and ` +
        "third reading — with its matching status and the PDF page each amount was read from.",
    };
  }
  const hgabDataset = /^\/hgab\/2027\/([a-z]+)$/.exec(p);
  if (hgabDataset) {
    const ds = HGAB_DATASETS[hgabDataset[1]];
    const short = ds?.short ?? hgabDataset[1].toUpperCase();
    return {
      title: `${short} · House Bill vs NEP, FY 2027 · ${SITE}`,
      description:
        `${ds ? ds.long : "FY 2027 program"} in House Bill 10858 against the NEP: the totals each document publishes, ` +
        "every project with its matching status, the largest insertions, deletions, increases and " +
        "cuts, and the PDF page behind each amount.",
    };
  }

  if (p === "/gaa") {
    return {
      title: `Philippine GAA Budget, FY 2020–2026 — Every Group Ranked · ${SITE}`,
      description:
        "The enacted General Appropriations Act across seven fiscal years: every national government " +
        "group ranked, from ₱4.10T in 2020 to ₱6.79T in 2026, drillable to the line-item level.",
    };
  }
  const yearMatch = /^\/gaa\/(20\d{2})(?:\/|$)/.exec(p);
  if (yearMatch) {
    const year = yearMatch[1];
    return {
      title: `FY ${year} Philippine National Budget — Per-Year Browser · ${SITE}`,
      description:
        `The FY ${year} General Appropriations Act in isolation: every group's appropriation for that ` +
        "year alone, drillable to bureau, program, operating unit, fund, and expense class.",
    };
  }

  const deptMatch = /^\/d\/(\d{2})(?:\/([a-z-]+))?$/.exec(p);
  if (deptMatch) {
    const view = PORTAL_VIEWS[deptMatch[2] ?? "overview"];
    const suffix = view && view !== "Overview" ? ` — ${view}` : "";
    return {
      title: `GAA Budget Portal${suffix}, FY 2020–2026 · ${SITE}`,
      description:
        "One national government group's GAA budget across FY 2020–2026: yearly totals, bureaus, " +
        "programs, expense classes, and line items.",
    };
  }

  if (p === "/methodology") {
    return {
      title: `Methodology & Data Quality — Philippine GAA Data · ${SITE}`,
      description:
        "How the GAA FY 2020–2026 dataset was compiled, and the caveats that matter: UACS recoding, " +
        "program renames, and items that moved off-GAA.",
    };
  }
  if (p === "/explore") {
    return {
      title: `Explore Philippine GAA Data · ${SITE}`,
      description: DEFAULT_META.description,
    };
  }
  return DEFAULT_META;
}

/**
 * Title for a page whose subject is one department/group — used by data-rich
 * pages (and the Worker's D1 enhancement) so cold loads and SPA navigations
 * agree on the wording.
 */
export function deptTitle(deptName: string, context: "gaa" | "nep" | { year: string | number }): string {
  if (context === "gaa") return `${deptName} — GAA Budget FY 2020–2026 · ${SITE}`;
  if (context === "nep") return `${deptName} — FY 2027 NEP vs FY 2026 GAA · ${SITE}`;
  return `${deptName} — FY ${context.year} Budget · ${SITE}`;
}
