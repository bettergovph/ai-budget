import { useEffect, useId, useMemo, useState } from 'react';
import {
  BUDGET_CYCLE_EXPENSE_LABELS,
  BUDGET_CYCLE_STAGE_DESCRIPTIONS,
  BUDGET_CYCLE_STAGE_LABELS,
  BUDGET_CYCLE_STAGES,
  loadBudgetCycle,
} from '../lib/budget-cycle';
import * as fmt from '../lib/format';
import type {
  BudgetCycleExpenseClass,
  BudgetCycleFact,
  BudgetCycleMatchMethod,
  BudgetCycleProgram,
  BudgetCycleResponse,
  BudgetCycleStage,
} from '../lib/types';
import { SectionHead } from './shared';
import './budget-cycle-view.css';

interface BudgetCycleViewProps {
  deptId: string;
  departmentName: string;
}

interface StageTotal {
  reported: boolean;
  amount: number;
  facts: number;
}

const STAGE_NOTES: Record<BudgetCycleStage, string> = {
  nep: 'Executive proposal',
  gaa: 'Enacted budget',
  authorized_appropriation: 'Authority available',
  adjusted_appropriation: 'Authority after adjustments',
  adjusted_allotment: 'Allotments released',
  obligations: 'Commitments incurred',
  disbursements: 'Payments made',
};

const MATCH_LABELS: Record<BudgetCycleMatchMethod, string> = {
  exact_code: 'Code match',
  organization_history: 'Org history',
  agency_name_and_pap_code: 'Agency + code',
  agency_name_and_pap_label: 'Label match',
  ambiguous: 'Review match',
  unmatched: 'Unmatched',
};

function programAgencyKey(program: BudgetCycleProgram): string {
  return program.display_agency_id || `${program.source_department_code}-${program.source_agency_code}`;
}

function aggregateStage(
  facts: BudgetCycleFact[],
  programIds: Set<string>,
  year: number,
  stage: BudgetCycleStage,
  expenseClass: BudgetCycleExpenseClass,
): StageTotal {
  const rowsWithReportedTotal = expenseClass === 'total'
    ? null
    : new Set(
        facts
          .filter((fact) =>
            fact.fiscal_year === year &&
            fact.stage === stage &&
            fact.expense_class === 'total' &&
            programIds.has(fact.source_row_id),
          )
          .map((fact) => fact.source_row_id),
      );
  let reported = false;
  let amount = 0;
  let count = 0;
  for (const fact of facts) {
    if (
      fact.fiscal_year !== year ||
      fact.stage !== stage ||
      fact.expense_class !== expenseClass ||
      !programIds.has(fact.source_row_id) ||
      (rowsWithReportedTotal != null && !rowsWithReportedTotal.has(fact.source_row_id))
    ) continue;
    reported = true;
    count += 1;
    if (fact.amount_pesos != null) amount += Number(fact.amount_pesos);
  }
  return { reported, amount, facts: count };
}

function ratio(numerator: StageTotal, denominator: StageTotal): number | null {
  if (!numerator.reported || !denominator.reported || denominator.amount <= 0) return null;
  return numerator.amount / denominator.amount;
}

function relationshipTone(method: BudgetCycleMatchMethod): string {
  if (method === 'unmatched' || method === 'ambiguous') return 'review';
  if (method === 'organization_history') return 'history';
  if (method === 'agency_name_and_pap_label') return 'label';
  return 'exact';
}

function showRelationshipNote(method: BudgetCycleMatchMethod): boolean {
  return method === 'organization_history' ||
    method === 'agency_name_and_pap_label' ||
    method === 'ambiguous' ||
    method === 'unmatched';
}

