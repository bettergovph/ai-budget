/**
 * The House bill section's disclaimers, in one place so the pages, the share
 * images, the API and the MCP server say exactly the same thing.
 *
 * The two paragraphs are the source workbench's own disclaimer
 * (csiiiv/DPWH-NEP-HB-2027-ANALYSIS, disclaimer/README.md), adopted verbatim
 * except "printed NEP" → "published NEP" (docs/hgab-copy.md). Pure: no runtime
 * imports, safe in the Worker.
 */

export interface Disclaimer {
  /** Anchor id on the Methodology page. */
  id: string;
  title: string;
  body: string;
}

/** Upstream: the DEO-to-legislative-district crosswalk's restrictions. */
export const DEO_RESTRICTIONS_UPSTREAM_URL =
  'https://github.com/csiiiv/DPWH-NEP-HB-2027-ANALYSIS/blob/main/DEO2LEG/README.md#disclaimers';

/** Our summary of those restrictions (Methodology page anchor). */
export const DEO_RESTRICTIONS_PATH = '/hgab/2027/methodology#deo-mapping-restrictions';

/** The full disclaimers, in one place (Methodology page anchor). */
export const DISCLAIMERS_PATH = '/hgab/2027/methodology#disclaimer';

export const DISCLAIMER_OFFICES: Disclaimer = {
  id: 'disclaimer-offices',
  title: 'Office and legislative-district associations.',
  body:
    'The DEO mapping associates offices with legislative districts; it does not establish that a representative ' +
    'requested, sponsored, or controlled a project, or that each project lies in every district associated with its ' +
    'office. Shared-office totals remain undivided and must not be split among the districts served. Office-based ' +
    'views must retain attribution tiers, co-served districts, unattributable residuals, and upstream uncertainty ' +
    'annotations. Historical or undated amounts retained as mapping evidence are separate from the FY2027 project ' +
    'ledger and must not be quoted as FY2027 allocations. See the DEO mapping restrictions.',
};

export const DISCLAIMER_NO_ALLEGATIONS: Disclaimer = {
  id: 'disclaimer-no-allegations',
  title: 'No allegations.',
  body:
    'An insertion, deletion, or amount-change candidate describes a provisional comparison between identified ' +
    'sources. That classification alone does not establish irregularity or wrongdoing by any office or official and ' +
    'should not be represented as such. Absence from an API snapshot likewise does not establish absence from the ' +
    'published NEP or concealment.',
};

/** The contractor pages (`/hgab/2027/contractors`) and the contracts on the multi-purpose map. */
export const DISCLAIMER_CONTRACTORS: Disclaimer = {
  id: 'disclaimer-contractors',
  title: 'Contractors.',
  body:
    'Contractor names, license numbers, contract amounts and statuses are as DPWH’s contract list publishes them. ' +
    'Amounts are contract amounts, not payments. A contract, a total or a ranking alone does not establish ' +
    'irregularity or wrongdoing by any contractor, office or official. DPWH does not publish which budget line a ' +
    'contract carries: the links shown are our match by title, office and amount, and may be wrong.',
};

/**
 * The multi-purpose building boards (`/hgab/2027/leaderboard`, section "2020 to 2026: multi-purpose buildings"):
 * how a line comes to sit in a barangay, an office or a legislative district, and what a ranking does not say.
 */
export const DISCLAIMER_MPB: Disclaimer = {
  id: 'disclaimer-mpb',
  title: 'Multi-purpose building rankings.',
  body:
    'Each line is placed in a barangay or a legislative district by the place its title names, or by the one district its ' +
    'DPWH office serves. Offices are the ones the enacted budget lists. This placement is our reading and can be wrong. ' +
    'A district’s total does not establish that any representative requested, sponsored or controlled a project; the ' +
    '2020 to 2026 budgets span the 18th, 19th and 20th Congresses. A line, a total ' +
    'or a ranking alone does not establish irregularity or wrongdoing by any contractor, office or official. Amounts are ' +
    'allocations in the enacted budgets, not spending; a building funded over several years has a line in each year.',
};

/**
 * The page by party (`/hgab/2027/parties`): where each party comes from, what a party's figure adds up, and what it
 * does not say. With DISCLAIMER_OFFICES, whose rules (tiers, shared offices undivided, residual first) it relies on.
 */
export const DISCLAIMER_PARTIES: Disclaimer = {
  id: 'disclaimer-parties',
  title: 'Parties.',
  body:
    'A representative’s party is the one they ran under for the seat in the May 2025 election, as the published results ' +
    'list it; members may have changed party since. A party’s figure adds the DPWH offices that serve only its members’ ' +
    'districts. Offices shared across parties stay whole, and lines under the Central Office carry no party. A party’s ' +
    'figure does not establish that a party or a member requested, sponsored or controlled any project, and alone it does ' +
    'not establish irregularity or wrongdoing by any party, office or official.',
};

/** Printed on every multi-purpose building share image, after the board's first note: one sentence of at most 20 words. */
export const MPB_CARD_DISCLAIMER = 'A total or a ranking is not evidence that anyone asked for a project or did anything wrong.';

/** Where each applies: every House bill page carries the second; office-based views carry both. */
export const OFFICE_VIEW_DISCLAIMERS: readonly Disclaimer[] = [DISCLAIMER_OFFICES, DISCLAIMER_NO_ALLEGATIONS];
export const COMPARISON_DISCLAIMERS: readonly Disclaimer[] = [DISCLAIMER_NO_ALLEGATIONS];

/** The trailing words of DISCLAIMER_OFFICES.body that link to the restrictions. */
export const DEO_RESTRICTIONS_LINK_TEXT = 'DEO mapping restrictions';

/** Plain text of a set of disclaimers ("Title body Title body"), for the API and MCP. */
export function disclaimerText(list: readonly Disclaimer[]): string {
  return list.map((d) => `${d.title} ${d.body}`).join(' ');
}

/**
 * The short form printed on every share image that shows people beside
 * amounts. Images travel without the page, so this carries both disclaimers'
 * core in two sentences of at most 20 words.
 */
export const CARD_DISCLAIMER =
  'Figures belong to DPWH offices, not to representatives. A candidate is a document comparison, not evidence of wrongdoing.';
