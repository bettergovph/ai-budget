/**
 * `/2027/d/:deptId` — one spending group's FY2027 proposal.
 *
 * Everything on this page comes from a single `<dept>/summary.json` (tens of
 * KB), so switching tabs is instant and there is no second round-trip. The
 * unbounded detail — every line item — lives behind the "Line items" tab,
 * which hands off to the DuckDB explorer.
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { CompareTable, KpiStrip, NepError, NepHeader, NepLoading } from '../components/Nep2027Bits';
import Nep2027Hierarchy from '../components/Nep2027Hierarchy';
import * as fmt from '../lib/format';
import { deptTitle } from '../lib/seo';
import {
  BASE_YEAR, NEP_YEAR, SYNTHETIC_DEPTS, formatPct, loadNepDept, loadNepIndex, pctChange,
  type NepDeptSummary, type NepNationalIndex, type NepRollupRow,
} from '../lib/nep2027';
import '../nep2027.css';

const TABS = [
  { key: 'hierarchy', label: 'Hierarchy' },
  { key: 'agencies', label: 'Agencies' },
  { key: 'programs', label: 'Programs' },
  { key: 'expense', label: 'Expense class' },
  { key: 'funds', label: 'Fund source' },
  { key: 'regions', label: 'Regions' },
  { key: 'units', label: 'Operating units' },
  { key: 'objects', label: 'Objects' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function Nep2027Department() {
  const { deptId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  // Keyed by department so a pending fetch for the previous route can never
  // paint over the current one, without clearing state synchronously in the
  // effect (which would cascade a render on every navigation).
  const [loaded, setLoaded] = useState<{
    dept: string;
    summary: NepDeptSummary | null;
    err: string | null;
  } | null>(null);
  const [idx, setIdx] = useState<NepNationalIndex | null>(null);

  const tab = (params.get('view') as TabKey) || 'hierarchy';

  useEffect(() => {
    let live = true;
    loadNepDept(deptId)
      .then((s) => { if (live) setLoaded({ dept: deptId, summary: s, err: null }); })
      .catch((e) => { if (live) setLoaded({ dept: deptId, summary: null, err: String(e?.message || e) }); });
    loadNepIndex().then(setIdx).catch(() => { /* the sibling nav is optional */ });
    return () => { live = false; };
  }, [deptId]);

  const current = loaded?.dept === deptId ? loaded : null;
  const summary = current?.summary ?? null;
  const err = current?.err ?? null;

  const deptName = summary?.department?.description;
  useEffect(() => {
    if (deptName) document.title = deptTitle(deptName, 'nep');
  }, [deptName]);

  if (err) return <NepError message={err} />;
  if (!summary) return <NepLoading what={`department ${deptId}`} heroBlend />;

  const d = summary.department;
  if (!d) return <NepError message={`No FY${NEP_YEAR} data for department ${deptId}.`} />;

  const p = pctChange(d.amount, d.base_amount);
  const nationalShare = idx?.national.amount ? (d.amount / idx.national.amount) * 100 : null;
  const note = SYNTHETIC_DEPTS[deptId];

  return (
    <>
      <NepHeader
        crumb={d.description}
        compiledMeta={`${fmt.shortPhp(d.amount)} proposed`}
        heroBlend
      />

      {/* Compact navy hero — the story deck's band, at page scale. The navy
          subnav above runs straight into it (heroBlend drops the chrome rule),
          so header and title read as one piece. */}
      <section className="nep-dept-hero">
        <div className="nep-dept-hero-inner">
          <p className="nep-dept-hero-eyebrow">
            Group {d.id}
            {d.source_department_code && d.source_department_code !== d.id &&
              ` · source department code ${d.source_department_code}`}
          </p>
          <h1 className="nep-dept-hero-title">{d.description}</h1>
          <p className="nep-dept-hero-dek">
            FY{NEP_YEAR} National Expenditure Program, measured against the FY{BASE_YEAR} GAA.
          </p>
          {note && <p className="nep-dept-hero-note">{note}</p>}
        </div>
      </section>

      <main className="nep-main">
        <KpiStrip
          items={[
            {
              label: `FY${NEP_YEAR} proposed`,
              value: fmt.shortPhp(d.amount),
              sub: nationalShare != null ? `${nationalShare.toFixed(2)}% of the national NEP` : undefined,
            },
            {
              label: `vs FY${BASE_YEAR} GAA`,
              value: formatPct(p),
              tone: d.amount >= d.base_amount ? 'up' : 'down',
              sub: `${d.amount >= d.base_amount ? '+' : '−'}${fmt.shortPhp(Math.abs(d.amount - d.base_amount))} on ${fmt.shortPhp(d.base_amount)}`,
            },
            {
              label: 'Line items',
              value: d.line_items.toLocaleString(),
              sub: summary.counts ? `${summary.counts.objects.toLocaleString()} distinct object codes` : undefined,
            },
            {
              label: 'Structure',
              value: summary.counts ? `${summary.counts.agencies} / ${summary.counts.programs}` : '—',
              sub: 'agencies / programs',
            },
          ]}
        />

        <div className="nep-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? 'is-active' : ''}
              onClick={() => setParams(t.key === 'hierarchy' ? {} : { view: t.key }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
          <Link className="nep-tab-link" to={`/2027/search?dept=${deptId}`}>Line items →</Link>
        </div>

        <section className="nep-section">
          {tab === 'hierarchy' ? (
            <Nep2027Hierarchy
              deptId={deptId}
              deptLabel={d.description}
              deptAmount={d.amount}
              deptBaseAmount={d.base_amount}
              agencies={summary.agencies}
            />
          ) : (
            renderTab(tab, summary)
          )}
        </section>

        <section className="nep-section">
          <div className="nep-movers">
            <div>
              <SectionHead eyebrow="Within this group" headline="Programs growing most" size="sm" />
              <ProgramMovers rows={summary.top_movers_up} emptyLabel="No programs grew — every program in this group shrank or held." />
            </div>
            <div>
              <SectionHead eyebrow="Within this group" headline="Programs cut most" size="sm" />
              <ProgramMovers rows={summary.top_movers_down} emptyLabel="No programs were cut — every program in this group grew or held." />
            </div>
          </div>
        </section>

        <p className="nep-provenance">
          {(summary.generated_at ?? idx?.generated_at)
            && `Generated ${new Date((summary.generated_at ?? idx!.generated_at)!).toLocaleString('en-PH')} · `}
          Served live from D1 · <Link to="/2027/methodology">field mapping and caveats</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function renderTab(tab: TabKey, s: NepDeptSummary) {
  const deptId = s.department?.id ?? '';

  /**
   * Every table row links to the line items behind it on the Search page.
   * Expense class and region have exact Search filters; the other dimensions
   * go through the text search, which scans exactly these description fields.
   * Bucket rows ((not attributed), the Other fold) have nothing to search
   * for, so they stay plain.
   */
  const isBucket = (r: NepRollupRow) => r.code === '__unassigned__' || r.code === '__other__';
  const byCode = (param: string) => (r: NepRollupRow) =>
    isBucket(r)
      ? null
      : `/2027/search?dept=${deptId}&${param}=${encodeURIComponent(r.code)}` +
        `&label=${encodeURIComponent(r.description)}`;
  const byAgency = byCode('agency');
  const byProgram = byCode('program');
  const byFund = byCode('fund');
  const byUnit = byCode('unit');
  const byDivision = byCode('division');
  const byObject = byCode('object');
  const byExpense = (r: NepRollupRow) =>
    isBucket(r) ? null : `/2027/search?dept=${deptId}&expense=${encodeURIComponent(r.code)}`;
  const byRegion = (r: NepRollupRow) =>
    isBucket(r) ? null : `/2027/search?dept=${deptId}&region=${encodeURIComponent(r.code)}`;

  switch (tab) {
    case 'programs':
      return (
        <>
          <SectionHead
            eyebrow="PREXC program level"
            headline="Programs, activities and projects"
            dek="Rolled up to the program (4-digit P/A/P prefix); the 200 largest are listed."
          />
          <CompareTable rows={s.programs} label="Program" showCount initial={30} showCode={false} linkTo={byProgram} />
        </>
      );
    case 'expense':
      return (
        <>
          <SectionHead
            eyebrow="UACS expense class"
            headline="Personnel, operating, financial, capital"
            dek="The full split — these four rows always reconcile to the group total."
          />
          <CompareTable rows={s.expense_classes} label="Expense class" showCount initial={10} linkTo={byExpense} />
        </>
      );
    case 'funds':
      return (
        <>
          <SectionHead
            eyebrow="Fund subcategory"
            headline="Where the money comes from"
            dek="Top 40 fund subcategories — general fund, loan proceeds, grants, special accounts."
          />
          <CompareTable rows={s.fund_subcategories} label="Fund" showCount initial={20} linkTo={byFund} />
        </>
      );
    case 'regions':
      return (
        <>
          <SectionHead
            eyebrow="Geography"
            headline="Regional distribution"
            dek="Region as tagged on each line item. Central-office and nationwide items are not regionalized."
          />
          <CompareTable rows={s.regions} label="Region" showCount initial={20} linkTo={byRegion} />
        </>
      );
    case 'units':
      return (
        <>
          <SectionHead
            eyebrow="Implementing unit"
            headline="Operating units"
            dek="Top 60 operating units by FY2027 amount. Schools divisions, where present, are listed separately below."
          />
          <CompareTable rows={s.top_operating_units} label="Operating unit" showCount initial={20} linkTo={byUnit} />
          {s.top_divisions.length > 0 && (
            <>
              <SectionHead eyebrow="Sub-unit" headline="Divisions" size="sm" />
              <CompareTable rows={s.top_divisions} label="Division" showCount initial={15} linkTo={byDivision} />
            </>
          )}
        </>
      );
    case 'objects':
      return (
        <>
          <SectionHead
            eyebrow="UACS object code"
            headline="What the money buys"
            dek="Top 60 object codes by FY2027 amount — salaries, allowances, supplies, infrastructure, transfers."
          />
          <CompareTable rows={s.top_objects} label="Object" showCount initial={25} linkTo={byObject} />
        </>
      );
    case 'agencies':
    default:
      return (
        <>
          <SectionHead
            eyebrow="Agencies and bureaus"
            headline="How the group splits internally"
            dek="Every agency under this group, FY2026 enacted vs FY2027 proposed."
          />
          <CompareTable rows={s.agencies} label="Agency" showCount initial={30} linkTo={byAgency} />
        </>
      );
  }
}

function ProgramMovers({ rows, emptyLabel }: { rows: NepRollupRow[]; emptyLabel?: string }) {
  const shown = rows.filter((r) => r.delta !== 0);
  if (!shown.length) {
    return <p className="nep-empty">{emptyLabel ?? 'No program-level change to report.'}</p>;
  }
  const max = Math.max(1, ...shown.map((r) => Math.abs(r.delta)));
  return (
    <ol className="nep-mover-list">
      {shown.map((r) => (
        <li key={r.code}>
          <span className="nep-mover-name">{r.description}</span>
          <span className="nep-mover-bar">
            <span
              style={{
                width: `${(Math.abs(r.delta) / max) * 100}%`,
                background: r.delta >= 0 ? 'var(--positive)' : 'var(--negative)',
              }}
            />
          </span>
          <span className="nep-mover-num" style={{ color: r.delta >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {r.delta >= 0 ? '+' : '−'}{fmt.shortPhp(Math.abs(r.delta))}
          </span>
        </li>
      ))}
    </ol>
  );
}
