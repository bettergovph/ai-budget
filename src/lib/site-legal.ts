/**
 * The site's Disclaimer (/disclaimer) and Terms of Service (/terms-of-service): the paths, the
 * effective date, where to report errors, and the licences, in one place for both pages, the
 * footer and the first-visit agreement (components/TermsGate.tsx). The terms follow BetterGov.ph's
 * own Terms of Service (bettergov.ph/terms-of-service, effective October 7, 2026), adapted to an
 * independent analysis site. Pure: safe in the Worker.
 */

export const DISCLAIMER_PAGE = '/disclaimer';
export const TERMS_PAGE = '/terms-of-service';
/** Pages the agreement links to. They show it as a bar, not a modal, so they can be read first. */
export const LEGAL_PAGES: readonly string[] = [DISCLAIMER_PAGE, TERMS_PAGE];

/**
 * When the current text took effect, and the version visitors accept. Change it with any material
 * change to either page: everyone is asked to accept again on their next visit. Scripts that open
 * the site in a browser read this line as text (scripts/lib/accept-terms.mjs), so keep its shape.
 */
export const TERMS_VERSION = '2026-11-08';
export const LEGAL_EFFECTIVE = new Date(`${TERMS_VERSION}T00:00:00Z`).toLocaleDateString('en-US', {
  timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
});
/** localStorage key for the acceptance: `{ "version": TERMS_VERSION, "acceptedAt": ISO time }`. */
export const TERMS_STORAGE_KEY = 'bettergov-budget:terms';

export const CONTACT_EMAIL = 'volunteers@bettergov.ph';
export const ISSUES_URL = 'https://github.com/bettergovph/ai-budget/issues';
/** BetterGov.ph's Discord, where citizen reviewers meet (the "Be a citizen budget reviewer" poster's step 1). */
export const DISCORD_URL = 'https://discord.gg/bettergovph';
export const ABOUT_URL = 'https://about.bettergov.ph';
export const BETTERGOV_TERMS_URL = 'https://bettergov.ph/terms-of-service';

export interface Licence { name: string; url: string }
/** Text, charts, posters and share images: shared unchanged, so a disclaimer can't be cropped off. */
export const CONTENT_LICENCE: Licence = { name: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' };
/** Downloads (CSV, JSON), the API and the MCP server: reusable with credit, so others can build on them. */
export const DATA_LICENCE: Licence = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
/** The source code (the repository's LICENSE). */
export const CODE_LICENCE: Licence = { name: 'MIT License', url: 'https://github.com/bettergovph/ai-budget/blob/main/LICENSE' };
