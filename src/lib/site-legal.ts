/**
 * The site's Disclaimer (/disclaimer) and Terms of Service (/terms-of-service): the paths, the
 * effective date, where to report errors, and the licences, in one place for both pages and the
 * footer. The terms follow BetterGov.ph's own Terms of Service (bettergov.ph/terms-of-service,
 * effective October 7, 2026), adapted to an independent analysis site. Pure: safe in the Worker.
 */

export const DISCLAIMER_PAGE = '/disclaimer';
export const TERMS_PAGE = '/terms-of-service';

/** When the current text took effect. Change it with any change to either page. */
export const LEGAL_EFFECTIVE = 'October 29, 2026';

export const CONTACT_EMAIL = 'volunteers@bettergov.ph';
export const ISSUES_URL = 'https://github.com/bettergovph/ai-budget/issues';
export const ABOUT_URL = 'https://about.bettergov.ph';
export const BETTERGOV_TERMS_URL = 'https://bettergov.ph/terms-of-service';

export interface Licence { name: string; url: string }
/** Text, charts, posters and share images: shared unchanged, so a disclaimer can't be cropped off. */
export const CONTENT_LICENCE: Licence = { name: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' };
/** Downloads (CSV, JSON), the API and the MCP server: reusable with credit, so others can build on them. */
export const DATA_LICENCE: Licence = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
/** The source code (the repository's LICENSE). */
export const CODE_LICENCE: Licence = { name: 'MIT License', url: 'https://github.com/bettergovph/ai-budget/blob/main/LICENSE' };
