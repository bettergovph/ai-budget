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

export interface PageMeta {
  title: string;
  description: string;
}

const SITE = "BetterGov Budget";

const DEFAULT_META: PageMeta = {
  title: `Philippine National Budget — GAA FY 2020–2026 & NEP FY 2027 · ${SITE}`,
  description:
    "The Philippine national budget, visualized and browsable: the enacted GAA for FY 2020–2026 and " +
    "the FY 2027 NEP proposal, drillable from national totals down to individual line items.",
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
