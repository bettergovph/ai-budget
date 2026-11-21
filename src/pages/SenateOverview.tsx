/**
 * `/senate/2027/overview`: the Senate committee report on House Bill 10858 against the House bill — the whole
 * bill, the departments that change most, and the four infrastructure programs project by project.
 *
 * Reads `senate/2027/overview.json` and `departments.json`.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { HgabStageStrip } from '../components/HgabBits';
import {
  SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner, SenateStatusChip, SignedChange,
} from '../components/SenateBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { titleCase } from '../lib/hgab-explorer';
import {
  PROGRAM_SHORT, SENATE_DOC, SENATE_EXPLORER_ROOT, SENATE_PROVISIONS_ROOT, SENATE_ROOT, SENATE_STATUS, SENATE_STATUS_ORDER,
  loadSenateDepartments, loadSenateOverview, senateExplorerPath, senateProgramPath, senatePdfUrl,
  type SenateDepartments, type SenateOverview as Overview, type SenateProgramRow,
} from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';
import '../hgab-overview.css';

export default function SenateOverview() {
  const [o, setO] = useState<Overview | null>(null);
  const [deps, setDeps] = useState<SenateDepartments | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    document.title = pageMeta(`${SENATE_ROOT}/overview`).title;
    loadSenateOverview().then(setO).catch((e) => setErr(String(e?.message || e)));
    loadSenateDepartments().then(setDeps).catch(() => { /* the table is optional */ });
  }, []);
  if (err) return <SenateError message={err} />;
  if (!o) return <SenateLoading what="the Senate committee report" />;

  const prog = o.totals['PROGRAMMED APPROPRIATIONS'];
  const unprog = o.totals['UNPROGRAMMED APPROPRIATIONS'];
  const all = o.totals['TOTAL NEW APPROPRIATIONS'];
  const deptT = o.totals['DEPARTMENTS'];
  const spf = o.totals['SPECIAL PURPOSE FUNDS'];
  const dpwh = o.programs.find((p) => p.key === 'dpwh');
  const cuts = o.biggest.filter((d) => d.net < 0).slice(0, 8);
  const raises = [...o.biggest].filter((d) => d.net > 0).reverse().slice(0, 8);

  return (
    <>
      <SenateHeader crumb="Overview" heroBlend />
      {/* As the House overview: the hero says only the section's name; what it says opens the page. */}
      <SenateHero crumb="Overview" title="Senate Budget Analysis" />
      <main className="nep-main">
        <div className="hgab-ov-intro">
          <p className="hgab-ov-lede">
            The Senate Committee on Finance keeps the House bill's programmed total at{' '}
            {fmt.shortPhp(prog.senate ?? 0, 'T')}, and moves {fmt.shortPhp(prog.increase ?? 0, 'B')} between lines.
            {dpwh ? <> DPWH projects fall {fmt.shortPhp(Math.abs(dpwh.change_php), 'B')}, from {fmt.shortPhp(dpwh.house_php)} in the House bill to {fmt.shortPhp(dpwh.senate_php)}.</> : null}
          </p>
          <p className="hgab-ov-scope">
            {SENATE_DOC.plain} Every line of the bill is set beside the NEP and the House bill on the{' '}
            <Link to={SENATE_EXPLORER_ROOT}>Line by line</Link> pages, and four programs project by project, further down.
          </p>
        </div>
        <HgabStageStrip here="Senate" />
        <SenateReviewBanner />
        <KpiStrip
          items={[
            { label: 'Programmed, Senate', value: fmt.shortPhp(prog.senate ?? 0, 'T'), sub: prog.net === 0 ? 'the same as the House bill, to the peso' : `${fmt.shortPhp(prog.net ?? 0)} vs the House bill` },
            { label: 'Moved between lines', value: fmt.shortPhp(prog.increase ?? 0, 'B'), sub: 'raised in some lines, cut from others' },
            { label: 'Departments', value: fmt.shortPhp(deptT.net ?? 0, 'B'), tone: (deptT.net ?? 0) < 0 ? 'down' : 'up', sub: `special purpose funds ${(spf.net ?? 0) >= 0 ? '+' : ''}${fmt.shortPhp(spf.net ?? 0, 'B')}` },
            { label: 'Unprogrammed', value: fmt.shortPhp(unprog.senate ?? 0, 'B'), sub: `${(unprog.net ?? 0) < 0 ? '−' : '+'}${fmt.shortPhp(Math.abs(unprog.net ?? 0))} vs the House bill` },
          ]}
        />

        <section className="nep-section">
          <SectionHead
            eyebrow="Project by project"
            headline="The four infrastructure programs in the Senate"
            dek="Every House bill project, with what the Senate committee report does to it: removed, reduced, raised, renamed or left as it is, and the projects it inserts."
          />
          <div className="senate-programs">
            {o.programs.map((p) => <ProgramCard key={p.key} p={p} />)}
          </div>
        </section>

        <section className="nep-section">
          <SectionHead
            eyebrow="By department"
            headline={`${o.departments_changed} of ${o.departments} departments and funds change in the Senate`}
            dek={<>Each department's NEP, House bill and committee report totals; "Change" is the Senate committee report minus the House bill. <Link to={SENATE_EXPLORER_ROOT}>See every line →</Link></>}
          />
          <div className="senate-split">
            <DeptList title="Largest Senate cuts" rows={cuts} />
            <DeptList title="Largest Senate increases" rows={raises} />
          </div>
          {deps && (
            <details className="hgab-details">
              <summary>All departments and funds</summary>
              <div className="nep-table-wrap">
                <table className="nep-table">
                  <thead><tr><th>Department or fund</th><th className="num">NEP</th><th className="num">House bill</th><th className="num">Senate</th><th className="num">vs House bill</th><th className="num">vs NEP</th></tr></thead>
                  <tbody>
                    {deps.departments.filter((d) => d.roman).map((d) => (
                      <tr key={d.name}>
                        <td className="nep-td-name">{d.id ? <Link to={senateExplorerPath(d.id)}>{titleCase(d.name)}</Link> : titleCase(d.name)}</td>
                        <td className="num nep-td-base">{d.nep != null ? fmt.shortPhp(d.nep) : '—'}</td>
                        <td className="num nep-td-base">{fmt.shortPhp(d.house ?? 0)}</td>
                        <td className="num nep-td-amt">{fmt.shortPhp(d.senate ?? 0)}</td>
                        <td className="num"><SignedChange v={d.net} base={d.house} /></td>
                        <td className="num"><SignedChange v={d.nep != null && d.senate != null ? d.senate - d.nep : null} base={d.nep} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>

        <section className="nep-section">
          <SectionHead
            eyebrow="Beyond the amounts"
            headline={`${o.provisions} Senate amendments to the bill's provisions`}
            dek={<>The report also rewrites the rules attached to the budget: amounts in special provisions, conditions on releases, reports agencies must file. <Link to={SENATE_PROVISIONS_ROOT}>Read them →</Link></>}
          />
        </section>

        <section className="nep-section">
          <SectionHead eyebrow="The documents" headline="The Senate committee report, as published" />
          <ul className="senate-refs">
            {o.documents.map((d) => (
              <li key={d.key}><a href={senatePdfUrl(d.key)} target="_blank" rel="noreferrer">{d.title}</a></li>
            ))}
          </ul>
          <p className="nep-provenance">
            {o.report.title}, {o.report.committee}; prepared by {o.report.prepared}. All amounts in pesos. Built {o.built_at.slice(0, 10)}.
            {' '}Totals: House bill {fmt.php(all.house ?? 0, { unit: 'full' })}, committee report {fmt.php(all.senate ?? 0, { unit: 'full' })}.
          </p>
        </section>
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}

function ProgramCard({ p }: { p: SenateProgramRow }) {
  const total = Object.values(p.status).reduce((a, s) => a + (s?.house_php ?? 0) + (s?.senate_php ?? 0), 0) || 1;
  return (
    <Link to={senateProgramPath(p.key)} className="senate-program-card">
      <h3>{PROGRAM_SHORT[p.key]}</h3>
      <p className="senate-flow">
        <small>NEP</small>{fmt.shortPhp(p.nep_php)}<small>→ House bill</small>{fmt.shortPhp(p.house_php)}<small>→ Senate</small>{fmt.shortPhp(p.senate_php)}
      </p>
      <p className="senate-flow-change">
        <SignedChange v={p.change_php} base={p.house_php} /> <small>vs the House bill</small>
        {' · '}<SignedChange v={p.senate_php - p.nep_php} base={p.nep_php} /> <small>vs the NEP</small>
      </p>
      <div className="senate-statusbar" aria-hidden="true">
        {SENATE_STATUS_ORDER.map((s) => {
          const v = p.status[s];
          if (!v) return null;
          const w = ((s === 'added' || s === 'restored' ? v.senate_php : v.house_php) / total) * 100;
          return <span key={s} style={{ width: `${w}%`, background: SENATE_STATUS[s].tone }} title={SENATE_STATUS[s].label} />;
        })}
      </div>
      <ul>
        {SENATE_STATUS_ORDER.filter((s) => p.status[s] && s !== 'unchanged').map((s) => (
          <li key={s}>
            <SenateStatusChip status={s} />
            <span>{p.status[s]!.count.toLocaleString()} · {statusAmount(s, p.status[s]!)}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

/** What a status group's money means: cut and renamed carry the House amount, added the Senate's, raised and
 * reduced the change. */
function statusAmount(s: string, v: { nep_php: number; house_php: number; senate_php: number }): string {
  if (s === 'added' || s === 'restored') return fmt.shortPhp(v.senate_php);
  if (s === 'nep_only') return `NEP ${fmt.shortPhp(v.nep_php)}`;
  if (s === 'raised' || s === 'reduced') {
    const d = v.senate_php - v.house_php;
    return `${d >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(d))}`;
  }
  return fmt.shortPhp(v.house_php);
}

function DeptList({ title, rows }: { title: string; rows: Overview['biggest'] }) {
  return (
    <div>
      <h3 className="senate-split-title">{title}</h3>
      <table className="nep-table">
        <thead><tr><th>Department or fund</th><th className="num">NEP</th><th className="num">House bill</th><th className="num">Senate</th><th className="num">vs House bill</th><th className="num">vs NEP</th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td className="nep-td-name"><Link to={senateExplorerPath(d.id)}>{titleCase(d.name)}</Link></td>
              <td className="num nep-td-base">{d.nep != null ? fmt.shortPhp(d.nep) : '—'}</td>
              <td className="num nep-td-base">{fmt.shortPhp(d.house)}</td>
              <td className="num nep-td-amt">{fmt.shortPhp(d.senate)}</td>
              <td className="num"><SignedChange v={d.net} base={d.house} /></td>
              <td className="num"><SignedChange v={d.nep != null && d.senate != null ? d.senate - d.nep : null} base={d.nep} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
