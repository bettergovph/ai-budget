/**
 * `/2027` — FY2027 National Expenditure Program overview.
 *
 * The NEP is a *proposal*: what the Executive submitted to Congress. Every
 * headline here is framed against the FY2026 GAA (what Congress actually
 * enacted) because that delta is the thing analysts are looking for.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { Bar, CompareTable, Delta, KpiStrip, NepError, NepHeader, NepLoading } from '../components/Nep2027Bits';
import * as fmt from '../lib/format';
import {
  BASE_YEAR, NEP_YEAR, formatPct, loadNepIndex, pctChange,
  type NepDeptRow, type NepNationalIndex,
} from '../lib/nep2027';
import '../nep2027.css';

export default function Nep2027National() {
  const [idx, setIdx] = useState<NepNationalIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadNepIndex().then(setIdx).catch((e) => setErr(String(e?.message || e)));
  }, []);

  // Overview shows only the largest few; /2027/browse owns the full table.
  const depts = useMemo(
    () => (idx ? [...idx.departments].sort((a, b) => b.amount - a.amount) : []),
    [idx],
  );

  if (err) return <NepError message={err} />;
  if (!idx) return <NepLoading what="the FY2027 NEP overview" />;

  const { amount, base_amount: base, line_items: items } = idx.national;
  const growth = pctChange(amount, base);

  return (
    <>
      <NepHeader
        crumb="National Expenditure Program"
        compiledMeta={`${fmt.shortPhp(amount, 'T')} proposed`}
      />

      <main className="nep-main">
        <div className="page-headline">
          <p className="page-eyebrow">National Expenditure Program · Fiscal Year {NEP_YEAR}</p>
          <h1 className="page-title">The FY{NEP_YEAR} budget the Executive is proposing</h1>
          <p className="page-dek">
            {items.toLocaleString()} line items across {idx.departments.length} spending groups, measured
            against the FY{BASE_YEAR} GAA that Congress enacted. The NEP is a proposal — Congress can and
            does move these numbers before it becomes the GAA.
          </p>
        </div>

        <KpiStrip
          items={[
            {
              label: `FY${NEP_YEAR} NEP total`,
              value: fmt.shortPhp(amount, 'T'),
              sub: `${items.toLocaleString()} line items`,
            },
            {
              label: `vs FY${BASE_YEAR} GAA`,
              value: formatPct(growth),
              tone: amount >= base ? 'up' : 'down',
              sub: `${amount >= base ? '+' : '−'}${fmt.shortPhp(Math.abs(amount - base), 'B')} on ${fmt.shortPhp(base, 'T')}`,
            },
            {
              label: 'Spending groups',
              value: idx.departments.length,
              sub: '38 departments + SPF + automatic',
            },
            {
              label: 'Biggest single increase',
              value: idx.top_movers_up[0] ? `+${fmt.shortPhp(idx.top_movers_up[0].delta, 'B')}` : '—',
              tone: 'up',
              sub: idx.top_movers_up[0]?.description ?? '',
            },
          ]}
        />

        <section className="nep-section">
          <SectionHead
            eyebrow="Expense class"
            headline="Where the increase actually lands"
            dek={`Personnel services, operating costs, financial expenses and capital outlays, FY${BASE_YEAR} enacted vs FY${NEP_YEAR} proposed.`}
          />
          <div className="nep-class-grid">
            {idx.expense_classes.map((c) => {
              const p = pctChange(c.amount, c.base_amount);
              const share = amount ? (c.amount / amount) * 100 : 0;
              return (
                <div className="nep-class-card" key={c.code}>
                  <div className="nep-class-name">{c.description}</div>
                  <div className="nep-class-amt">{fmt.shortPhp(c.amount, 'T')}</div>
                  <div className="nep-class-meta">
                    <span>{share.toFixed(1)}% of the NEP</span>
                    <span
                      className="nep-class-delta"
                      style={{ color: c.delta >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                    >
                      {formatPct(p)}
                    </span>
                  </div>
                  <Bar value={c.amount} max={Math.max(...idx.expense_classes.map((x) => Math.max(x.amount, x.base_amount)))} base={c.base_amount} />
                  <div className="nep-class-base">FY{BASE_YEAR}: {fmt.shortPhp(c.base_amount, 'T')}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="nep-section">
          <div className="nep-movers">
            <div>
              <SectionHead eyebrow="Movers" headline="Largest increases" size="sm" />
              <MoverList rows={idx.top_movers_up} />
            </div>
            <div>
              <SectionHead eyebrow="Movers" headline="Largest reductions" size="sm" />
              <MoverList rows={idx.top_movers_down} />
            </div>
          </div>
        </section>

        <section className="nep-section" id="groups">
          <SectionHead
            eyebrow={`Ranking · FY${NEP_YEAR}`}
            headline="Every spending group"
            dek={`All ${idx.departments.length} groups, sorted and filterable, with FY${BASE_YEAR} alongside.`}
            right={<Link className="nep-cta" to="/2027/browse">Browse all groups →</Link>}
          />
          <div className="nep-group-peek">
            {depts.slice(0, 6).map((d) => (
              <Link key={d.id} to={`/2027/d/${d.id}`} className="nep-group-peek-item">
                <span className="nep-group-peek-name">{d.description}</span>
                <span className="nep-group-peek-amt">{fmt.shortPhp(d.amount)}</span>
                <Delta amount={d.amount} base={d.base_amount} />
              </Link>
            ))}
          </div>
          <p className="nep-hier-note">
            Showing the six largest. <Link to="/2027/browse">See all {idx.departments.length} groups →</Link>
          </p>
        </section>

        <section className="nep-section">
          <SectionHead
            eyebrow="Programs"
            headline={`The 40 largest programs in the FY${NEP_YEAR} NEP`}
            dek="Rolled up to the PREXC program level (the 4-digit prefix of the P/A/P code) within each agency."
          />
          <CompareTable
            rows={idx.top_programs}
            label="Program"
            showCode={false}
            initial={15}
            linkTo={(r) => {
              const dept = (r as { department_id?: string }).department_id;
              return dept ? `/2027/d/${dept}` : null;
            }}
          />
        </section>

        <div className="nep-two-up">
          <section className="nep-section">
            <SectionHead eyebrow="Geography" headline="By region" size="sm"
              dek="Region is tagged per line item; nationwide and central-office items sit under their own code." />
            <CompareTable rows={idx.regions} label="Region" initial={10} />
          </section>
          <section className="nep-section">
            <SectionHead eyebrow="Fund source" headline="By fund subcategory" size="sm"
              dek="Top 25 fund subcategories by FY2027 amount." />
            <CompareTable rows={idx.fund_subcategories} label="Fund" initial={10} />
          </section>
        </div>

        <p className="nep-provenance">
          Generated {new Date(idx.generated_at).toLocaleString('en-PH')} from{' '}
          <code>{idx.source_file.split('/').pop()}</code> · FY{BASE_YEAR} baseline from the GAA extracts in
          this repository · aggregations served live from D1, line items from parquet ·{' '}
          <Link to="/2027/methodology">field mapping and caveats</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function MoverList({ rows }: { rows: NepDeptRow[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));
  return (
    <ol className="nep-mover-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={`/2027/d/${r.id}`} className="nep-mover-name">{r.description}</Link>
          <span className="nep-mover-bar">
            <span
              style={{
                width: `${(Math.abs(r.delta) / max) * 100}%`,
                background: r.delta >= 0 ? 'var(--positive)' : 'var(--negative)',
              }}
            />
          </span>
          <span className="nep-mover-num"><Delta amount={r.amount} base={r.base_amount} /></span>
        </li>
      ))}
    </ol>
  );
}
