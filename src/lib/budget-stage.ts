/**
 * Where the FY2027 budget is in the budget cycle: NEP → House hearings → House bill → Senate → bicameral → GAA.
 * One list for the House bill section's timeline (HgabStageStrip) and the notice on the NEP overview's hero
 * (Nep2027Story), so both always show the same stage. Stages that happened carry their month; later ones say what
 * comes next, never an invented date.
 *
 * When the budget moves on, move `current` here, then rewrite the hero notice's words (Nep2027Story.tsx,
 * StageNotice), which name the current stage.
 */

export type StageState = 'done' | 'current' | 'future';

export interface BudgetStage {
  name: string;
  /** For the compact timeline on the NEP overview's hero notice. */
  short: string;
  when: string;
  meta: string;
  /** The site's page for this stage, if it has one. */
  to?: string;
  state: StageState;
}

export const BUDGET_2027_STAGES: readonly BudgetStage[] = [
  { name: 'NEP', short: 'NEP', when: 'Aug 2026', meta: 'Submitted by the President to Congress', to: '/2027', state: 'done' },
  { name: 'House hearings', short: 'Hearings', when: 'Aug–Sep 2026', meta: 'Agencies answer questions on their budgets', to: '/hearings', state: 'done' },
  { name: 'House bill', short: 'House bill', when: 'Now', meta: 'HB 10858, voted on at 2nd and 3rd reading', to: '/hgab/2027/overview', state: 'current' },
  { name: 'Senate', short: 'Senate', when: 'Next', meta: 'Its own committee, then a floor vote', state: 'future' },
  { name: 'Bicameral', short: 'Bicameral', when: 'Then', meta: 'Both chambers settle on one text', state: 'future' },
  { name: 'Enacted budget (GAA)', short: 'GAA', when: 'Last', meta: 'Signed into law; FY2020–2026 so far', to: '/gaa', state: 'future' },
];
