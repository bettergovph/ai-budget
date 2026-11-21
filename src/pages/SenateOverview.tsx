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
  SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner, SignedChange,
} from '../components/SenateBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { titleCase } from '../lib/hgab-explorer';
import {
  PROGRAM_SHORT, SENATE_DOC, SENATE_EXPLORER_ROOT, SENATE_PROVISIONS_ROOT, SENATE_ROOT,
  loadSenateDepartments, loadSenateOverview, senateExplorerPath, senateProgramPath, senatePdfUrl,
  type SenateDepartments, type SenateOverview as Overview, type SenateProgramRow, type SenateStatus,
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

/**
 * One program: the House bill and the Senate as two bars on one scale (Jason, 2026-11-21: "needs a better design. They
 * are hard to understand"). What stays is grey on both; what the Senate removes is red on the House bar; what it adds
 * (raises, insertions, NEP projects it restores) is coloured on the Senate bar. Each part has a plain sentence.
 * Not a pie: a pie splits one total, and here the Senate both takes from the House budget and adds from outside it.
 */
function ProgramCard({ p }: { p: SenateProgramRow }) {
  const st = p.status;
  const h = (k: SenateStatus) => st[k]?.house_php ?? 0;
  const sv = (k: SenateStatus) => st[k]?.senate_php ?? 0;
  const n = (k: SenateStatus) => st[k]?.count ?? 0;
  // The House budget the Senate keeps as it is, and the parts that leave it or come in.
  const kept = h('unchanged') + h('renamed') + h('raised') + sv('reduced');
  const removed = h('cut') + (h('reduced') - sv('reduced'));
  const raised = sv('raised') - h('raised');
  const inserted = sv('added');
  const restored = sv('restored');
  const scale = Math.max(p.house_php, p.senate_php) || 1;
  const w = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  const same = n('unchanged') + n('renamed');
  const parts: Array<{ key: string; tone: string; text: string; amount: string; show: boolean }> = [
    { key: 'removed', tone: 'is-removed', show: removed > 0,
      text: `${(n('cut') + n('reduced')).toLocaleString()} ${n('cut') + n('reduced') === 1 ? 'project' : 'projects'} removed${n('reduced') ? ` or reduced (${n('reduced')} reduced)` : ''}`,
      amount: `−${fmt.shortPhp(removed)}` },
    { key: 'raised', tone: 'is-raised', show: raised > 0,
      text: `${n('raised').toLocaleString()} ${n('raised') === 1 ? 'project' : 'projects'} raised`, amount: `+${fmt.shortPhp(raised)}` },
    { key: 'inserted', tone: 'is-inserted', show: inserted > 0,
      text: `${n('added').toLocaleString()} new ${n('added') === 1 ? 'project' : 'projects'} inserted by the Senate`, amount: `+${fmt.shortPhp(inserted)}` },
    { key: 'restored', tone: 'is-restored', show: restored > 0,
      text: `${n('restored').toLocaleString()} NEP ${n('restored') === 1 ? 'project' : 'projects'} the House dropped, restored`, amount: `+${fmt.shortPhp(restored)}` },
    { key: 'kept', tone: 'is-kept', show: true,
      text: `${same.toLocaleString()} projects keep the same budget${n('renamed') ? ` (${n('renamed').toLocaleString()} under a revised name)` : ''}`,
      // Only the projects whose budget doesn't move; the grey bar also carries the raised and reduced projects' base.
      amount: fmt.shortPhp(h('unchanged') + h('renamed')) },
  ];
  return (
    <Link to={senateProgramPath(p.key)} className="senate-program-card">
      <h3>{PROGRAM_SHORT[p.key]}</h3>
      <p className="senate-pc-total">
        <span>House bill <b>{fmt.shortPhp(p.house_php)}</b></span>
        <span aria-hidden="true">→</span>
        <span>Senate <b>{fmt.shortPhp(p.senate_php)}</b></span>
        <SignedChange v={p.change_php} base={p.house_php} />
      </p>
      <div className="senate-pc-bars" role="img"
        aria-label={`House bill ${fmt.shortPhp(p.house_php)}: ${fmt.shortPhp(kept)} kept, ${fmt.shortPhp(removed)} removed. Senate ${fmt.shortPhp(p.senate_php)}: ${fmt.shortPhp(kept)} kept, ${fmt.shortPhp(raised + inserted + restored)} added.`}>
        <span className="senate-pc-label">House bill</span>
        <span className="senate-pc-bar">
          <i className="is-kept" style={{ width: w(kept) }} />
          <i className="is-removed" style={{ width: w(removed) }} />
        </span>
        <span className="senate-pc-label">Senate</span>
        <span className="senate-pc-bar">
          <i className="is-kept" style={{ width: w(kept) }} />
          <i className="is-raised" style={{ width: w(raised) }} />
          <i className="is-inserted" style={{ width: w(inserted) }} />
          <i className="is-restored" style={{ width: w(restored) }} />
        </span>
      </div>
      <ul className="senate-pc-parts">
        {parts.filter((x) => x.show).map((x) => (
          <li key={x.key}><i className={x.tone} aria-hidden="true" /><span>{x.text}</span><b>{x.amount}</b></li>
        ))}
      </ul>
      <p className="senate-pc-nep">
        NEP {fmt.shortPhp(p.nep_php)} · the Senate is <SignedChange v={p.senate_php - p.nep_php} base={p.nep_php} /> from it
      </p>
      <span className="senate-pc-open">See every project →</span>
    </Link>
  );
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
