import type {
  BudgetCycleExpenseClass,
  BudgetCycleResponse,
  BudgetCycleStage,
} from './types';

export const BUDGET_CYCLE_STAGES: readonly BudgetCycleStage[] = [
  'nep',
  'gaa',
  'authorized_appropriation',
  'adjusted_appropriation',
  'adjusted_allotment',
  'obligations',
  'disbursements',
];

export const BUDGET_CYCLE_STAGE_LABELS: Record<BudgetCycleStage, { short: string; label: string }> = {
  nep: { short: 'NEP', label: 'National Expenditure Program' },
  gaa: { short: 'GAA', label: 'General Appropriations Act' },
  authorized_appropriation: { short: 'AuthAppro', label: 'Authorized Appropriation' },
  adjusted_appropriation: { short: 'AdjAppro', label: 'Adjusted Appropriation' },
  adjusted_allotment: { short: 'AdjAllot', label: 'Adjusted Allotment' },
  obligations: { short: 'Obligations', label: 'Obligations' },
  disbursements: { short: 'Disbursements', label: 'Disbursements' },
};

export const BUDGET_CYCLE_STAGE_DESCRIPTIONS: Record<BudgetCycleStage, string> = {
  nep: 'The Executive branch’s proposed national budget submitted to Congress. It is a proposal, not yet enacted spending authority.',
  gaa: 'The annual budget passed by Congress and signed into law. This dataset shows the Current New Appropriations portion.',
  authorized_appropriation: 'The original appropriation legally authorized for the P/A/P before in-year transfers, realignments, and other adjustments.',
  adjusted_appropriation: 'Authorized appropriation after approved transfers, realignments, and other changes made during budget execution.',
  adjusted_allotment: 'The amount released or made available for the agency to incur obligations, after allotment adjustments and transfers.',
  obligations: 'Commitments incurred for goods, services, projects, and other valid liabilities that the government must pay.',
  disbursements: 'Payments made to settle obligations, including cash, checks, and other approved settlement methods.',
};

export const BUDGET_CYCLE_EXPENSE_LABELS: Record<BudgetCycleExpenseClass, string> = {
  total: 'Total',
  ps: 'Personnel services',
  mooe: 'Maintenance & operating',
  finex: 'Financial expenses',
  co: 'Capital outlays',
};

export async function loadBudgetCycle(deptId: string): Promise<BudgetCycleResponse> {
  const response = await fetch(`/api/dept/${deptId}/budget-cycle`);
  if (!response.ok) {
    throw new Error(`Budget-cycle API returned ${response.status}`);
  }
  return (await response.json()) as BudgetCycleResponse;
}