function StageInfo({ stage }: { stage: BudgetCycleStage }) {
  const tooltipId = useId();
  const labels = BUDGET_CYCLE_STAGE_LABELS[stage];
  const edge = stage === 'nep' ? 'edge-start' : stage === 'disbursements' ? 'edge-end' : '';
  return (
    <span className={`cycle-info ${edge}`}>
      <button
        type="button"
        className="cycle-info-trigger"
        aria-label={`About ${labels.label}`}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span id={tooltipId} className="cycle-info-tooltip" role="tooltip">
        <strong>{labels.label}</strong>
        <span>{BUDGET_CYCLE_STAGE_DESCRIPTIONS[stage]}</span>
      </span>
    </span>
  );
}

function latestUsefulYear(data: BudgetCycleResponse): number {
  const totalFacts = data.facts.filter((fact) => fact.expense_class === 'total');
  const executionYears = totalFacts
    .filter((fact) => fact.stage === 'disbursements')
    .map((fact) => fact.fiscal_year);
  if (executionYears.length) return Math.max(...executionYears);
  const years = totalFacts.map((fact) => fact.fiscal_year);
  return years.length ? Math.max(...years) : Math.max(...data.metadata.years, 2026);
}

function LoadingState() {
  return (
    <div className="cycle-state">
      <p className="cycle-state-title">Loading the full budget cycle…</p>
      <div className="loading-bar" aria-hidden="true" />
      <p>Relating workbook P/A/P rows to this department’s current portal hierarchy.</p>
    </div>
  );
}

