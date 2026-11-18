/**
 * "How to review a project" (`/hgab/2027/review/how-to`): the steps a new volunteer follows in the project reviewer,
 * each with a screenshot. The same steps are the explainer video's scenes: one screenshot each, and each sentence of
 * `text` a line of narration. Keep sentences short and plain, so they read well aloud.
 *
 * Screenshots: `npm run build:hgab-review-howto` (scripts/build-hgab-review-howto.ts) opens the reviewer on a demo
 * project with a demo member and writes public/screenshots/how-to-review/<key>.webp; bump HOWTO_SHOTS_TAKEN with them.
 */
import { REVIEW_ROOT } from './hgab-review';

export const HOWTO_ROOT = `${REVIEW_ROOT}/how-to`;
export const HOWTO_TITLE = 'How to review a project';
export const HOWTO_SHOT_DIR = 'screenshots/how-to-review';
/** When the screenshots were last taken (YYYY-MM-DD). */
export const HOWTO_SHOTS_TAKEN = '2026-11-18';
/** The screenshots' size: 16:9, so they work as video frames too. */
export const HOWTO_SHOT_WIDTH = 1600;
export const HOWTO_SHOT_HEIGHT = 900;
/** The project the screenshots open: a House insertion with all 5 key documents and redacted Senate copies. */
export const HOWTO_DEMO_PROJECT = 'HB10858-3-0592-009483';

export interface HowtoStep {
  key: string;
  title: string;
  /** What to do, one sentence each: the page's text and the video's narration. */
  text: string[];
  /** What the screenshot shows, for screen readers. */
  alt: string;
}

export const HOWTO_STEPS: readonly HowtoStep[] = [
  {
    key: 'open',
    title: 'Open the reviewer',
    text: [
      'Go to budget.bettergov.ph/review.',
      'Filters and the review progress are at the top.',
      'The projects are on the left.',
      'The project you open is in the middle, with its documents on the right.',
    ],
    alt: 'The project reviewer: filters across the top, the list of projects on the left, an open project in the middle and its document on the right.',
  },
  {
    key: 'sign-in',
    title: 'Sign in with your email',
    text: [
      'Anyone can read the projects and their documents.',
      'To review, sign in with your email.',
      'We send you a code. There is no password.',
    ],
    alt: 'The “Sign in to review” box below an open project.',
  },
  {
    key: 'pick',
    title: 'Pick projects nobody has reviewed',
    text: [
      'Under Review progress, click House insertions.',
      'The list keeps only the House insertions nobody has reviewed yet.',
      'House insertions are projects in the House bill that were not in the NEP, by our comparison.',
      'Start with these.',
    ],
    alt: 'The House insertions card under Review progress, clicked, and the filter steps it added.',
  },
  {
    key: 'filter',
    title: 'Narrow the list',
    text: [
      'Use the filters to find projects you know, like those in your region or your DPWH office.',
      'Each option shows how many projects it keeps.',
      'Every filter you add is a step, shown under the filters. Remove a step with its ×.',
    ],
    alt: 'The Region filter open, with a checkbox and a project count for each region.',
  },
  {
    key: 'project',
    title: 'Open a project',
    text: [
      'Click a project in the list to open it.',
      'You see its budget, the DPWH office and the legislative districts it serves, and its program.',
      'The green checks show which of the 5 key documents were found.',
    ],
    alt: 'An open project: its title, budget, DPWH office, district, program and the 5 key documents.',
  },
  {
    key: 'documents',
    title: 'Read the documents',
    text: [
      'The project’s documents open on the right.',
      'Switch between them with the tabs above the document, or with the [ and ] keys.',
      'Senate copies have their signatures blacked out, for privacy.',
      'Check that each document is really for this project.',
    ],
    alt: 'The document viewer, with tabs for the program of work, BP 202, photos and other documents above a page of the program of work.',
  },
  {
    key: 'flags',
    title: 'Look at the red flags',
    text: [
      'Open the red flags to see why a project may need a closer look.',
      'A red flag is a reason to check. It is not a finding.',
    ],
    alt: 'The project’s red flags, opened.',
  },
  {
    key: 'questions',
    title: 'Answer the questions',
    text: [
      'The suggested questions for this project come first.',
      'Answer each one: Satisfactory, Needs attention or Needs immediate attention.',
      'Add a remark on what you saw, and on which page.',
      'Skip a question that doesn’t apply.',
    ],
    alt: 'Question cards in the review, one answered Satisfactory with a remark. The answers are an example.',
  },
  {
    key: 'final',
    title: 'Give your final status',
    text: [
      'At the top of your review, pick the final status, and write your final remarks.',
      'This is what the team reports.',
      'Picking it saves your review. Click Save after you change anything else.',
      'You can come back and edit your review anytime.',
    ],
    alt: 'The final status buttons with Satisfactory picked and saved, and the final remarks box. The answers are an example.',
  },
  {
    key: 'next',
    title: 'Go to the next project',
    text: [
      'Click Next, or press j for the next project and k for the one before.',
      'A project you reviewed shows its status in the list, so others can pick a different one.',
      'More than one member can review the same project.',
    ],
    alt: 'The project list, with the reviewed project showing its status.',
  },
  {
    key: 'mine',
    title: 'Find your reviews',
    text: [
      'Your reviews are under the clipboard button at the top right.',
      'Show them in the list, or download them as a spreadsheet.',
    ],
    alt: 'The “My reviews” menu: show my reviews, download my reviews (CSV) and sign out.',
  },
];

export const howtoShot = (key: string) => `/${HOWTO_SHOT_DIR}/${key}.webp`;

/**
 * The explainer video: the same steps, narrated in Taglish (about 2 minutes, captions burned in). Made with the
 * reels engine (scripts/video/how-to-review-tl, outside the repo) and published in the campaign gallery
 * (build-campaign-gallery.ts, R2 hgab/2027/campaign/). `?v=` is the file's MD5: R2 has no purge.
 */
const CAMPAIGN = 'https://budget-assets.bettergov.ph/hgab/2027/campaign';
export const HOWTO_VIDEO = {
  src: `${CAMPAIGN}/how-to-review-taglish-1920x1080.mp4?v=9b9c888d`,
  poster: `${CAMPAIGN}/thumbs/how-to-review-taglish-1920x1080.jpg?v=16d76133`,
  gallery: `${CAMPAIGN}/index.html#how-to-review`,
  label: 'Watch the video (Taglish, 2 minutes)',
} as const;
