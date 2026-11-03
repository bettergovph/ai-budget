/**
 * Citizen Reports (`/citizen-reports`, in the primary nav before Learn): budget analyses that citizens, journalists
 * and civic groups publish on their own sites, one card each. Jason (2026-11-03): "Create a new page before Learn
 * called 'Citizen Reports' and add cards for" the six sites below, kept in his order.
 *
 * A card's words come from its site: the title as the site publishes it, the maker it names (the GitHub account's
 * public name where the site shows only the account; no byline where it names no one), and what it says it covers.
 * The screenshots are `npm run build:citizen-reports` (scripts/build-citizen-report-shots.ts), one WebP per card in
 * public/screenshots/; bump SHOTS_TAKEN when they are retaken.
 *
 * Pure (no `import.meta.env`, no DOM): the page, the screenshot script and the Worker's SEO code import it.
 */

export const CITIZEN_REPORTS_ROOT = '/citizen-reports';
/** When the screenshots were taken; the page says so, since the sites keep changing. */
export const SHOTS_TAKEN = '2026-11-03';
/** The screenshot's size in pixels: a 1280×800 window, halved from a 1.5× render so the text stays sharp. */
export const SHOT_WIDTH = 960;
export const SHOT_HEIGHT = 600;

export interface CitizenReport {
  /** The screenshot's file name under public/screenshots/, and the React key. */
  key: string;
  /** The link as Jason gave it: some open a particular page of the site. */
  url: string;
  /** The site's own title. */
  title: string;
  /** Who made it; absent when the site names no one. */
  by?: string;
  /** What it covers, in one short line. */
  covers: string;
  summary: string;
  /** How the site connects to this one, when it does. */
  note?: string;
}

export const CITIZEN_REPORTS: CitizenReport[] = [
  {
    key: 'ph-budget-analysis',
    url: 'https://ajamontesa.github.io/ph-budget-analysis/',
    title: 'Philippine Departmental Budget Reviews',
    by: 'AJ Montesa',
    covers: 'FY 2018–2027 · NEP, GAA and utilization',
    summary:
      'Department reviews that follow the NEP and the GAA down to each program, activity and project, set against what ' +
      'agencies report they released, obligated and disbursed. Also assesses the 2027 NEP and House bill as a whole.',
  },
  {
    key: 'budget-workbenches',
    url: 'https://csiiiv.github.io/DPWH-NEP-HB-2027-ANALYSIS/app/#overview',
    title: 'FY2027 Budget Workbenches',
    by: 'csiiiv',
    covers: 'FY 2027 · NEP vs House bill · 4 programs',
    summary:
      'The NEP and House Bill 10858 matched record by record for DPWH, farm-to-market roads, health facilities and ' +
      'irrigation, each amount traced to its page in the published PDFs. Records found in only one document are listed ' +
      'as insertion and deletion candidates.',
    note: 'This site’s House bill project pages are built on its data.',
  },
  {
    key: 'priority-review-leads',
    url: 'https://research.bettergov.ph/static/nep-preview/summary.html',
    title: 'Budget Summary · Priority Review Leads',
    by: 'BetterGov Budget Research',
    covers: 'FY 2027 · DPWH review leads',
    summary:
      'Where investigators might look first: DPWH projects from the NEP to the House bill, flood-control patterns, ' +
      'repeated projects, cost per meter and per unit, and allocations by district and barangay. Its figures are ' +
      'provisional, and a flag is a prompt for review, not a finding.',
  },
  {
    key: 'budget-hearings',
    url: 'https://tordecilla.github.io/budget-hearings-2026/digests/h105/',
    title: 'Working Draft: Philippine Budget Hearings',
    by: 'Jaemark Tordecilla',
    covers: 'FY 2027 · House and Senate hearings',
    summary:
      'Transcripts and digests of the 2027 budget hearings in the House and the Senate, each point linked to the line ' +
      'of the transcript it comes from. This link opens the digest of the Senate Committee on Finance’s consultation ' +
      'with civil-society organizations on 26 October 2026.',
  },
  {
    key: 'budgetnatin',
    url: 'https://budgetnatin.org/',
    title: '2027 infrastructure budget by province: NEP vs House bill',
    covers: 'FY 2027 · NEP vs House bill · by place',
    summary:
      'Compares every project in DPWH, farm-to-market roads, health facilities and irrigation between the NEP and the ' +
      'House bill, by province, city or town and barangay, with a map and the change per resident.',
    note: 'Made with data and help from the BetterGov.ph team.',
  },
  {
    key: 'budget-pilipinas',
    url: 'https://budget.gdgt.link/',
    title: 'Budget Pilipinas — FY2027, district by district',
    by: 'Gadget Pilipinas and Blip Media',
    covers: 'FY 2027 · House bill vs NEP · 254 districts',
    summary:
      'The DPWH budget in the House bill against the NEP for all 254 legislative districts, with a province map and ' +
      'the document page behind every figure.',
    note: 'Built on this site’s public API and BetterGov’s open-source transparency portal.',
  },
];

/** Where the page loads a card's screenshot from, and where the script writes it (under public/). */
export const shotPath = (r: CitizenReport) => `/screenshots/${r.key}.webp`;

/** "ajamontesa.github.io", "budgetnatin.org": the address a card shows. */
export const hostOf = (url: string) => new URL(url).host;