export default function BudgetCycleView({ deptId, departmentName }: BudgetCycleViewProps) {
  const [data, setData] = useState<BudgetCycleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(2025);
  const [expenseClass, setExpenseClass] = useState<BudgetCycleExpenseClass>('total');
  const [stage, setStage] = useState<BudgetCycleStage>('obligations');
  const [agency, setAgency] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadBudgetCycle(deptId)
      .then((response) => {
        if (cancelled) return;
        const initialYear = latestUsefulYear(response);
        const hasObligations = response.facts.some(
          (fact) => fact.fiscal_year === initialYear && fact.stage === 'obligations' && fact.expense_class === 'total',
        );
        setData(response);
        setYear(initialYear);
        setStage(hasObligations ? 'obligations' : 'gaa');
        setExpenseClass('total');
        setAgency('all');
        setQuery('');
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason?.message || reason));
      });
    return () => { cancelled = true; };
  }, [deptId]);

  const agencies = useMemo(() => {
    if (!data) return [];
    const byId = new Map<string, string>();
    for (const program of data.programs) {
      byId.set(programAgencyKey(program), program.display_agency_name || program.source_agency_name || 'Unlabelled agency');
    }
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const selectedProgramIds = useMemo(() => {
    if (!data) return new Set<string>();
    return new Set(
      data.programs
        .filter((program) => agency === 'all' || programAgencyKey(program) === agency)
        .map((program) => program.source_row_id),
    );
  }, [data, agency]);

  const totals = useMemo(() => {
    const result = {} as Record<BudgetCycleStage, StageTotal>;
    for (const current of BUDGET_CYCLE_STAGES) {
      result[current] = data
        ? aggregateStage(data.facts, selectedProgramIds, year, current, expenseClass)
        : { reported: false, amount: 0, facts: 0 };
    }
    return result;
  }, [data, selectedProgramIds, year, expenseClass]);

  const yearMatrix = useMemo(() => {
    if (!data) return [];
    return data.metadata.years
      .map((matrixYear) => ({
        year: matrixYear,
        stages: Object.fromEntries(
          BUDGET_CYCLE_STAGES.map((current) => [
            current,
            aggregateStage(data.facts, selectedProgramIds, matrixYear, current, expenseClass),
          ]),
        ) as Record<BudgetCycleStage, StageTotal>,
      }))
      .filter((row) => BUDGET_CYCLE_STAGES.some((current) => row.stages[current].reported))
      .sort((a, b) => b.year - a.year);
  }, [data, selectedProgramIds, expenseClass]);

  const factIndex = useMemo(() => {
    const index = new Map<string, BudgetCycleFact>();
    for (const fact of data?.facts ?? []) {
      index.set(
        `${fact.source_row_id}|${fact.fiscal_year}|${fact.stage}|${fact.expense_class}`,
        fact,
      );
    }
    return index;
  }, [data]);

  const programRows = useMemo(() => {
    if (!data) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return data.programs
      .filter((program) => selectedProgramIds.has(program.source_row_id))
      .filter((program) => {
        if (!normalizedQuery) return true;
        return [
          program.source_pap_label,
          program.portal_pap_label,
          program.source_pap_code,
          program.display_agency_name,
        ].some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .map((program) => {
        const stageFacts: Partial<Record<BudgetCycleStage, BudgetCycleFact>> = {};
        for (const current of BUDGET_CYCLE_STAGES) {
          const fact = factIndex.get(`${program.source_row_id}|${year}|${current}|${expenseClass}`);
          const hasReportedTotal = expenseClass === 'total' ||
            factIndex.has(`${program.source_row_id}|${year}|${current}|total`);
          if (fact && hasReportedTotal) stageFacts[current] = fact;
        }
        const amounts = Object.values(stageFacts)
          .map((fact) => fact?.amount_pesos)
          .filter((amount): amount is number => amount != null)
          .map(Number);
        return {
          program,
          stageFacts,
          activeAmount: stageFacts[stage]?.amount_pesos == null
            ? Number.NEGATIVE_INFINITY
            : Number(stageFacts[stage]?.amount_pesos),
          largestAmount: amounts.length ? Math.max(...amounts) : Number.NEGATIVE_INFINITY,
        };
      })
      .filter((row) => Object.keys(row.stageFacts).length > 0)
      .sort((a, b) => b.activeAmount - a.activeAmount || b.largestAmount - a.largestAmount);
  }, [data, selectedProgramIds, query, factIndex, year, stage, expenseClass]);

  if (error) {
    return (
      <div className="cycle-state cycle-state-error">
        <p className="cycle-state-title">The budget-cycle dataset could not be loaded.</p>
        <p>{error}</p>
      </div>
    );
  }
  if (!data) return <LoadingState />;
  if (!data.metadata.available) {
    return (
      <div className="cycle-state cycle-state-empty">
        <p className="cycle-state-kicker">Budget-cycle coverage</p>
        <h2>No normalized cycle sheet is available for {departmentName} yet.</h2>
        <p>
          The existing portal GAA series remains available. This view will activate when a NEP-to-disbursement
          workbook is related to this department.
        </p>
      </div>
    );
  }

  const gaaToNep = ratio(totals.gaa, totals.nep);
  const obligationRate = ratio(totals.obligations, totals.adjusted_allotment);
  const disbursementRate = ratio(totals.disbursements, totals.obligations);
  const qualityCount = data.quality_summary.reduce((sum, item) => sum + Number(item.count), 0);
  const unmatched = data.programs.filter((program) => program.match_method === 'unmatched' || program.match_method === 'ambiguous');
  const shownRows = programRows.slice(0, 100);
  const coverageYears = yearMatrix.map((row) => row.year);
  const coverageLabel = coverageYears.length
    ? `${Math.min(...coverageYears)}–${Math.max(...coverageYears)}`
    : 'Not reported';

  return (
    <div className="budget-cycle-view">
      <SectionHead
        eyebrow="Budget lifecycle · Current New Appropriations"
        headline="From proposal to actual payments"
        dek={
          <>
            Follow {departmentName} through NEP, enacted GAA, adjusted authority and allotments, obligations,
            and disbursements. These full-peso workbook figures have a narrower scope than the portal’s main
            GAA series and are kept separate.
          </>
        }
      />

      <div className="cycle-scope-strip">
        <div>
          <span>Scope</span>
          <strong>Current New Appropriations</strong>
        </div>
        <div>
          <span>Related P/A/P rows</span>
          <strong>{data.metadata.counts.programs.toLocaleString()}</strong>
        </div>
        <div>
          <span>Coverage</span>
          <strong>{coverageLabel}</strong>
        </div>
        <div>
          <span>Relationship review</span>
          <strong>{unmatched.length ? `${unmatched.length} unresolved` : 'All related'}</strong>
        </div>
      </div>

      <div className="cycle-toolbar">
        <div className="cycle-years" aria-label="Fiscal year">
          {yearMatrix.map((row) => (
            <button
              key={row.year}
              type="button"
              className={year === row.year ? 'active' : ''}
              aria-pressed={year === row.year}
              onClick={() => setYear(row.year)}
            >
              FY {row.year}
            </button>
          ))}
        </div>
        <div className="cycle-filters">
          <label>
            <span>Agency</span>
            <select value={agency} onChange={(event) => setAgency(event.target.value)}>
              <option value="all">All agencies</option>
              {agencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span>Expense class</span>
            <select
              value={expenseClass}
              onChange={(event) => setExpenseClass(event.target.value as BudgetCycleExpenseClass)}
            >
              {data.metadata.expense_classes.map((item) => (
                <option key={item} value={item}>{BUDGET_CYCLE_EXPENSE_LABELS[item]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="cycle-flow" aria-label={`FY ${year} budget cycle`}>
        {BUDGET_CYCLE_STAGES.map((current, index) => {
          const item = totals[current];
          const previous = index > 0 ? totals[BUDGET_CYCLE_STAGES[index - 1]] : null;
          const change = previous?.reported && previous.amount !== 0 && item.reported
            ? (item.amount - previous.amount) / previous.amount
            : null;
          return (
            <div
              key={current}
              className={`cycle-stage ${stage === current ? 'active' : ''} ${item.reported ? '' : 'missing'}`}
            >
              <button
                type="button"
                className="cycle-stage-main"
                aria-pressed={stage === current}
                onClick={() => setStage(current)}
              >
                <span className="cycle-stage-number">{index + 1}</span>
                <span className="cycle-stage-short">{BUDGET_CYCLE_STAGE_LABELS[current].short}</span>
                <span className="cycle-stage-amount">
                  {item.reported ? fmt.php(item.amount) : 'Not reported'}
                </span>
                <span className="cycle-stage-note">
                  {change == null ? STAGE_NOTES[current] : `${fmt.signedPct(change)} from prior stage`}
                </span>
              </button>
              <StageInfo stage={current} />
            </div>
          );
        })}
      </div>

      <div className="cycle-ratios">
        <div>
          <span>GAA ÷ NEP</span>
          <strong>{gaaToNep == null ? 'Not reported' : fmt.pct(gaaToNep)}</strong>
          <small>Enacted versus proposed</small>
        </div>
        <div>
          <span>Obligation rate</span>
          <strong>{obligationRate == null ? 'Not reported' : fmt.pct(obligationRate)}</strong>
          <small>Obligations ÷ adjusted allotment</small>
        </div>
        <div>
          <span>Disbursement rate</span>
          <strong>{disbursementRate == null ? 'Not reported' : fmt.pct(disbursementRate)}</strong>
          <small>Disbursements ÷ obligations</small>
        </div>
      </div>

      <section className="cycle-section">
        <div className="cycle-section-head">
          <div>
            <p className="eyebrow">Multi-year stage matrix · {BUDGET_CYCLE_EXPENSE_LABELS[expenseClass]}</p>
            <h2>Where each fiscal year reached</h2>
          </div>
          <p>A blank is not converted to zero. Select any reported cell to inspect its P/A/P rows.</p>
        </div>
        <div className="cycle-matrix-wrap">
          <table className="cycle-matrix">
            <thead>
              <tr>
                <th>Fiscal year</th>
                {BUDGET_CYCLE_STAGES.map((current) => (
                  <th key={current}>
                    <span className="cycle-stage-heading">
                      <span>{BUDGET_CYCLE_STAGE_LABELS[current].short}</span>
                      <StageInfo stage={current} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yearMatrix.map((row) => (
                <tr key={row.year} className={row.year === year ? 'active' : ''}>
                  <th>FY {row.year}</th>
                  {BUDGET_CYCLE_STAGES.map((current) => {
                    const item = row.stages[current];
                    const active = row.year === year && current === stage;
                    return (
                      <td key={current} className={active ? 'active' : item.reported ? '' : 'missing'}>
                        {item.reported ? (
                          <button type="button" onClick={() => { setYear(row.year); setStage(current); }}>
                            {fmt.php(item.amount)}
                          </button>
                        ) : <span>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cycle-section">
        <div className="cycle-section-head cycle-program-head">
          <div>
            <p className="eyebrow">
              FY {year} · {BUDGET_CYCLE_EXPENSE_LABELS[expenseClass]} · selected stage highlighted
            </p>
            <h2>P/A/P budget cycle</h2>
            <p>
              {programRows.length.toLocaleString()} P/A/P rows with at least one reported stage
            </p>
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search P/A/P, agency, or code…"
            aria-label="Search budget-cycle programs"
          />
        </div>

        <div className="cycle-program-table-wrap">
          <table className="cycle-program-table">
            <thead>
              <tr>
                <th>P/A/P</th>
                {BUDGET_CYCLE_STAGES.map((current) => (
                  <th
                    key={current}
                    className={`cycle-program-stage ${stage === current ? 'active' : ''}`}
                  >
                    <span className="cycle-stage-heading">
                      <button type="button" className="cycle-stage-select" onClick={() => setStage(current)}>
                        {BUDGET_CYCLE_STAGE_LABELS[current].short}
                      </button>
                      <StageInfo stage={current} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.map(({ program, stageFacts }) => {
                const sourceLabel = program.source_pap_label || program.portal_pap_label || 'Unlabelled P/A/P';
                const portalDiffers = program.portal_pap_label && program.portal_pap_label !== sourceLabel;
                const showRelationship = showRelationshipNote(program.match_method);
                return (
                  <tr key={program.source_row_id}>
                    <td className="cycle-program-name">
                      <strong>{sourceLabel}</strong>
                      <span>{program.display_agency_name} · Source code {program.source_pap_code}</span>
                      {portalDiffers && <span>Portal: {program.portal_pap_label}</span>}
                      {showRelationship && (
                        <span className={`cycle-match cycle-match-${relationshipTone(program.match_method)}`}>
                          {MATCH_LABELS[program.match_method]}
                        </span>
                      )}
                      {showRelationship && program.review_note && <small>{program.review_note}</small>}
                    </td>
                    {BUDGET_CYCLE_STAGES.map((current) => {
                      const fact = stageFacts[current];
                      const amount = fact?.amount_pesos == null ? null : Number(fact.amount_pesos);
                      return (
                        <td
                          key={current}
                          className={`num cycle-program-stage ${stage === current ? 'active' : ''} ${fact ? '' : 'missing'}`}
                        >
                          {amount == null ? '—' : fmt.php(amount)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {!shownRows.length && (
                <tr>
                  <td colSpan={1 + BUDGET_CYCLE_STAGES.length} className="cycle-no-results">
                    No reported P/A/P rows match this slice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {programRows.length > shownRows.length && (
          <p className="cycle-table-note">
            Showing 100 of {programRows.length.toLocaleString()} rows, ordered by the highlighted stage and then the largest reported stage.
          </p>
        )}
      </section>

      <div className="cycle-quality-note">
        <strong>Source integrity.</strong>{' '}
        Explicit zeros are retained; blanks remain not reported. {qualityCount.toLocaleString()} source-quality
        flags affect this department and remain attached for review. Relationships use codes, organization
        history, and exact normalized labels—never amount similarity.
      </div>
    </div>
  );
}
