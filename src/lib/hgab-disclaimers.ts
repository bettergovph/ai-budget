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
  'Figures belong to DPWH district offices, not to representatives. A candidate is a document comparison, not evidence of wrongdoing.';
